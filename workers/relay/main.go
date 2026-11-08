//go:build js && wasm

// Command relay-worker runs the BySpace relay on Cloudflare Workers.
//
// The relay's routing lives in internal/relay and is transport-agnostic; this
// file supplies the parts that only exist on Workers: a Durable Object that
// owns one server's room, and the fetch handler that forwards /ws into it.
//
// Why a Durable Object at all: a relay needs every socket for one server to
// reach the same in-memory state. Workers isolates are ephemeral and not
// addressable, so the state has to live somewhere named. The Worker name is
// user-visible (BYSPACE_RELAY_ORIGIN), the Durable Object id is not.
//
// Hibernation is not an optimisation here, it is what makes the relay
// affordable. A socket accepted with DurableObjectState.acceptWebSocket lets the
// object be evicted while it idles and re-created when a message arrives; a
// socket taken with websocket.Upgrade keeps a goroutine and the whole object
// awake for the connection's entire lifetime, and the runtime bills that time.
// Measured on this account: the non-hibernating build spent 16.2s of billed
// duration per connection against the hibernating TypeScript worker's 4.1ms —
// 2860 requests cost 46.3k GB-s, more than the free plan's whole monthly
// allowance, while the hibernating worker served 774k requests for 3.2k.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"syscall/js"
	"time"

	"github.com/syumai/workers-go"
	"github.com/syumai/workers-go/cloudflare"
	"github.com/syumai/workers-go/exp/cloudflare/durableobjects"
	cfws "github.com/syumai/workers-go/exp/cloudflare/websocket"

	"github.com/ByteTrue/byspace/internal/relay"
)

// roomClass is the Durable Object class name. It must match both
// wrangler.jsonc's durable_objects.bindings[].class_name and the
// -durable-objects flag the build passes to workers-assets-gen.
const roomClass = "RelayRoom"
const meterClass = "RelayMeter"

func main() {
	durableobjects.Register(roomClass, newRoom)
	durableobjects.Register(meterClass, newMeter)
	http.HandleFunc("/", handleFetch)
	workers.Serve(nil)
}

// room is one server's relay state: every socket for that serverId.
//
// The sockets are not held here. Hibernation evicts the object between
// messages, which would empty any in-memory registry, so the runtime's own
// tagged WebSocket list is the source of truth and roomView reads it back
// (`state.GetWebSockets(tag)`), exactly as the TypeScript worker does.
type room struct {
	state *durableobjects.DurableObjectState
	// frames holds what clients sent while the daemon was away. It is
	// in-memory like the Go server's buffer: the hosted relay has always
	// treated this as best effort, and a hibernated object drops it.
	frames *relay.FrameBuffer
}

func newRoom(state *durableobjects.DurableObjectState, _ js.Value) (durableobjects.Object, error) {
	return &room{
		state:  state,
		frames: relay.NewFrameBuffer(),
	}, nil
}

// ServeHTTP handles the object's fetch trigger: the /ws handshake.
func (r *room) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// The object only ever sees upgrades that already passed the Worker's checks;
	// it still validates so a direct object fetch cannot skip them.
	conn, problem := relay.NewConnection(req.URL.Query())
	if problem != "" {
		http.Error(w, problem, http.StatusBadRequest)
		return
	}

	socket, err := cfws.UpgradeHibernating(w, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	router := relay.Router{}
	view := &roomView{room: r}

	// Close whatever this connection supersedes *before* accepting it.
	// BeforeRegister resolves the old socket through the runtime's tagged
	// registry, so accepting first would make a connection find and close
	// itself. The TypeScript worker orders it the same way
	// (closeExistingServerSockets, then acceptWebSocket).
	router.BeforeRegister(view, conn)

	// Hibernating, not Upgrade: acceptWebSocket lets the object be evicted while the socket idles,
	// and every later message arrives as a trigger instead of on a goroutine that keeps the object
	// (and its billed duration) alive.
	tags := conn.Tags()
	if err := r.state.AcceptHibernatingConn(socket, tags...); err != nil {
		_ = socket.Close(1011, "accept failed")
		return
	}

	// What this socket is has to be written onto the socket: after hibernation
	// this wasm instance is gone, so the next message's handler starts from the
	// attachment alone, like reading `deserializeAttachment()` in TypeScript.
	writeAttachment(socket.JSValue(), attachment{
		ServerID:     conn.ServerID(),
		Role:         conn.Role(),
		Version:      conn.Version(),
		ConnectionID: conn.ConnectionID(),
	})

	// Opening bookkeeping runs on this request, exactly like the TypeScript
	// worker's post-accept block: the daemon gets its `sync`, clients notify the
	// control channel, and a superseded socket is closed.
	peer := &wsPeer{conn: socket, connectionID: conn.ConnectionID()}
	router.Connected(context.Background(), view, r.frames, peer, conn)
}

// WebSocketMessage is the Durable Object's webSocketMessage trigger.
//
// It may run on a brand new wasm instance after hibernation, so nothing from
// ServeHTTP survives here except what was serialized onto the socket.
func (r *room) WebSocketMessage(_ context.Context, socket *cfws.HibernatingConn, mt cfws.MessageType, data []byte) error {
	conn, ok := connectionFromAttachment(socket.JSValue())
	if !ok {
		return nil
	}
	kind := relay.MessageText
	if mt == cfws.BinaryMessage {
		kind = relay.MessageBinary
	}
	peer := &wsPeer{conn: socket, connectionID: conn.ConnectionID()}
	js.Global().Get("console").Call("debug", "relay message", conn.ServerID(), conn.Role(), conn.ConnectionID(), kind, len(data))
	// Metering never gates forwarding: closing a valid socket cuts in-flight streams in half.
	decision, err := takeDailyBudget()
	if err != nil {
		js.Global().Get("console").Call("warn", "relay meter unavailable; forwarding without a count: "+err.Error())
	} else if decision.Reason != "" {
		js.Global().Get("console").Call("warn", decision.Reason, decision.State.Requests)
	}
	relay.Router{}.Message(context.Background(), &roomView{room: r}, r.frames, peer, conn, kind, data)
	return nil
}

// WebSocketClose is the webSocketClose trigger: the departure bookkeeping.
func (r *room) WebSocketClose(_ context.Context, socket *cfws.HibernatingConn, code int, reason string, _ bool) error {
	// acceptWebSocket delivers a peer's close frame here but does not send our side of the closing
	// handshake. Echo the code and reason so the peer receives a close event instead of waiting for
	// its transport timeout. This also completes router-initiated peer closes.
	_ = socket.Close(code, reason)
	conn, ok := connectionFromAttachment(socket.JSValue())
	if !ok {
		return nil
	}
	js.Global().Get("console").Call("warn", "relay socket close", conn.ServerID(), conn.Role(), conn.ConnectionID(), code, reason)
	view := &roomView{room: r, closing: socket.JSValue()}
	relay.Router{}.Disconnected(context.Background(), view, r.frames, conn)
	return nil
}

// meter is the single counter shared by every relay room in this Worker namespace. A request to it
// costs one DO invocation, so both it and the room trigger are included in MeterCost.
type meter struct {
	state *durableobjects.DurableObjectState
}

func newMeter(state *durableobjects.DurableObjectState, _ js.Value) (durableobjects.Object, error) {
	return &meter{state: state}, nil
}

func (m *meter) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	var decision relay.MeterDecision
	_, err := m.state.Storage().Transaction(func(tx *durableobjects.DurableObjectTransaction) (js.Value, error) {
		var state relay.MeterState
		if err := readBudgetJSON(tx, "relay-meter-v1", &state); err != nil {
			return js.Undefined(), err
		}
		decision = state.Take(time.Now(), relay.MeterCost, dailyRequestBudget())
		return js.Undefined(), writeBudgetJSON(tx, "relay-meter-v1", decision.State)
	})
	if err != nil {
		http.Error(w, "meter unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(decision)
}

func takeDailyBudget() (relay.MeterDecision, error) {
	ns, err := cloudflare.NewDurableObjectNamespace("RELAY_METER")
	if err != nil {
		return relay.MeterDecision{}, err
	}
	stub, err := ns.Get(ns.IdFromName("global"))
	if err != nil {
		return relay.MeterDecision{}, err
	}
	req, err := http.NewRequest(http.MethodPost, "https://relay-meter.internal/take", nil)
	if err != nil {
		return relay.MeterDecision{}, err
	}
	res, err := stub.Fetch(req)
	if err != nil {
		return relay.MeterDecision{}, err
	}
	defer res.Body.Close()
	var decision relay.MeterDecision
	if err := json.NewDecoder(res.Body).Decode(&decision); err != nil {
		return relay.MeterDecision{}, err
	}
	if res.StatusCode != http.StatusOK {
		return relay.MeterDecision{}, fmt.Errorf("meter returned HTTP %d", res.StatusCode)
	}
	return decision, nil
}

func dailyRequestBudget() int64 {
	configured, err := strconv.ParseInt(cloudflare.Getenv("RELAY_DAILY_REQUEST_BUDGET"), 10, 64)
	if err != nil || configured <= 0 {
		return relay.DefaultBudgetLimits.DailyRequests
	}
	return configured
}

func readBudgetJSON(tx *durableobjects.DurableObjectTransaction, key string, target any) error {
	raw, err := tx.Get(key, durableobjects.DurableObjectGetOptions{})
	if err != nil {
		return err
	}
	if raw.Type() != js.TypeString {
		return nil
	}
	return json.Unmarshal([]byte(raw.String()), target)
}

func writeBudgetJSON(tx *durableobjects.DurableObjectTransaction, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return tx.Put(key, js.ValueOf(string(encoded)), durableobjects.DurableObjectPutOptions{})
}

// WebSocketError is the webSocketError trigger. The runtime reports the
// failure; routing has nothing to add, and the close trigger follows.
func (r *room) WebSocketError(_ context.Context, _ *cfws.HibernatingConn, _ error) error {
	return nil
}

// attachment is what a socket remembers about itself across hibernation.
//
// The field names match the TypeScript worker's RelaySessionAttachment so a
// socket accepted by one and messaged by the other would still route.
type attachment struct {
	ServerID     string `json:"serverId"`
	Role         string `json:"role"`
	Version      string `json:"version"`
	ConnectionID string `json:"connectionId"`
}

// writeAttachment serializes a socket's routing identity onto the socket.
//
// workers-go exposes no wrapper for this, so it calls the runtime method the
// hibernation API provides. It is best effort: a runtime without attachments
// would leave the socket unroutable, which is worth failing on at accept time.
func writeAttachment(socket js.Value, value attachment) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return
	}
	// Call through the socket, not through a function pulled off it: a method detached with
	// `socket.Get(...)` loses its `this`, and the runtime rejects that with "Illegal invocation:
	// function called with incorrect `this` value", which the Durable Object surfaces as a panic in
	// the message and close handlers.
	callJS(socket, "serializeAttachment", string(encoded))
}

// callJS invokes a method with its receiver intact.
//
// `value.Get("method").Invoke(...)` detaches the function from its receiver — "Illegal invocation:
// function called with incorrect `this` value". `Value.Call` keeps the receiver but panics on error,
// so the recover turns a runtime rejection into a plain false.
func callJS(receiver js.Value, method string, args ...any) (result js.Value, ok bool) {
	defer func() {
		if recover() != nil {
			result, ok = js.Value{}, false
		}
	}()
	if receiver.Get(method).Type() != js.TypeFunction {
		return js.Value{}, false
	}
	return receiver.Call(method, args...), true
}

// connectionFromAttachment rebuilds the Connection a socket belongs to.
func connectionFromAttachment(socket js.Value) (relay.Connection, bool) {
	// Same reason as writeAttachment: the method must be invoked on the socket.
	raw, ok := callJS(socket, "deserializeAttachment")
	if !ok || raw.Type() != js.TypeString || raw.String() == "" {
		return relay.Connection{}, false
	}
	var saved attachment
	if err := json.Unmarshal([]byte(raw.String()), &saved); err != nil {
		return relay.Connection{}, false
	}
	values := url.Values{}
	values.Set("serverId", saved.ServerID)
	values.Set("role", saved.Role)
	values.Set("v", saved.Version)
	if saved.ConnectionID != "" {
		values.Set("connectionId", saved.ConnectionID)
	}
	conn, problem := relay.NewConnection(values)
	return conn, problem == ""
}

// handleFetch forwards /ws into the Durable Object that owns the requested
// serverId, and answers /health without waking an object.
func handleFetch(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path == "/health" {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	}
	if req.URL.Path != "/ws" {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	// Validate here, not only inside the object: a request that cannot be
	// upgraded must not wake a Durable Object, and it deserves the same 400/426
	// the TypeScript worker answered with.
	conn, problem := relay.NewConnection(req.URL.Query())
	if problem != "" {
		http.Error(w, problem, http.StatusBadRequest)
		return
	}
	if !strings.EqualFold(strings.TrimSpace(req.Header.Get("Upgrade")), "websocket") {
		http.Error(w, "Expected WebSocket upgrade", http.StatusUpgradeRequired)
		return
	}

	decision, err := takeDailyBudget()
	if err != nil {
		js.Global().Get("console").Call("warn", "relay meter unavailable; accepting an uncounted handshake: "+err.Error())
	} else if decision.Reason != "" {
		js.Global().Get("console").Call("warn", decision.Reason, decision.State.Requests)
	}

	ns, err := cloudflare.NewDurableObjectNamespace("RELAY")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// One object per version and server, not per server: v1 routes frames by role
	// alone, so a v1 socket sharing a room with v2 sockets would broadcast to
	// them. The TypeScript worker isolated the versions the same way.
	stub, err := ns.Get(ns.IdFromName(conn.RoomKey()))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// A WebSocket upgrade has no body, and workers-go's request marshaling
	// passes req.Body straight through to the JS Request constructor. workerd
	// rejects a GET/HEAD Request that carries a body, so drop it first.
	if req.Method == http.MethodGet || req.Method == http.MethodHead {
		req.Body = nil
	}

	// FetchWebSocket, not Fetch: an upgrade reply carries the socket on the JS
	// Response's `webSocket` property, which a reconstructed *http.Response has
	// nowhere to put.
	if err := stub.FetchWebSocket(w, req); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
	}
}

// roomView implements relay.Room over the runtime's socket registry.
//
// The registry is the runtime's, not ours: `getWebSockets(tag)` returns exactly
// the sockets accepted under that tag, including ones accepted by a previous
// (evicted) instance of this object. Keeping a parallel map would go empty the
// first time the object hibernated.
type roomView struct {
	room *room
	// closing is still returned by getWebSockets during its own webSocketClose callback. It must not
	// count as a surviving replacement connection, or Disconnected skips notifying the counterpart.
	closing js.Value
}

func (v *roomView) Peers(tag string) []relay.Peer {
	sockets, err := v.room.state.GetWebSockets(tag)
	if err != nil {
		return nil
	}
	peers := make([]relay.Peer, 0, len(sockets))
	for _, socket := range sockets {
		if !v.closing.IsUndefined() && !v.closing.IsNull() && socket.Equal(v.closing) {
			continue
		}
		conn, ok := connectionFromAttachment(socket)
		if !ok {
			continue
		}
		peers = append(peers, &wsPeer{
			conn:         cfws.HibernatingConnFromJS(socket),
			connectionID: conn.ConnectionID(),
		})
	}
	return peers
}

type wsPeer struct {
	conn         *cfws.HibernatingConn
	connectionID string

	// closeOnce guards Close. A peer is closed from two places — the router
	// closing a replaced connection, and the close trigger — and each call
	// reaches the JS socket.
	closeOnce sync.Once
}

func (p *wsPeer) Send(_ context.Context, mt relay.MessageType, data []byte) error {
	kind := cfws.TextMessage
	if mt == relay.MessageBinary {
		kind = cfws.BinaryMessage
	}
	return p.conn.WriteMessage(kind, data)
}

func (p *wsPeer) Close(code relay.StatusCode, reason string) {
	p.closeOnce.Do(func() {
		_ = p.conn.Close(int(code), reason)
	})
}

func (p *wsPeer) ConnectionID() string { return p.connectionID }
