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
	// The Worker creates a room through this path before it forwards an upgrade. Reaching the object
	// is the whole point: it is what makes Cloudflare place a new room at the location hint, and a
	// Durable Object never moves afterwards. The response itself is never read.
	if req.URL.Path == "/placement" {
		w.WriteHeader(http.StatusOK)
		return
	}
	// COMPAT(relay-room-v3): added 2026-11, remove after 2026-12-15. A room created before the key
	// bump cannot move, so its sockets are closed here and their owners reconnect to the current
	// room. Once every daemon has reconnected, the old key has no sockets and this path can go.
	if req.URL.Path == "/migrate" {
		r.closeAllSockets()
		w.WriteHeader(http.StatusOK)
		return
	}
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
		ConnectionID: conn.ConnectionID(),
		KeyVersion:   relay.RoomKeyVersion,
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
	saved, ok := attachmentOf(socket.JSValue())
	if !ok {
		return nil
	}
	// A socket accepted under an older room key cannot reach its peers any more: new connections
	// route to a room created under the current key. Close it (and its peers) so every end reconnects
	// to the current room, which is the only way a room moves to a better region.
	if saved.KeyVersion != relay.RoomKeyVersion {
		r.closeAllSockets()
		return nil
	}
	conn, ok := connectionFromAttachment(socket.JSValue())
	if !ok {
		return nil
	}
	kind := relay.MessageText
	if mt == cfws.BinaryMessage {
		kind = relay.MessageBinary
	}
	peer := &wsPeer{conn: socket, connectionID: conn.ConnectionID()}
	// Nothing in this handler may await before the frame is forwarded. The runtime dispatches
	// message events concurrently, so one suspension is enough for a later frame to overtake an
	// earlier one: measured on the hosted build, 30 back-to-back frames arrived in a different
	// order than they were sent, which scrambles every byte stream (terminal output, file
	// transfer chunks, tunnel data) that crosses the relay. Counting lives on the handshake in
	// handleFetch, where a suspension cannot reorder anything.
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

// placedRooms remembers the rooms this isolate already created with a location hint. The placement
// round trip is paid once per room, not on every handshake.
var placedRooms sync.Map

// placeRoom creates a room under the APAC hint. Cloudflare honours a location hint only while the
// object is being created, and a Durable Object never moves, so this is the one moment a room can be
// put near its users. Best effort: a failed placement leaves the room wherever Cloudflare picks.
func placeRoom(roomKey string) {
	if _, done := placedRooms.LoadOrStore(roomKey, struct{}{}); done {
		return
	}
	ns, err := durableobjects.NewDurableObjectNamespace("RELAY")
	if err != nil {
		placedRooms.Delete(roomKey)
		return
	}
	id, err := ns.IDFromName(roomKey)
	if err != nil {
		placedRooms.Delete(roomKey)
		return
	}
	stub, err := ns.Get(id, durableobjects.DurableObjectNamespaceGetDurableObjectOptions{
		LocationHint: durableobjects.DurableObjectLocationHintApac,
	})
	if err != nil {
		placedRooms.Delete(roomKey)
		return
	}
	req := js.Global().Get("Request").New("https://relay-room.internal/placement")
	promise, ok := callJS(stub, "fetch", req)
	if !ok {
		placedRooms.Delete(roomKey)
		return
	}
	if _, err := awaitPromise(promise); err != nil {
		placedRooms.Delete(roomKey)
	}
}

// awaitPromise blocks the wasm goroutine until the JS promise settles.
func awaitPromise(promise js.Value) (js.Value, error) {
	results := make(chan js.Value, 1)
	failures := make(chan error, 1)
	var then, catch js.Func
	then = js.FuncOf(func(_ js.Value, args []js.Value) any {
		defer then.Release()
		results <- args[0]
		return js.Undefined()
	})
	catch = js.FuncOf(func(_ js.Value, args []js.Value) any {
		defer catch.Release()
		failures <- fmt.Errorf("promise rejected: %s", args[0].String())
		return js.Undefined()
	})
	promise.Call("then", then).Call("catch", catch)
	select {
	case result := <-results:
		// The promise settled: the reject handler will never run, and an unreleased js.Func leaks.
		catch.Release()
		return result, nil
	case err := <-failures:
		then.Release()
		return js.Value{}, err
	}
}

// migratedRooms remembers the servers whose previous-key room this isolate already drained.
var migratedRooms sync.Map

// migrateOldRoom closes the sockets left in the room created under the previous key. Both ends route
// to the current key, so a socket in the old room cannot reach them: without this, an idle daemon
// would sit there until it happened to send a frame, and every client would see it offline.
//
// COMPAT(relay-room-v3): added 2026-11, remove after 2026-12-15 with the /migrate handler.
func migrateOldRoom(serverID string) {
	if _, done := migratedRooms.LoadOrStore(serverID, struct{}{}); done {
		return
	}
	oldKey := "relay-v" + strconv.Itoa(relay.RoomKeyVersion-1) + ":" + serverID
	ns, err := cloudflare.NewDurableObjectNamespace("RELAY")
	if err != nil {
		migratedRooms.Delete(serverID)
		return
	}
	stub, err := ns.Get(ns.IdFromName(oldKey))
	if err != nil {
		migratedRooms.Delete(serverID)
		return
	}
	req, err := http.NewRequest(http.MethodPost, "https://relay-room.internal/migrate", nil)
	if err != nil {
		migratedRooms.Delete(serverID)
		return
	}
	res, err := stub.Fetch(req)
	if err != nil {
		migratedRooms.Delete(serverID)
		return
	}
	_ = res.Body.Close()
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
type attachment struct {
	ServerID     string `json:"serverId"`
	Role         string `json:"role"`
	ConnectionID string `json:"connectionId"`
	// KeyVersion is the room key generation that accepted this socket. Sockets from an older one are
	// closed on their next message so both ends reconnect to the current room.
	KeyVersion int `json:"keyVersion,omitempty"`
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
	saved, ok := attachmentOf(socket)
	if !ok {
		return relay.Connection{}, false
	}
	values := url.Values{}
	values.Set("serverId", saved.ServerID)
	values.Set("role", saved.Role)
	values.Set("v", relay.CurrentVersion)
	if saved.ConnectionID != "" {
		values.Set("connectionId", saved.ConnectionID)
	}
	conn, problem := relay.NewConnection(values)
	return conn, problem == ""
}

// attachmentOf reads a socket's serialized routing identity. Same reason as writeAttachment: the
// method must be invoked on the socket.
func attachmentOf(socket js.Value) (attachment, bool) {
	raw, ok := callJS(socket, "deserializeAttachment")
	if !ok || raw.Type() != js.TypeString || raw.String() == "" {
		return attachment{}, false
	}
	var saved attachment
	if err := json.Unmarshal([]byte(raw.String()), &saved); err != nil {
		return attachment{}, false
	}
	return saved, true
}

// closeAllSockets closes every socket in this room, which makes both ends reconnect through the
// Worker and join the room for the current key version.
func (r *room) closeAllSockets() {
	sockets, ok := callJS(r.state.JSValue(), "getWebSockets")
	if !ok {
		return
	}
	for i := 0; i < sockets.Length(); i++ {
		_ = cfws.HibernatingConnFromJS(sockets.Index(i)).Close(1012, "relay room moved")
	}
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

	// Placement runs before the upgrade so the room is created under the hint. A fresh room is the
	// only chance to choose its region; after this the object is wherever Cloudflare put it.
	placeRoom(conn.RoomKey())

	ns, err := cloudflare.NewDurableObjectNamespace("RELAY")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// One object per server, so every socket for that daemon reaches the same
	// in-memory registry.
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
		return
	}

	// Background: the previous key's room still holds the sockets that were open when the key
	// changed. Drain it without delaying this handshake.
	serverID := conn.ServerID()
	cloudflare.WaitUntil(func() { migrateOldRoom(serverID) })

	// Meter after the upgrade, not before it. The decision only logs and never refuses a handshake,
	// so its Durable Object round trip has no business sitting between the client and its socket.
	decision, err := takeDailyBudget()
	if err != nil {
		js.Global().Get("console").Call("warn", "relay meter unavailable; accepting an uncounted handshake: "+err.Error())
	} else if decision.Reason != "" {
		js.Global().Get("console").Call("warn", decision.Reason, decision.State.Requests)
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
