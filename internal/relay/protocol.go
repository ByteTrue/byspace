package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	// LegacyVersion is the pre-multiplexing relay protocol: one socket per role.
	LegacyVersion = "1"
	// CurrentVersion multiplexes one control channel plus one data channel per
	// client connection.
	CurrentVersion = "2"
	// MaxBufferedFrames caps the frames held for a daemon that is not connected.
	MaxBufferedFrames = 200
)

// Router holds the transport-independent relay behaviour. It carries no state:
// everything it needs arrives per call, because the Cloudflare Workers build
// gets a fresh instance per request trigger.
type Router struct{}

// resolveVersion validates the `v` query parameter. An absent value means the
// pre-multiplexing protocol.
func resolveVersion(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return LegacyVersion
	}
	if v == LegacyVersion || v == CurrentVersion {
		return v
	}
	return ""
}

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
)

// Peer is one connection as the routing code sees it.
type Peer interface {
	// Send writes one frame to the connection.
	Send(ctx context.Context, mt MessageType, data []byte) error
	// Close ends the connection. It must be safe to call more than once.
	Close(code StatusCode, reason string)
	// ConnectionID is the v2 connection this peer carries, or "" when the
	// peer predates v2 (or is a v2 control channel).
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
	Version      string
	ConnectionID string
}

// ServerControl reports whether this connection is the v2 control channel.
//
// The version check is not redundant with the empty connection id: a v1 server
// socket also has no connection id, because v1 routes purely by role. Without
// it that socket would be handed the control channel's sync roster.
func (m connMeta) ServerControl() bool {
	return m.Version == CurrentVersion && m.Role == "server" && m.ConnectionID == ""
}

// ServerData reports whether this connection is a v2 data channel.
func (m connMeta) ServerData() bool {
	return m.Version == CurrentVersion && m.Role == "server" && m.ConnectionID != ""
}

// parseWSQuery validates a /ws query string. It returns the parsed metadata
// and, on failure, the message the caller should answer with.
func parseWSQuery(q url.Values) (connMeta, string) {
	meta := connMeta{
		ServerID:     strings.TrimSpace(q.Get("serverId")),
		Role:         strings.TrimSpace(q.Get("role")),
		ConnectionID: strings.TrimSpace(q.Get("connectionId")),
	}
	meta.Version = resolveVersion(q.Get("v"))

	if meta.Role != "server" && meta.Role != "client" {
		return meta, "Missing or invalid role parameter"
	}
	if meta.ServerID == "" {
		return meta, "Missing serverId parameter"
	}
	if meta.Version == "" {
		return meta, "Invalid v parameter (expected 1 or 2)"
	}
	if meta.Version == LegacyVersion {
		// v1 has no connection ids; routing is purely by role.
		meta.ConnectionID = ""
		return meta, ""
	}
	if meta.Role == "client" && meta.ConnectionID == "" {
		meta.ConnectionID = "conn_" + randomID16()
	}
	return meta, ""
}

// closeReplaced closes whichever connection this new one supersedes. It must
// run before the new peer is registered, or it would close itself.
func (Router) closeReplaced(room Room, meta connMeta) {
	if meta.Version == LegacyVersion {
		closeTagged(room, meta.Role, StatusPolicyViolation, "Replaced by new connection")
		return
	}
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
	if meta.Version == LegacyVersion {
		// v1 opens with no bookkeeping at all: no roster, no presence
		// notifications, nothing to replay. Its frames route by role only.
		return
	}
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
	if meta.Version == LegacyVersion {
		target := "client"
		if meta.Role == "client" {
			target = "server"
		}
		for _, peer := range room.Peers(target) {
			_ = peer.Send(ctx, mt, data)
		}
		return
	}

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
	if meta.Version == LegacyVersion || meta.ConnectionID == "" {
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
}

func newFrameBuffer() *frameBuffer {
	return &frameBuffer{frames: make(map[string][]rawFrame)}
}

func (b *frameBuffer) add(cid string, mt MessageType, data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	list := append(b.frames[cid], rawFrame{mt: mt, data: append([]byte(nil), data...)})
	if len(list) > MaxBufferedFrames {
		list = list[len(list)-MaxBufferedFrames:]
	}
	b.frames[cid] = list
}

func (b *frameBuffer) take(cid string) []rawFrame {
	b.mu.Lock()
	defer b.mu.Unlock()
	frames := b.frames[cid]
	delete(b.frames, cid)
	return frames
}

func (b *frameBuffer) drop(cid string) {
	b.mu.Lock()
	defer b.mu.Unlock()
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

// ConnectionID is the v2 connection this socket carries, or "" for v1 sockets
// and for the v2 control channel.
func (c Connection) ConnectionID() string { return c.meta.ConnectionID }

// ServerID is the server this socket belongs to. The Durable Object writes it
// onto the socket so a later, post-hibernation instance can rebuild the
// Connection without the original request.
func (c Connection) ServerID() string { return c.meta.ServerID }

// Version is "1" or "2", the relay protocol the socket speaks.
func (c Connection) Version() string { return c.meta.Version }

// Tags are the Room tags a peer with this connection must be registered under.
func (c Connection) Tags() []string {
	if c.meta.Version == LegacyVersion {
		return []string{c.meta.Role}
	}
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

// RoomKey identifies the room a connection belongs to. Protocol version is part
// of the key because v1 and v2 sockets must never see each other.
func (c Connection) RoomKey() string {
	return "relay-v" + c.meta.Version + ":" + c.meta.ServerID
}
