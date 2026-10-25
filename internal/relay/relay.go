package relay

import (
	"context"
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

// Options configures a Relay HTTP/WebSocket handler.
type Options struct {
	WebDir      string
	WebUI       *webui.Handler
	UpstreamURL string
}

// Server implements the BySpace Relay HTTP and WebSocket protocol (v1 and v2)
// on top of a plain Go HTTP server.
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
	conn, problem := NewConnection(r.URL.Query())
	if problem != "" {
		http.Error(w, problem, http.StatusBadRequest)
		return
	}

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	ws.SetReadLimit(64 * 1024 * 1024)

	room := s.acquireRoom(conn.RoomKey())
	peer := &peerConn{ws: ws, conn: conn}
	router := Router{}

	router.BeforeRegister(room, conn)
	room.add(peer, conn.Tags())
	defer func() {
		room.remove(peer)
		router.Disconnected(context.Background(), room, room.frames, conn)
	}()

	router.Connected(r.Context(), room, room.frames, peer, conn)

	for {
		msgType, data, err := ws.Read(r.Context())
		if err != nil {
			return
		}
		router.Message(r.Context(), room, room.frames, peer, conn, fromWebsocketType(msgType), data)
	}
}

// peerConn adapts a coder/websocket connection to the transport-neutral Peer
// the routing code works with.
type peerConn struct {
	ws      *websocket.Conn
	conn    Connection
	writeMu sync.Mutex
}

func (p *peerConn) Send(ctx context.Context, mt MessageType, data []byte) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return p.ws.Write(wctx, toWebsocketType(mt), data)
}

func (p *peerConn) Close(code StatusCode, reason string) {
	_ = p.ws.Close(websocket.StatusCode(code), reason)
}

func (p *peerConn) ConnectionID() string {
	return p.conn.ConnectionID()
}

// sessionRoom is the in-memory Room used by the Go server build.
type sessionRoom struct {
	mu     sync.Mutex
	tagged map[string][]Peer
	frames *frameBuffer
}

func newSessionRoom() *sessionRoom {
	return &sessionRoom{
		tagged: make(map[string][]Peer),
		frames: newFrameBuffer(),
	}
}

func (r *sessionRoom) add(p Peer, tags []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, tag := range tags {
		r.tagged[tag] = append(r.tagged[tag], p)
	}
}

func (r *sessionRoom) remove(p Peer) {
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

func (r *sessionRoom) Peers(tag string) []Peer {
	r.mu.Lock()
	defer r.mu.Unlock()
	src := r.tagged[tag]
	out := make([]Peer, len(src))
	copy(out, src)
	return out
}

func toWebsocketType(mt MessageType) websocket.MessageType {
	if mt == MessageBinary {
		return websocket.MessageBinary
	}
	return websocket.MessageText
}

func fromWebsocketType(mt websocket.MessageType) MessageType {
	if mt == websocket.MessageBinary {
		return MessageBinary
	}
	return MessageText
}
