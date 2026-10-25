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
package main

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"syscall/js"

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

func main() {
	durableobjects.Register(roomClass, newRoom)
	http.HandleFunc("/", handleFetch)
	workers.Serve(nil)
}

// room is one server's relay state: every socket for that serverId.
type room struct {
	state *durableobjects.DurableObjectState
	// frames holds what clients sent while the daemon was away. It is
	// in-memory like the Go server's buffer: the hosted relay has always
	// treated this as best effort, and a hibernated object drops it.
	frames *relay.FrameBuffer

	// peers is the live socket registry. A Durable Object that keeps a socket
	// open is never hibernated, so this stays populated for as long as it
	// matters.
	mu    sync.Mutex
	peers map[string]*wsPeer
}

func newRoom(_ *durableobjects.DurableObjectState, _ js.Value) (durableobjects.Object, error) {
	return &room{
		frames: relay.NewFrameBuffer(),
		peers:  make(map[string]*wsPeer),
	}, nil
}

// ServeHTTP handles the object's fetch trigger: the /ws handshake.
func (r *room) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	conn, problem := relay.NewConnection(req.URL.Query())
	if problem != "" {
		http.Error(w, problem, http.StatusBadRequest)
		return
	}
	if req.URL.Path != "/ws" {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	socket, err := cfws.Upgrade(w, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Upgrade only works if this handler returns without touching the socket:
	// Cloudflare sends the 101 response after ServeHTTP finishes. So the whole
	// lifetime of the connection runs on its own goroutine.
	peer := r.register(socket, conn)
	go r.serve(socket, peer, conn)
}

// register adds the socket to the room and runs the opening bookkeeping.
func (r *room) register(socket *cfws.Conn, conn relay.Connection) *wsPeer {
	peer := newPeer(socket, conn.ConnectionID(), conn.Tags())
	router := relay.Router{}
	view := &roomView{room: r}
	// BeforeRegister closes the socket this one supersedes, and it must not
	// see the new one, so it runs before the peer is visible to Peers.
	router.BeforeRegister(view, conn)
	r.mu.Lock()
	r.peers[conn.ConnectionID()+":"+conn.Role()] = peer
	r.mu.Unlock()
	return peer
}

// serve runs the connection's read loop until it closes.
func (r *room) serve(socket *cfws.Conn, peer *wsPeer, conn relay.Connection) {
	defer r.unregister(peer, conn)
	router := relay.Router{}
	view := &roomView{room: r}
	ctx := context.Background()
	router.Connected(ctx, view, r.frames, peer, conn)
	for {
		mt, data, err := socket.ReadMessage(ctx)
		if err != nil {
			return
		}
		kind := relay.MessageText
		if mt == cfws.BinaryMessage {
			kind = relay.MessageBinary
		}
		router.Message(ctx, view, r.frames, peer, conn, kind, data)
	}
}

// unregister drops the peer and runs the departure bookkeeping.
func (r *room) unregister(peer *wsPeer, conn relay.Connection) {
	r.mu.Lock()
	delete(r.peers, conn.ConnectionID()+":"+conn.Role())
	r.mu.Unlock()
	peer.Close(relay.StatusNormalClosure, "")
	router := relay.Router{}
	router.Disconnected(context.Background(), &roomView{room: r}, r.frames, conn)
}

// connectionFor rebuilds the connection a socket belongs to from its tags.
// serverID is the value the Worker used as the Durable Object name. It is only
// needed to satisfy Connection; no routing decision depends on it because a
// room already belongs to exactly one server.

// handleFetch forwards /ws into the Durable Object that owns the requested
// serverId, and answers /health without waking an object.
func handleFetch(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path == "/health" {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	}
	serverID := strings.TrimSpace(req.URL.Query().Get("serverId"))
	if serverID == "" {
		http.Error(w, "Missing serverId parameter", http.StatusBadRequest)
		return
	}

	ns, err := cloudflare.NewDurableObjectNamespace("RELAY")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	stub, err := ns.Get(ns.IdFromName(serverID))
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
type roomView struct {
	room *room
}

func (v *roomView) Peers(tag string) []relay.Peer {
	v.room.mu.Lock()
	defer v.room.mu.Unlock()
	peers := make([]relay.Peer, 0, len(v.room.peers))
	for _, peer := range v.room.peers {
		if peer.hasTag(tag) {
			peers = append(peers, peer)
		}
	}
	return peers
}

// newPeer adapts one runtime socket to relay.Peer.
func newPeer(conn *cfws.Conn, connectionID string, tags []string) *wsPeer {
	return &wsPeer{conn: conn, connectionID: connectionID, tags: tags}
}

type wsPeer struct {
	conn         *cfws.Conn
	connectionID string
	tags         []string

	// closeOnce guards Close. A peer is closed from two places — the router
	// closing a replaced connection, and the read loop tearing down after it
	// returns — and worker's Conn.Close releases the js.Func listeners every
	// time it is called, so a second call throws "call to released function".
	closeOnce sync.Once
}

// hasTag reports whether the peer was registered under tag. The room keeps the
// tags in memory rather than asking the runtime, because a non-hibernating
// socket has no tag list to ask.
func (p *wsPeer) hasTag(tag string) bool {
	for _, candidate := range p.tags {
		if candidate == tag {
			return true
		}
	}
	return false
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
