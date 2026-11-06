package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/ByteTrue/byspace/internal/relay"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/tunnel"
)

// observedRelay wraps the real relay and observes its physical server-data sockets. It counts
// encrypted frames at the same boundary at which the hosted relay would bill a Durable Object
// invocation; a daemon-side session cleanup assertion alone would not prove that uploads stopped.
type observedRelay struct {
	*relay.Server

	mu         sync.Mutex
	frames     map[string]int
	active     map[string]int
	changed    chan struct{}
	control    chan struct{}
	controlErr error
	once       sync.Once
}

func newObservedRelay(t *testing.T) (*observedRelay, string) {
	t.Helper()
	observed := &observedRelay{
		frames:  make(map[string]int),
		active:  make(map[string]int),
		changed: make(chan struct{}, 1),
		control: make(chan struct{}),
	}
	observed.Server = relay.NewServer(relay.Options{ObserveFrame: func(conn relay.Connection) {
		if conn.Role() == "server" && conn.ConnectionID() != "" {
			observed.countFrame(conn.ConnectionID())
		}
	}})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if query.Get("role") == "server" && query.Get("connectionId") == "" {
			observed.once.Do(func() { close(observed.control) })
		}
		cid := query.Get("connectionId")
		if r.URL.Path != "/ws" || query.Get("role") != "server" || cid == "" {
			observed.Server.ServeHTTP(w, r)
			return
		}
		observed.track(cid, 1)
		defer observed.track(cid, -1)
		observed.Server.ServeHTTP(w, r)
	}))
	t.Cleanup(ts.Close)
	return observed, "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
}

func (r *observedRelay) track(cid string, delta int) {
	r.mu.Lock()
	r.active[cid] += delta
	r.mu.Unlock()
	select {
	case r.changed <- struct{}{}:
	default:
	}
}

func (r *observedRelay) countFrame(cid string) {
	r.mu.Lock()
	r.frames[cid]++
	r.mu.Unlock()
}

func (r *observedRelay) controlDone(err error) {
	r.mu.Lock()
	r.controlErr = err
	r.mu.Unlock()
	r.once.Do(func() { close(r.control) })
}

func (r *observedRelay) frameCount(cid string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.frames[cid]
}

func (r *observedRelay) waitControlConnected(ctx context.Context) error {
	select {
	case <-r.control:
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.controlErr
	case <-ctx.Done():
		return fmt.Errorf("relay control channel did not connect: %w", ctx.Err())
	}
}

func (r *observedRelay) waitDataSocketClosed(ctx context.Context, cid string) error {
	for {
		r.mu.Lock()
		active := r.active[cid]
		r.mu.Unlock()
		if active == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("relay data socket %s is still active: %w", cid, ctx.Err())
		case <-r.changed:
		}
	}
}

// relayTestClient is a real encrypted v2 client. Tunnel clients use the same transport without
// opening an App view or reporting browser presence.
type relayTestClient struct {
	ws      *websocket.Conn
	session *e2ee.ClientSession
	frames  chan e2ee.Frame
	done    chan struct{}
	err     error
}

func newRelayTestClient(t *testing.T, ctx context.Context, relayURL string, srv *Server, cid string) *relayTestClient {
	t.Helper()
	ws, _, err := websocket.Dial(ctx, relayURL+"?serverId="+srv.ServerID()+"&role=client&v=2&connectionId="+cid, nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &relayTestClient{
		ws:     ws,
		frames: make(chan e2ee.Frame, 256),
		done:   make(chan struct{}),
	}
	keys, err := e2ee.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	transport := &relayTestTransport{ctx: ctx, ws: ws}
	client.session = e2ee.NewClientSession(transport, keys)
	daemonKey, err := e2ee.ImportKey(srv.PublicKeyB64())
	if err != nil {
		t.Fatal(err)
	}
	if err := client.session.Begin(daemonKey); err != nil {
		t.Fatal(err)
	}
	go client.readLoop()
	for !client.session.IsReady() {
		select {
		case <-ctx.Done():
			t.Fatalf("E2EE handshake did not complete: %v", ctx.Err())
		case <-client.done:
			t.Fatalf("remote client closed during E2EE handshake: %v", client.err)
		case <-time.After(time.Millisecond):
		}
	}
	t.Cleanup(func() { ws.CloseNow() })
	return client
}

type relayTestTransport struct {
	ctx context.Context
	ws  *websocket.Conn
}

func (t *relayTestTransport) SendText(text string) error {
	return t.ws.Write(t.ctx, websocket.MessageText, []byte(text))
}

func (t *relayTestTransport) SendBinary(data []byte) error {
	return t.ws.Write(t.ctx, websocket.MessageBinary, data)
}

func (t *relayTestTransport) Close(code int, reason string) error {
	return t.ws.Close(websocket.StatusCode(code), reason)
}

func (c *relayTestClient) readLoop() {
	defer close(c.done)
	for {
		kind, data, err := c.ws.Read(context.Background())
		if err != nil {
			c.err = err
			return
		}
		plain, err := c.session.Receive(e2ee.Frame{Data: data, IsBinary: kind == websocket.MessageBinary})
		if err != nil {
			c.err = err
			return
		}
		if plain != nil {
			c.frames <- *plain
		}
	}
}

func (c *relayTestClient) close(t *testing.T, ctx context.Context) {
	t.Helper()
	_ = c.ws.Close(websocket.StatusNormalClosure, "test complete")
	select {
	case <-c.done:
	case <-ctx.Done():
		t.Fatalf("remote client did not close: %v", ctx.Err())
	}
}

func (c *relayTestClient) send(ctx context.Context, value any, binary bool) error {
	var data []byte
	var err error
	if binary {
		data = value.([]byte)
	} else {
		data, err = json.Marshal(value)
		if err != nil {
			return err
		}
	}
	return c.session.Send(e2ee.Frame{Data: data, IsBinary: binary})
}

type relaySessionMessage struct {
	typeName string
	payload  map[string]any
}

func decodeRelaySession(frame e2ee.Frame) (relaySessionMessage, bool) {
	var envelope struct {
		Type    string `json:"type"`
		Message struct {
			Type    string         `json:"type"`
			Payload map[string]any `json:"payload"`
		} `json:"message"`
	}
	if frame.IsBinary || json.Unmarshal(frame.Data, &envelope) != nil || envelope.Type != "session" {
		return relaySessionMessage{}, false
	}
	return relaySessionMessage{typeName: envelope.Message.Type, payload: envelope.Message.Payload}, true
}

func (c *relayTestClient) nextSession(ctx context.Context, typeName string) (relaySessionMessage, error) {
	for {
		select {
		case <-ctx.Done():
			return relaySessionMessage{}, fmt.Errorf("waiting for %s: %w", typeName, ctx.Err())
		case <-c.done:
			return relaySessionMessage{}, fmt.Errorf("remote client closed while waiting for %s: %v", typeName, c.err)
		case frame := <-c.frames:
			message, ok := decodeRelaySession(frame)
			if ok && message.typeName == typeName {
				return message, nil
			}
		}
	}
}

func (c *relayTestClient) hello(t *testing.T, ctx context.Context, clientID string) {
	t.Helper()
	if err := c.send(ctx, map[string]any{
		"type": "hello", "clientId": clientID, "protocolVersion": WSProtocolVersion,
	}, false); err != nil {
		t.Fatal(err)
	}
	if _, err := c.nextSession(ctx, "status"); err != nil {
		t.Fatal(err)
	}
}

func (c *relayTestClient) request(t *testing.T, ctx context.Context, typeName string, payload map[string]any) map[string]any {
	t.Helper()
	if err := c.send(ctx, map[string]any{"type": "session", "message": payloadWithType(typeName, payload)}, false); err != nil {
		t.Fatal(err)
	}
	for {
		message, err := c.nextSession(ctx, typeName[:len(typeName)-len("_request")]+"_response")
		if err != nil {
			t.Fatal(err)
		}
		if message.payload["requestId"] == payload["requestId"] {
			return message.payload
		}
	}
}

func payloadWithType(typeName string, payload map[string]any) map[string]any {
	message := make(map[string]any, len(payload)+1)
	for key, value := range payload {
		message[key] = value
	}
	message["type"] = typeName
	return message
}

func startObservedDaemon(t *testing.T, opts Options) (*Server, *observedRelay, string, context.Context, context.CancelFunc) {
	t.Helper()
	if opts.HomeDir == "" {
		opts.HomeDir = filepath.Join(t.TempDir(), "home")
	}
	if opts.Version == "" {
		opts.Version = "relay-lifecycle-test"
	}
	srv, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	observed, relayURL := newObservedRelay(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	go func() { observed.controlDone(srv.ConnectRelay(ctx, relayURL)) }()
	if err := observed.waitControlConnected(ctx); err != nil {
		t.Fatal(err)
	}
	return srv, observed, relayURL, ctx, cancel
}

func localRequest(t *testing.T, ctx context.Context, ws *websocket.Conn, typeName string, payload map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"type": "session", "message": payloadWithType(typeName, payload)})
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.Write(ctx, websocket.MessageText, raw); err != nil {
		t.Fatal(err)
	}
	wantResponse := typeName[:len(typeName)-len("_request")] + "_response"
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for local %s: %v", wantResponse, err)
		}
		frame := e2ee.Frame{Data: data}
		message, ok := decodeRelaySession(frame)
		if ok && message.typeName == wantResponse && message.payload["requestId"] == payload["requestId"] {
			return message.payload
		}
	}
}

func newLocalTestClient(t *testing.T, ctx context.Context, srv *Server) *websocket.Conn {
	t.Helper()
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.CloseNow() })
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"local","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")
	return ws
}

func waitRemoteTerminalText(ctx context.Context, client *relayTestClient, want string) (string, error) {
	var output strings.Builder
	for !strings.Contains(output.String(), want) {
		select {
		case <-ctx.Done():
			return output.String(), ctx.Err()
		case <-client.done:
			return output.String(), fmt.Errorf("remote closed: %v", client.err)
		case frame := <-client.frames:
			if !frame.IsBinary {
				continue
			}
			decoded, err := terminal.DecodeFrame(frame.Data)
			if err == nil && decoded.Opcode == terminal.OpcodeOutput {
				output.Write(decoded.Payload)
			}
		}
	}
	return output.String(), nil
}

func waitLocalTerminalText(ctx context.Context, ws *websocket.Conn, want string) (string, error) {
	var output strings.Builder
	for !strings.Contains(output.String(), want) {
		kind, data, err := ws.Read(ctx)
		if err != nil {
			return output.String(), err
		}
		if kind != websocket.MessageBinary {
			continue
		}
		decoded, err := terminal.DecodeFrame(data)
		if err == nil && decoded.Opcode == terminal.OpcodeOutput {
			output.Write(decoded.Payload)
		}
	}
	return output.String(), nil
}

func TestRelayAgentRunsOfflineAndReconnectsFromTimelineCursor(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake Pi uses /bin/sh")
	}
	tmp := t.TempDir()
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, observed, relayURL, ctx, cancel := startObservedDaemon(t, Options{
		HomeDir: filepath.Join(tmp, "home"), PiCommand: writeFakePiScript(t, tmp),
	})
	defer cancel()
	local := newLocalTestClient(t, ctx, srv)

	raw, err := json.Marshal(map[string]any{"type": "session", "message": map[string]any{
		"type": "create_agent_request", "requestId": "create", "initialPrompt": "first",
		"config": map[string]any{"provider": "pi", "cwd": workDir},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := local.Write(ctx, websocket.MessageText, raw); err != nil {
		t.Fatal(err)
	}
	created := readUntilSessionType(t, ctx, local, "status", "agent_created")
	agentID, _ := created["agentId"].(string)
	if agentID == "" {
		t.Fatalf("create response has no agent: %+v", created)
	}
	finished := localRequest(t, ctx, local, "wait_for_finish_request", map[string]any{
		"requestId": "wait-first", "agentId": agentID, "timeoutMs": 3000,
	})
	if finished["status"] != "idle" {
		t.Fatalf("first turn did not finish: %+v", finished)
	}

	first := newRelayTestClient(t, ctx, relayURL, srv, "agent-first")
	first.hello(t, ctx, "remote-first")
	initial := first.request(t, ctx, "fetch_agent_timeline_request", map[string]any{
		"requestId": "timeline-first", "agentId": agentID,
	})
	initialEntries, _ := initial["entries"].([]any)
	if len(initialEntries) != 3 {
		t.Fatalf("initial timeline = %+v, want user/reasoning/assistant", initialEntries)
	}
	endCursor, _ := initial["endCursor"].(map[string]any)
	first.close(t, ctx)
	if err := observed.waitDataSocketClosed(ctx, "agent-first"); err != nil {
		t.Fatal(err)
	}

	localRequest(t, ctx, local, "send_agent_message_request", map[string]any{
		"requestId": "send-second", "agentId": agentID, "text": "second",
	})
	finished = localRequest(t, ctx, local, "wait_for_finish_request", map[string]any{
		"requestId": "wait-second", "agentId": agentID, "timeoutMs": 3000,
	})
	if finished["status"] != "idle" {
		t.Fatalf("offline turn did not finish: %+v", finished)
	}
	if got := observed.frameCount("agent-first"); got == 0 {
		t.Fatal("test did not observe any first-client frames")
	}
	if got := observed.frameCount("agent-second"); got != 0 {
		t.Fatalf("offline agent produced %d relay frames without a remote data socket", got)
	}

	second := newRelayTestClient(t, ctx, relayURL, srv, "agent-second")
	second.hello(t, ctx, "remote-second")
	after := second.request(t, ctx, "fetch_agent_timeline_request", map[string]any{
		"requestId": "timeline-after", "agentId": agentID, "direction": "after", "cursor": endCursor,
	})
	if after["gap"] != false || after["staleCursor"] != false || after["reset"] != false {
		t.Fatalf("cursor did not recover cleanly: %+v", after)
	}
	entries, _ := after["entries"].([]any)
	if len(entries) != 3 {
		t.Fatalf("after-cursor entries = %+v, want exactly the second turn", entries)
	}
	previous := int(endCursor["seq"].(float64))
	for _, raw := range entries {
		entry := raw.(map[string]any)
		start, end := int(entry["seqStart"].(float64)), int(entry["seqEnd"].(float64))
		if start != previous+1 || end < start {
			t.Fatalf("timeline sequence is duplicated or has a gap after %d: %+v", previous, entry)
		}
		previous = end
	}
	second.close(t, ctx)
	if err := observed.waitDataSocketClosed(ctx, "agent-second"); err != nil {
		t.Fatal(err)
	}
}

func TestRelayTerminalStopsAfterLastClientWithoutStoppingLocal(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a POSIX shell")
	}
	srv, observed, relayURL, ctx, cancel := startObservedDaemon(t, Options{})
	defer cancel()
	local := newLocalTestClient(t, ctx, srv)
	created := localRequest(t, ctx, local, "create_terminal_request", map[string]any{
		"requestId": "terminal-create", "command": "/bin/sh", "args": []string{
			"-c", `while IFS= read -r line; do printf 'tick:%s\n' "$line"; done`,
		},
	})
	terminalInfo, _ := created["terminal"].(map[string]any)
	terminalID, _ := terminalInfo["id"].(string)
	if terminalID == "" {
		t.Fatalf("terminal was not created: %+v", created)
	}
	localSubscribed := localRequest(t, ctx, local, "subscribe_terminal_request", map[string]any{
		"requestId": "local-subscribe", "terminalId": terminalID, "restore": map[string]any{"mode": "live"},
	})
	slot := uint8(localSubscribed["slot"].(float64))

	first := newRelayTestClient(t, ctx, relayURL, srv, "terminal-first")
	first.hello(t, ctx, "terminal-first")
	first.request(t, ctx, "subscribe_terminal_request", map[string]any{
		"requestId": "remote-subscribe-1", "terminalId": terminalID, "restore": map[string]any{"mode": "live"},
	})
	second := newRelayTestClient(t, ctx, relayURL, srv, "terminal-second")
	second.hello(t, ctx, "terminal-second")
	second.request(t, ctx, "subscribe_terminal_request", map[string]any{
		"requestId": "remote-subscribe-2", "terminalId": terminalID, "restore": map[string]any{"mode": "live"},
	})
	writeInput := func(text string) {
		t.Helper()
		if err := local.Write(ctx, websocket.MessageBinary, terminal.EncodeFrame(terminal.OpcodeInput, slot, []byte(text))); err != nil {
			t.Fatal(err)
		}
	}
	writeInput("one\n")
	if _, err := waitRemoteTerminalText(ctx, first, "tick:one"); err != nil {
		t.Fatal(err)
	}
	if _, err := waitRemoteTerminalText(ctx, second, "tick:one"); err != nil {
		t.Fatal(err)
	}

	first.close(t, ctx)
	if err := observed.waitDataSocketClosed(ctx, "terminal-first"); err != nil {
		t.Fatal(err)
	}
	writeInput("two\n")
	if _, err := waitRemoteTerminalText(ctx, second, "tick:two"); err != nil {
		t.Fatal(err)
	}

	second.close(t, ctx)
	if err := observed.waitDataSocketClosed(ctx, "terminal-second"); err != nil {
		t.Fatal(err)
	}
	before := observed.frameCount("terminal-second")
	writeInput("three\n")
	if _, err := waitLocalTerminalText(ctx, local, "tick:three"); err != nil {
		t.Fatalf("local terminal stopped with the last remote client: %v", err)
	}
	if got := observed.frameCount("terminal-second"); got != before {
		t.Fatalf("relay received %d business frames after the last client left", got-before)
	}
	if got := observed.frameCount("terminal-reconnected"); got != 0 {
		t.Fatalf("local-only terminal output produced %d relay frames", got)
	}

	reconnected := newRelayTestClient(t, ctx, relayURL, srv, "terminal-reconnected")
	reconnected.hello(t, ctx, "terminal-reconnected")
	reconnected.request(t, ctx, "subscribe_terminal_request", map[string]any{
		"requestId": "remote-subscribe-3", "terminalId": terminalID, "restore": map[string]any{"mode": "live"},
	})
	replayed, err := waitRemoteTerminalText(ctx, reconnected, "tick:three")
	if err != nil {
		t.Fatal(err)
	}
	one, two, three := strings.Index(replayed, "tick:one"), strings.Index(replayed, "tick:two"), strings.Index(replayed, "tick:three")
	if one < 0 || two <= one || three <= two {
		t.Fatalf("terminal replay is incomplete or out of order: %q", replayed)
	}
	reconnected.close(t, ctx)
}

func TestRelayTunnelForwardsWithoutAnAppSession(t *testing.T) {
	port, stop := startEchoPort(t)
	defer stop()
	srv, _, relayURL, ctx, cancel := startObservedDaemon(t, Options{})
	defer cancel()
	srv.mu.Lock()
	srv.tunnelsEnabled = true
	srv.mu.Unlock()
	if err := srv.store.SetDaemonPasswordHash("$2a$12$abcdefghijklmnopqrstuv"); err != nil {
		t.Fatal(err)
	}
	srv.store.SaveDaemonConfig(map[string]any{"tunnel": map[string]any{"enabled": true, "allowedPorts": []any{port}}})
	srv.ApplyTunnelConfig()

	peer := newRelayTestClient(t, ctx, relayURL, srv, "tunnel-peer")
	peer.hello(t, ctx, "daemon-tunnel-peer")
	open, err := tunnel.EncodeFrame(tunnel.OpcodeOpen, "stream-1", tunnel.EncodeOpenPayload(port))
	if err != nil {
		t.Fatal(err)
	}
	if err := peer.send(ctx, open, true); err != nil {
		t.Fatal(err)
	}
	nextTunnelFrame := func() tunnel.Frame {
		t.Helper()
		for {
			select {
			case <-ctx.Done():
				t.Fatalf("waiting for tunnel response: %v", ctx.Err())
			case <-peer.done:
				t.Fatalf("tunnel peer closed: %v", peer.err)
			case frame := <-peer.frames:
				if frame.IsBinary {
					if decoded, ok := tunnel.DecodeFrame(frame.Data); ok {
						return decoded
					}
				}
			}
		}
	}
	ack := nextTunnelFrame()
	allowed, reason, ok := tunnel.DecodeOpenAck(ack.Payload)
	if ack.Opcode != tunnel.OpcodeOpenAck || !ok || !allowed {
		t.Fatalf("tunnel open failed: frame=%+v reason=%q", ack, reason)
	}
	upstream, err := tunnel.EncodeFrame(tunnel.OpcodeDataUpstream, "stream-1", []byte("through-relay"))
	if err != nil {
		t.Fatal(err)
	}
	if err := peer.send(ctx, upstream, true); err != nil {
		t.Fatal(err)
	}
	downstream := nextTunnelFrame()
	if downstream.Opcode != tunnel.OpcodeDataDownstream || string(downstream.Payload) != "through-relay" {
		t.Fatalf("unexpected tunnel downstream frame: %+v", downstream)
	}
	peer.close(t, ctx)
}
