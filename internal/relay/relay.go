package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/webui"
)

const (
	LegacyVersion     = "1"
	CurrentVersion    = "2"
	MaxBufferedFrames = 200
)

type rawFrame struct {
	msgType websocket.MessageType
	data    []byte
}

type peerConn struct {
	ws           *websocket.Conn
	serverID     string
	role         string
	version      string
	connectionID string
	writeMu      sync.Mutex
}

func (p *peerConn) send(ctx context.Context, msgType websocket.MessageType, data []byte) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return p.ws.Write(wctx, msgType, data)
}

func (p *peerConn) sendJSON(ctx context.Context, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return p.send(ctx, websocket.MessageText, b)
}

func (p *peerConn) close(code websocket.StatusCode, reason string) {
	_ = p.ws.Close(code, reason)
}

type sessionRoom struct {
	mu            sync.Mutex
	tagged        map[string][]*peerConn
	pendingFrames map[string][]rawFrame
}

func newSessionRoom() *sessionRoom {
	return &sessionRoom{
		tagged:        make(map[string][]*peerConn),
		pendingFrames: make(map[string][]rawFrame),
	}
}

func (r *sessionRoom) add(p *peerConn, tags []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, tag := range tags {
		r.tagged[tag] = append(r.tagged[tag], p)
	}
}

func (r *sessionRoom) remove(p *peerConn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for tag, list := range r.tagged {
		next := list[:0]
		for _, item := range list {
			if item != p {
				next = append(next, item)
			}
		}
		if len(next) == 0 {
			delete(r.tagged, tag)
		} else {
			r.tagged[tag] = next
		}
	}
}

func (r *sessionRoom) get(tag string) []*peerConn {
	r.mu.Lock()
	defer r.mu.Unlock()
	src := r.tagged[tag]
	out := make([]*peerConn, len(src))
	copy(out, src)
	return out
}

func (r *sessionRoom) closeTagged(tag string, code websocket.StatusCode, reason string) {
	for _, p := range r.get(tag) {
		p.close(code, reason)
	}
}

func (r *sessionRoom) listConnectedConnectionIDs() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	seen := make(map[string]struct{})
	var out []string
	for _, p := range r.tagged["client"] {
		if p.role == "client" && p.connectionID != "" {
			if _, ok := seen[p.connectionID]; !ok {
				seen[p.connectionID] = struct{}{}
				out = append(out, p.connectionID)
			}
		}
	}
	if out == nil {
		out = []string{}
	}
	return out
}

func (r *sessionRoom) notifyControls(ctx context.Context, msg any) {
	for _, ctrl := range r.get("server-control") {
		if err := ctrl.sendJSON(ctx, msg); err != nil {
			ctrl.close(websocket.StatusInternalError, "Control send failed")
		}
	}
}

func (r *sessionRoom) bufferFrame(cid string, frame rawFrame) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := append([]byte(nil), frame.data...)
	list := append(r.pendingFrames[cid], rawFrame{msgType: frame.msgType, data: cp})
	if len(list) > MaxBufferedFrames {
		list = list[len(list)-MaxBufferedFrames:]
	}
	r.pendingFrames[cid] = list
}

func (r *sessionRoom) flushFrames(ctx context.Context, cid string, serverPeer *peerConn) {
	r.mu.Lock()
	frames := r.pendingFrames[cid]
	delete(r.pendingFrames, cid)
	r.mu.Unlock()

	for _, f := range frames {
		if err := serverPeer.send(ctx, f.msgType, f.data); err != nil {
			r.bufferFrame(cid, f)
			break
		}
	}
}

func (r *sessionRoom) dropBufferedFrames(cid string) {
	r.mu.Lock()
	delete(r.pendingFrames, cid)
	r.mu.Unlock()
}

// Options configures a Relay HTTP/WebSocket handler.
type Options struct {
	WebDir      string
	WebUI       *webui.Handler
	UpstreamURL string
}

// Server implements the BySpace Relay HTTP and WebSocket protocol (v1 and v2).
type Server struct {
	mu           sync.Mutex
	rooms        map[string]*sessionRoom
	webUI        *webui.Handler
	cutoverProxy http.Handler
}

// NewServer creates a new Relay Server instance.
func NewServer(opts Options) *Server {
	ui := opts.WebUI
	if ui == nil {
		ui = webui.NewHandler(opts.WebDir)
	}
	upstream := strings.TrimSpace(opts.UpstreamURL)
	if upstream == "" {
		upstream = strings.TrimSpace(os.Getenv("BYSPACE_RELAY_UPSTREAM"))
	}
	var proxy http.Handler
	if upstream != "" {
		if target, err := url.Parse(upstream); err == nil && target.Host != "" {
			proxy = httputil.NewSingleHostReverseProxy(target)
		}
	}
	return &Server{
		rooms:        make(map[string]*sessionRoom),
		webUI:        ui,
		cutoverProxy: proxy,
	}
}

func (s *Server) acquireRoom(key string) *sessionRoom {
	s.mu.Lock()
	defer s.mu.Unlock()
	room, ok := s.rooms[key]
	if !ok {
		room = newSessionRoom()
		s.rooms[key] = room
	}
	return room
}

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

// ServeHTTP handles /health, /ws, and optional static web UI routes.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.cutoverProxy != nil {
		s.cutoverProxy.ServeHTTP(w, r)
		return
	}
	if r.URL.Path == "/health" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	}

	if r.URL.Path == "/ws" {
		s.handleWS(w, r)
		return
	}

	if s.webUI != nil && s.webUI.TryServe(w, r) {
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte("Not found"))
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	serverID := strings.TrimSpace(q.Get("serverId"))
	role := strings.TrimSpace(q.Get("role"))
	connID := strings.TrimSpace(q.Get("connectionId"))
	version := resolveVersion(q.Get("v"))

	if role != "server" && role != "client" {
		http.Error(w, "Missing or invalid role parameter", http.StatusBadRequest)
		return
	}
	if serverID == "" {
		http.Error(w, "Missing serverId parameter", http.StatusBadRequest)
		return
	}
	if version == "" {
		http.Error(w, "Invalid v parameter (expected 1 or 2)", http.StatusBadRequest)
		return
	}

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	ws.SetReadLimit(64 * 1024 * 1024)

	roomKey := "relay-v" + version + ":" + serverID
	room := s.acquireRoom(roomKey)

	if version == LegacyVersion {
		s.serveV1(r.Context(), room, ws, serverID, role)
	} else {
		s.serveV2(r.Context(), room, ws, serverID, role, connID)
	}
}

func (s *Server) serveV1(ctx context.Context, room *sessionRoom, ws *websocket.Conn, serverID, role string) {
	room.closeTagged(role, websocket.StatusPolicyViolation, "Replaced by new connection")
	peer := &peerConn{
		ws:       ws,
		serverID: serverID,
		role:     role,
		version:  LegacyVersion,
	}
	room.add(peer, []string{role})
	defer room.remove(peer)

	targetRole := "client"
	if role == "client" {
		targetRole = "server"
	}

	for {
		msgType, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		for _, target := range room.get(targetRole) {
			_ = target.send(ctx, msgType, data)
		}
	}
}

func (s *Server) serveV2(ctx context.Context, room *sessionRoom, ws *websocket.Conn, serverID, role, connID string) {
	resolvedCID := connID
	if role == "client" && resolvedCID == "" {
		resolvedCID = "conn_" + randomID16()
	}
	isServerControl := role == "server" && resolvedCID == ""
	isServerData := role == "server" && resolvedCID != ""

	if isServerControl {
		room.closeTagged("server-control", websocket.StatusPolicyViolation, "Replaced by new connection")
	} else if isServerData {
		room.closeTagged("server:"+resolvedCID, websocket.StatusPolicyViolation, "Replaced by new connection")
	}

	var tags []string
	if role == "client" {
		tags = []string{"client", "client:" + resolvedCID}
	} else if isServerControl {
		tags = []string{"server-control"}
	} else {
		tags = []string{"server", "server:" + resolvedCID}
	}

	peer := &peerConn{
		ws:           ws,
		serverID:     serverID,
		role:         role,
		version:      CurrentVersion,
		connectionID: resolvedCID,
	}
	room.add(peer, tags)
	defer func() {
		room.remove(peer)
		s.handleV2Close(context.Background(), room, peer)
	}()

	if role == "client" {
		room.notifyControls(ctx, map[string]any{
			"type":         "connected",
			"connectionId": resolvedCID,
		})
	}
	if isServerControl {
		_ = peer.sendJSON(ctx, map[string]any{
			"type":          "sync",
			"connectionIds": room.listConnectedConnectionIDs(),
		})
	}
	if isServerData && resolvedCID != "" {
		room.flushFrames(ctx, resolvedCID, peer)
	}

	for {
		msgType, data, err := ws.Read(ctx)
		if err != nil {
			return
		}

		if resolvedCID == "" {
			if msgType == websocket.MessageText {
				var ping struct {
					Type string `json:"type"`
				}
				if json.Unmarshal(data, &ping) == nil && ping.Type == "ping" {
					_ = peer.sendJSON(ctx, map[string]any{
						"type": "pong",
						"ts":   time.Now().UnixMilli(),
					})
				}
			}
			continue
		}

		if role == "client" {
			servers := room.get("server:" + resolvedCID)
			if len(servers) == 0 {
				room.bufferFrame(resolvedCID, rawFrame{msgType: msgType, data: data})
				continue
			}
			for _, srv := range servers {
				_ = srv.send(ctx, msgType, data)
			}
			continue
		}

		for _, cli := range room.get("client:" + resolvedCID) {
			_ = cli.send(ctx, msgType, data)
		}
	}
}

func (s *Server) handleV2Close(ctx context.Context, room *sessionRoom, closed *peerConn) {
	cid := closed.connectionID
	if cid == "" {
		return
	}
	if closed.role == "client" {
		if len(room.get("client:"+cid)) > 0 {
			return
		}
		room.dropBufferedFrames(cid)
		for _, srv := range room.get("server:" + cid) {
			srv.close(websocket.StatusGoingAway, "Client disconnected")
		}
		room.notifyControls(ctx, map[string]any{
			"type":         "disconnected",
			"connectionId": cid,
		})
		return
	}
	if closed.role == "server" {
		for _, cli := range room.get("client:" + cid) {
			cli.close(websocket.StatusServiceRestart, "Server disconnected")
		}
	}
}
