package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// CurrentVersion is the relay protocol version: one control channel plus one
	// data channel per client connection. The relay rejects every other value,
	// including an absent one, so a stale client fails loudly instead of being
	// routed as a data socket.
	CurrentVersion = "2"
	// MaxBufferedFrames caps the frames held for a daemon that is not connected.
	MaxBufferedFrames = 200
	// MaxBufferedBytesPerConn caps the bytes held for one offline connection. The frame count cap
	// alone does not bound memory: a frame can be up to the 64MiB read limit, so 200 of them is
	// gigabytes. Frames are evicted oldest-first to stay under this, and a single frame larger than
	// the whole budget is dropped (the offline buffer is best effort).
	MaxBufferedBytesPerConn = 4 << 20
	// MaxBufferedBytesTotal is the hard ceiling for one room's offline buffer. The hosted relay runs
	// in a 128MiB Durable Object, so the buffer must leave room for sockets and heap; one client
	// flooding bytes while its daemon is offline must not exhaust it.
	MaxBufferedBytesTotal = 32 << 20
	// MaxBufferedConns caps how many distinct connections a room buffers for. Without it a client
	// could open endless connections, each holding a few bytes, and grow the map without bound.
	MaxBufferedConns = 256
	// MaxRoomConns caps live sockets one room holds on the self-hosted Go relay. Each socket is a
	// read goroutine plus a write mutex, so an unbounded room is a resource-exhaustion vector. The
	// hosted relay bounds this per Durable Object instead; this is the Go server's own ceiling.
	MaxRoomConns = 512
)

// Router holds the transport-independent relay behaviour. It carries no state:
// everything it needs arrives per call, because the Cloudflare Workers build
// gets a fresh instance per request trigger.
type Router struct{}

func randomID16() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// MessageType mirrors the WebSocket message kinds the relay forwards. It is
// deliberately the relay's own type rather than coder/websocket's: the same
// routing code has to run on the Go server build and on the Cloudflare
// Workers build, and only the transport adapter should know which library is
// underneath.
type MessageType int

const (
	MessageText MessageType = iota + 1
	MessageBinary
)

// StatusCode is a WebSocket close code.
type StatusCode int

const (
	// StatusNormalClosure closes without a reason.
	StatusNormalClosure StatusCode = 1000
	// StatusGoingAway closes a peer whose counterpart disconnected.
	StatusGoingAway StatusCode = 1001
	// StatusPolicyViolation closes a peer that a newer connection replaced.
	StatusPolicyViolation StatusCode = 1008
	// StatusInternalError closes a peer the relay could no longer write to.
	StatusInternalError StatusCode = 1011
	// StatusServiceRestart closes a client because its daemon went away.
	StatusServiceRestart StatusCode = 1012
	// StatusTryAgainLater asks a client to use its reconnect backoff, not retry in a tight loop.
	StatusTryAgainLater StatusCode = 1013
)

// Peer is one connection as the routing code sees it.
type Peer interface {
	// Send writes one frame to the connection.
	Send(ctx context.Context, mt MessageType, data []byte) error
	// Close ends the connection. It must be safe to call more than once.
	Close(code StatusCode, reason string)
	// ConnectionID is the connection this peer carries on a data socket, or ""
	// for the control channel.
	ConnectionID() string
}

// Room resolves the peers a tag currently points at. On the Go server the
// implementation is an in-memory map; inside a Durable Object it is the
// runtime's own WebSocket registry.
type Room interface {
	Peers(tag string) []Peer
}

// connMeta is everything the routing code needs to know about one connection.
type connMeta struct {
	ServerID     string
	Role         string
	ConnectionID string
}

// ServerControl reports whether this connection is the control channel.
func (m connMeta) ServerControl() bool {
	return m.Role == "server" && m.ConnectionID == ""
}

// ServerData reports whether this connection is a server data channel.
func (m connMeta) ServerData() bool {
	return m.Role == "server" && m.ConnectionID != ""
}

// parseWSQuery validates a /ws query string. It returns the parsed metadata
// and, on failure, the message the caller should answer with.
func parseWSQuery(q url.Values) (connMeta, string) {
	meta := connMeta{
		ServerID:     strings.TrimSpace(q.Get("serverId")),
		Role:         strings.TrimSpace(q.Get("role")),
		ConnectionID: strings.TrimSpace(q.Get("connectionId")),
	}

	if meta.Role != "server" && meta.Role != "client" {
		return meta, "Missing or invalid role parameter"
	}
	if meta.ServerID == "" {
		return meta, "Missing serverId parameter"
	}
	if strings.TrimSpace(q.Get("v")) != CurrentVersion {
		return meta, "Invalid v parameter (expected 2)"
	}
	if meta.Role == "client" && meta.ConnectionID == "" {
		meta.ConnectionID = "conn_" + randomID16()
	}
	return meta, ""
}

// closeReplaced closes whichever connection this new one supersedes. It must
// run before the new peer is registered, or it would close itself.
func (Router) closeReplaced(room Room, meta connMeta) {
	if meta.ServerControl() {
		closeTagged(room, "server-control", StatusPolicyViolation, "Replaced by new connection")
		return
	}
	if meta.ServerData() {
		closeTagged(room, "server:"+meta.ConnectionID, StatusPolicyViolation, "Replaced by new connection")
	}
}

// connected runs the bookkeeping a freshly registered peer needs: tell the
// control channel about a new client, hand a control channel the current
// roster, and replay anything buffered while a daemon was disconnected.
func (Router) connected(ctx context.Context, room Room, buf *frameBuffer, self Peer, meta connMeta) {
	if meta.Role == "client" {
		notifyControls(ctx, room, map[string]any{
			"type":         "connected",
			"connectionId": meta.ConnectionID,
		})
	}
	if meta.ServerControl() {
		_ = sendJSON(ctx, self, map[string]any{
			"type":          "sync",
			"connectionIds": listConnectionIDs(room),
		})
	}
	if meta.ServerData() {
		flushFrames(ctx, room, buf, meta.ConnectionID, self)
	}
}

// frame routes one inbound frame. It is the whole of the relay's per-message
// behaviour, shared by the blocking read loop on the server and by the
// per-message trigger inside a Durable Object.
func (Router) frame(ctx context.Context, room Room, buf *frameBuffer, self Peer, meta connMeta, mt MessageType, data []byte) {
	if meta.ConnectionID == "" {
		// Only the control channel reaches here; it speaks ping/pong and
		// nothing else.
		if mt == MessageText {
			var ping struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(data, &ping) == nil && ping.Type == "ping" {
				_ = sendJSON(ctx, self, map[string]any{
					"type": "pong",
					"ts":   time.Now().UnixMilli(),
				})
			}
		}
		return
	}

	if meta.Role == "client" {
		servers := room.Peers("server:" + meta.ConnectionID)
		if len(servers) == 0 {
			buf.add(meta.ConnectionID, mt, data)
			return
		}
		for _, srv := range servers {
			_ = srv.Send(ctx, mt, data)
		}
		return
	}

	for _, cli := range room.Peers("client:" + meta.ConnectionID) {
		_ = cli.Send(ctx, mt, data)
	}
}

// disconnected runs the teardown a dropped peer needs.
func (Router) disconnected(ctx context.Context, room Room, buf *frameBuffer, meta connMeta) {
	if meta.ConnectionID == "" {
		return
	}
	if meta.Role == "client" {
		if len(room.Peers("client:"+meta.ConnectionID)) > 0 {
			// Another socket is still carrying this connection.
			return
		}
		buf.drop(meta.ConnectionID)
		for _, srv := range room.Peers("server:" + meta.ConnectionID) {
			srv.Close(StatusGoingAway, "Client disconnected")
		}
		notifyControls(ctx, room, map[string]any{
			"type":         "disconnected",
			"connectionId": meta.ConnectionID,
		})
		return
	}
	if meta.Role == "server" {
		for _, cli := range room.Peers("client:" + meta.ConnectionID) {
			cli.Close(StatusServiceRestart, "Server disconnected")
		}
	}
}

func closeTagged(room Room, tag string, code StatusCode, reason string) {
	for _, peer := range room.Peers(tag) {
		peer.Close(code, reason)
	}
}

func notifyControls(ctx context.Context, room Room, msg any) {
	for _, ctrl := range room.Peers("server-control") {
		if err := sendJSON(ctx, ctrl, msg); err != nil {
			ctrl.Close(StatusInternalError, "Control send failed")
		}
	}
}

func sendJSON(ctx context.Context, peer Peer, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return peer.Send(ctx, MessageText, b)
}

func listConnectionIDs(room Room) []string {
	seen := make(map[string]struct{})
	out := []string{}
	for _, peer := range room.Peers("client") {
		cid := peer.ConnectionID()
		if cid == "" {
			continue
		}
		if _, ok := seen[cid]; ok {
			continue
		}
		seen[cid] = struct{}{}
		out = append(out, cid)
	}
	return out
}

// rawFrame is one buffered frame.
type rawFrame struct {
	mt   MessageType
	data []byte
}

// frameBuffer holds frames a client sent while its daemon was disconnected,
// so the daemon can replay them once it reconnects. It is deliberately
// in-memory only: the hosted relay has always treated it as best effort, and
// persisting it would change nothing a client can observe beyond surviving
// an eviction.
type frameBuffer struct {
	mu     sync.Mutex
	frames map[string][]rawFrame
	bytes  map[string]int
	total  int
}

func newFrameBuffer() *frameBuffer {
	return &frameBuffer{
		frames: make(map[string][]rawFrame),
		bytes:  make(map[string]int),
	}
}

func (b *frameBuffer) add(cid string, mt MessageType, data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()

	size := len(data)
	if size > MaxBufferedBytesPerConn {
		// One frame bigger than a whole connection's budget can never be held.
		return
	}
	if _, ok := b.frames[cid]; !ok && len(b.frames) >= MaxBufferedConns {
		// The map is full. Evict one connection to make room rather than grow without bound.
		for victim := range b.frames {
			b.dropLocked(victim)
			break
		}
	}

	// Append, then evict oldest-first until this connection fits its frame and byte budgets. The
	// new frame alone is within budget, so at least it survives. Survivors are copied to a fresh
	// slice: re-slicing the tail would keep the evicted frames alive in the backing array and the
	// byte budget would not bound real memory.
	list := append(b.frames[cid], rawFrame{mt: mt, data: append([]byte(nil), data...)})
	connBytes := b.bytes[cid] + size
	if len(list) > MaxBufferedFrames || connBytes > MaxBufferedBytesPerConn {
		start := 0
		for len(list)-start > MaxBufferedFrames || connBytes > MaxBufferedBytesPerConn {
			connBytes -= len(list[start].data)
			start++
		}
		kept := make([]rawFrame, len(list)-start)
		copy(kept, list[start:])
		list = kept
	}
	b.total += connBytes - b.bytes[cid]
	b.frames[cid] = list
	b.bytes[cid] = connBytes

	// Room ceiling: drop whole connections until the total fits. Best effort — the buffer only
	// smooths a brief daemon blip, so under memory pressure any connection may be dropped. A single
	// connection never exceeds the ceiling (its budget is smaller), so this always terminates.
	for b.total > MaxBufferedBytesTotal && len(b.frames) > 0 {
		for victim := range b.frames {
			b.dropLocked(victim)
			break
		}
	}
}

func (b *frameBuffer) take(cid string) []rawFrame {
	b.mu.Lock()
	defer b.mu.Unlock()
	frames := b.frames[cid]
	b.dropLocked(cid)
	return frames
}

func (b *frameBuffer) drop(cid string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.dropLocked(cid)
}

// dropLocked removes a connection's buffered frames. The caller holds b.mu.
func (b *frameBuffer) dropLocked(cid string) {
	b.total -= b.bytes[cid]
	delete(b.bytes, cid)
	delete(b.frames, cid)
}

func flushFrames(ctx context.Context, room Room, buf *frameBuffer, cid string, serverPeer Peer) {
	for _, f := range buf.take(cid) {
		if err := serverPeer.Send(ctx, f.mt, f.data); err != nil {
			buf.add(cid, f.mt, f.data)
			break
		}
	}
}

// Connection is one accepted WebSocket as the routing code sees it. A
// transport adapter parses the query string once and hands the result to every
// Router method, so the Cloudflare build (which has no long-lived read loop)
// and the Go server build share the exact same decisions.
type Connection struct {
	meta connMeta
}

// NewConnection validates a /ws query string. problem is non-empty when the
// request must be rejected with it.
func NewConnection(query url.Values) (Connection, string) {
	meta, problem := parseWSQuery(query)
	return Connection{meta: meta}, problem
}

// Role is "server" or "client".
func (c Connection) Role() string { return c.meta.Role }

// ConnectionID is the connection this socket carries on a data socket, or ""
// for the control channel.
func (c Connection) ConnectionID() string { return c.meta.ConnectionID }

// ServerID is the server this socket belongs to. The Durable Object writes it
// onto the socket so a later, post-hibernation instance can rebuild the
// Connection without the original request.
func (c Connection) ServerID() string { return c.meta.ServerID }

// Tags are the Room tags a peer with this connection must be registered under.
func (c Connection) Tags() []string {
	switch {
	case c.meta.Role == "client":
		return []string{"client", "client:" + c.meta.ConnectionID}
	case c.meta.ServerControl():
		return []string{"server-control"}
	default:
		return []string{"server", "server:" + c.meta.ConnectionID}
	}
}

// FrameBuffer holds frames a client sent while its daemon was disconnected.
type FrameBuffer = frameBuffer

// NewFrameBuffer returns the buffer a Room needs to hold frames for a daemon
// that is not currently connected.
func NewFrameBuffer() *FrameBuffer { return newFrameBuffer() }

// BeforeRegister closes whichever connection this one supersedes.
func (r Router) BeforeRegister(room Room, conn Connection) {
	r.closeReplaced(room, conn.meta)
}

// Connected runs the bookkeeping a freshly registered peer needs.
func (r Router) Connected(ctx context.Context, room Room, buf *frameBuffer, self Peer, conn Connection) {
	r.connected(ctx, room, buf, self, conn.meta)
}

// Message routes one inbound frame.
func (r Router) Message(ctx context.Context, room Room, buf *frameBuffer, self Peer, conn Connection, mt MessageType, data []byte) {
	r.frame(ctx, room, buf, self, conn.meta, mt, data)
}

// Disconnected runs the teardown a dropped peer needs.
func (r Router) Disconnected(ctx context.Context, room Room, buf *frameBuffer, conn Connection) {
	r.disconnected(ctx, room, buf, conn.meta)
}

// RoomKey identifies the room a connection belongs to. The version prefix is part of the Durable
// Object name; it is not the wire protocol version. A Durable Object never moves after it is
// created, so bumping the version is the only way to move a room (see RoomKeyVersion), and a bump
// strands the sockets still in the old room until they reconnect.
const RoomKeyVersion = 3

// RoomKey is the Durable Object name for one server's room.
func (c Connection) RoomKey() string {
	return "relay-v" + strconv.Itoa(RoomKeyVersion) + ":" + c.meta.ServerID
}
