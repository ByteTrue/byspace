package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/webui"
	"github.com/ByteTrue/byspace/internal/workspace"
)

const WSProtocolVersion = 1

// WebSocket close codes, matching archive/.../websocket-server.ts so a client that
// distinguishes "took too long to say hello" from "version mismatch" keeps working.
const (
	wsCloseHelloTimeout      = 4001
	wsCloseInvalidHello      = 4002
	wsCloseIncompatibleProto = 4003
	wsCloseServerShutdown    = 1001
	wsHelloTimeout           = 15 * time.Second
)

var ownerPermissions = []string{
	"daemon.read",
	"daemon.manage",
	"tunnel.manage",
	"access.manage",
	"workspace.read",
	"workspace.write",
	"workspace.manage",
	"automation.manage",
	"hub.execute",
}

// Options configures the Go BySpace daemon server.
type Options struct {
	HomeDir      string
	Version      string
	WebDir       string
	WebUI        *webui.Handler
	PiCommand    string
	PiSessionDir string
}

type managedPi struct {
	record  store.AgentRecord
	session providers.ManagedSession
	// usageStop closes the in-flight usage sampler for this turn.
	usageStop chan struct{}
}

type downloadTokenEntry struct {
	absPath   string
	fileName  string
	mimeType  string
	size      int64
	expiresAt time.Time
}

type frameSink interface {
	SendText(ctx context.Context, text string) error
	SendBinary(ctx context.Context, data []byte) error
	Close(code websocket.StatusCode, reason string) error
}

type wsSink struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
}

func (w *wsSink) SendText(ctx context.Context, text string) error {
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return w.ws.Write(wctx, websocket.MessageText, []byte(text))
}

func (w *wsSink) SendBinary(ctx context.Context, data []byte) error {
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return w.ws.Write(wctx, websocket.MessageBinary, data)
}

func (w *wsSink) Close(code websocket.StatusCode, reason string) error {
	return w.ws.Close(code, reason)
}

// Server is the unified BySpace HTTP + WebSocket daemon server.
type Server struct {
	homeDir      string
	serverID     string
	version      string
	epoch        string
	keyPair      e2ee.KeyPair
	pubKeyB64    string
	vapidKeys    home.VAPIDKeys
	store        *store.Store
	schedules    *schedule.Service
	webUI        *webui.Handler
	piCommand    string
	piSessionDir string

	mu                sync.Mutex
	agents            map[string]*managedPi
	terminals         map[uint8]*terminal.Session
	terminalSlotsByID map[string]uint8
	downloadTokens    map[string]downloadTokenEntry
	fileSubs          map[string]fileSubscription
	diffSubs          map[string]diffSubscription
	clients           map[frameSink]bool
	pollStop          chan struct{}
	allowedHostnames  []string
	// agentLoads deduplicates concurrent cold-start attempts for one agent.
	agentLoads map[string]*agentLoad
	// terminalUnsubscribers lets a socket detach from terminal output; without it every
	// subscribe leaked a permanent callback.
	terminalUnsubscribers map[frameSink]map[string][]func()
	// lastConfigSnapshot is the config as of the previous reload, so the next reload can say
	// which paths changed.
	lastConfigSnapshot map[string]any
	corsMu             sync.RWMutex
	corsCache          []string
	setupSnapshots     map[string]*setupSnapshot
	workspaceScripts   map[string]*workspaceScript
	scriptPorts        *servicePortAllocator
	idempotentAgents   map[string]string
	cachedPiModels     []pi.CatalogModel
	cachedPiCommands   []pi.SlashCommand
}

// New creates and initializes a BySpace daemon Server rooted at opts.HomeDir.
func New(opts Options) (*Server, error) {
	homeDir, err := home.Resolve(opts.HomeDir)
	if err != nil {
		return nil, err
	}
	serverID, err := home.GetOrCreateServerID(homeDir)
	if err != nil {
		return nil, err
	}
	kp, pubB64, err := home.LoadOrCreateKeyPair(homeDir)
	if err != nil {
		return nil, err
	}
	vapidKeys, _ := home.LoadOrCreateVAPIDKeys(homeDir)
	ver := strings.TrimSpace(opts.Version)
	if ver == "" {
		ver = "0.20.2-go"
	}
	ui := opts.WebUI
	if ui == nil {
		ui = webui.NewHandler(opts.WebDir)
	}
	ui = ui.WithConnectionHint("BySpace")

	st := store.New(homeDir)
	st.SetServerID(serverID)
	// E2E specs assert exact workspace counts, so the daemon-owned Chief workspace must be
	// suppressible: with it present every count shifts by one.
	// Node removes the pre-1.0 `agent-timelines` directory on every boot; it was superseded by
	// provider-owned transcripts. Leaving it behind means old timeline files linger and can be
	// picked up by nothing, but they do consume disk and confuse anyone inspecting the home.
	_ = os.RemoveAll(filepath.Join(homeDir, "agent-timelines"))

	// Existing homes may hold projects persisted before key derivation existed; without a key
	// they cannot join a cross-host group.
	_ = st.BackfillProjectKeys()
	if strings.TrimSpace(os.Getenv("BYSPACE_DISABLE_HOME_WORKSPACE")) != "1" {
		_ = st.EnsureHomeWorkspace(serverID)
	}
	srv := &Server{
		homeDir:               homeDir,
		serverID:              serverID,
		version:               ver,
		epoch:                 fmt.Sprintf("ep_%d", time.Now().UnixMilli()),
		keyPair:               kp,
		pubKeyB64:             pubB64,
		vapidKeys:             vapidKeys,
		store:                 st,
		webUI:                 ui,
		piCommand:             opts.PiCommand,
		piSessionDir:          opts.PiSessionDir,
		agents:                make(map[string]*managedPi),
		terminals:             make(map[uint8]*terminal.Session),
		terminalSlotsByID:     make(map[string]uint8),
		downloadTokens:        make(map[string]downloadTokenEntry),
		setupSnapshots:        make(map[string]*setupSnapshot),
		workspaceScripts:      make(map[string]*workspaceScript),
		scriptPorts:           newServicePortAllocator(),
		agentLoads:            make(map[string]*agentLoad),
		terminalUnsubscribers: make(map[frameSink]map[string][]func()),
		idempotentAgents:      make(map[string]string),
		fileSubs:              make(map[string]fileSubscription),
		diffSubs:              make(map[string]diffSubscription),
		clients:               make(map[frameSink]bool),
		pollStop:              make(chan struct{}),
	}
	// BYSPACE_HOSTNAMES / BYSPACE_ALLOWED_HOSTS accept a comma-separated allow-list, and
	// config.daemon.hostnames takes precedence when present.
	srv.allowedHostnames = resolveAllowedHostnames(st)
	srv.lastConfigSnapshot = srv.daemonConfigSnapshot()
	srv.schedules = schedule.NewService(homeDir, srv.executeScheduledPiRun)
	go func() {
		pctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.probeOrCachedPiModels(pctx)
	}()

	// Nothing else drives file and git-diff subscriptions. Without this loop they are
	// registered and then never fire, so an open editor never sees a file change made by an
	// agent, and the diff panel never refreshes.
	srv.startSubscriptionPoller()
	return srv, nil
}

func (s *Server) ServerID() string     { return s.serverID }
func (s *Server) PublicKeyB64() string { return s.pubKeyB64 }
func (s *Server) HomeDir() string      { return s.homeDir }
func (s *Server) Store() *store.Store  { return s.store }

// Close shuts down any live Pi agent subprocesses and PTY sessions.
func (s *Server) Close() error {
	// Stop the subscription poller before tearing down state it reads.
	select {
	case <-s.pollStop:
	default:
		close(s.pollStop)
	}
	s.mu.Lock()
	agents := make([]*managedPi, 0, len(s.agents))
	for _, a := range s.agents {
		agents = append(agents, a)
	}
	terms := make([]*terminal.Session, 0, len(s.terminals))
	for _, t := range s.terminals {
		terms = append(terms, t)
	}
	sinks := make([]frameSink, 0, len(s.clients))
	for sink := range s.clients {
		sinks = append(sinks, sink)
	}
	s.mu.Unlock()

	// Tell connected clients why the socket is going away before the process exits, so the
	// app shows "host shut down" instead of a silent disconnect it retries forever.
	// Fire and forget: Close writes a frame and blocks if the peer is not reading.
	for _, sink := range sinks {
		go func(sk frameSink) { _ = sk.Close(wsCloseServerShutdown, "Server shutting down") }(sink)
	}

	for _, a := range agents {
		if a.session != nil {
			_ = a.session.Close()
		}
	}
	for _, t := range terms {
		_ = t.Close()
	}
	return nil
}

// ServeHTTP handles /health, /ws, and embedded/external Web UI routes.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// CORS mirrors archive/packages/server/src/server/bootstrap.ts: an allow-list from
	// config.daemon.cors.allowedOrigins plus BYSPACE_CORS_ORIGINS, "*" honouring any
	// origin, and preflight answering 204. The web app is normally same-origin, but
	// cross-origin browser sessions (Metro dev server, hosted PWA against a LAN daemon)
	// are exactly what E2E and self-hosting rely on.
	if s.applyCORS(w, r) {
		return
	}
	// DNS-rebinding guard: a browser page on evil.example that resolves to 127.0.0.1 sends
	// Host: evil.example, which a loopback-only daemon would otherwise accept. Reject any Host
	// that is not loopback, the configured allow-list, or an IP literal.
	if !s.hostAllowed(r.Host) {
		http.Error(w, "Forbidden host", http.StatusForbidden)
		return
	}

	// Password auth. The daemon is reachable from anything that can open a loopback
	// connection, and a relay/tunnel extends that; an operator who sets a password expects it
	// to be enforced. /mcp/agents authenticates itself inside the handler with its capability
	// token, so it is exempt here.
	if path := r.URL.Path; path != "/mcp/agents" && !ShouldBypassBearerAuth(r.Method, path) {
		if hash := s.daemonPasswordHash(); hash != "" {
			token, ok := ExtractHTTPBearerToken(r.Header.Get("Authorization"))
			if !ok || !VerifyDaemonPassword(hash, token) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
				return
			}
		}
	}

	if r.URL.Path == "/health" || r.URL.Path == "/api/health" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":    "ok",
			"serverId":  s.serverID,
			"version":   s.version,
			"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		})
		return
	}

	if r.URL.Path == "/api/status" {
		hostname, _ := os.Hostname()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":   "server_info",
			"serverId": s.serverID,
			"hostname": hostname,
			"version":  s.version,
			"listen":   r.Host,
		})
		return
	}

	if r.URL.Path == "/api/files/download" {
		s.handleHTTPFileDownload(w, r)
		return
	}

	if r.URL.Path == "/api/terminal-activity" {
		s.handleHTTPTerminalActivity(w, r)
		return
	}

	if r.URL.Path == "/api/subagent-report" {
		s.handleHTTPSubagentReport(w, r)
		return
	}

	if r.URL.Path == "/ws" {
		s.handleDirectWS(w, r)
		return
	}

	if r.URL.Path == "/mcp/agents" || strings.HasPrefix(r.URL.Path, "/mcp/") {
		s.handleMCPHTTP(w, r)
		return
	}

	if s.webUI != nil && s.webUI.TryServe(w, r) {
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte("Not found"))
}

func (s *Server) handleDirectWS(w http.ResponseWriter, r *http.Request) {
	// DNS-rebinding guard, on the WebSocket upgrade only — the same place the node daemon
	// applies it (websocket-server.ts). Applying it to every HTTP request breaks the app: the
	// web UI itself and its asset/API fetches are ordinary requests, and rejecting those makes
	// the daemon look disconnected.
	if !s.hostAllowed(r.Host) {
		http.Error(w, "Forbidden host", http.StatusForbidden)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	ws.SetReadLimit(64 * 1024 * 1024)

	sink := &wsSink{ws: ws}
	s.serveSessionOnSink(r.Context(), sink, func(ctx context.Context) (e2ee.Frame, error) {
		msgType, data, err := ws.Read(ctx)
		if err != nil {
			return e2ee.Frame{}, err
		}
		return e2ee.Frame{
			Data:     data,
			IsBinary: msgType == websocket.MessageBinary,
		}, nil
	})
}

// ConnectRelay maintains a v2 server-control connection to a Relay and spawns E2EE
// server-data sessions whenever a client connects.
func (s *Server) ConnectRelay(ctx context.Context, relayWSURL string) error {
	u, err := url.Parse(relayWSURL)
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("serverId", s.serverID)
	q.Set("role", "server")
	q.Set("v", "2")
	u.RawQuery = q.Encode()

	ctrlWS, _, err := websocket.Dial(ctx, u.String(), nil)
	if err != nil {
		return err
	}
	defer ctrlWS.CloseNow()

	// A relay that vanishes without a FIN leaves the socket half-open: `Read` never returns and
	// `Close` never arrives, so the daemon believes it is still reachable while phones time out.
	// Protocol pings detect that, and an unanswered ping for 30s forces a reconnect.
	// Cloudflare answers ping at the edge without waking the hibernated Durable Object, so this
	// does not bill DO CPU.
	pingCtx, stopPing := context.WithCancel(ctx)
	defer stopPing()
	lastSeen := time.Now()
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pingCtx.Done():
				return
			case <-ticker.C:
				if time.Since(lastSeen) > 30*time.Second {
					ctrlWS.CloseNow()
					return
				}
				pctx, cancel := context.WithTimeout(pingCtx, 5*time.Second)
				_ = ctrlWS.Ping(pctx)
				cancel()
			}
		}
	}()

	activeData := make(map[string]context.CancelFunc)
	var dataMu sync.Mutex
	defer func() {
		dataMu.Lock()
		for _, cancel := range activeData {
			cancel()
		}
		dataMu.Unlock()
	}()

	spawnData := func(cid string) {
		if cid == "" {
			return
		}
		dataMu.Lock()
		if prev, ok := activeData[cid]; ok {
			prev()
		}
		dctx, cancel := context.WithCancel(ctx)
		activeData[cid] = cancel
		dataMu.Unlock()

		go func() {
			defer func() {
				dataMu.Lock()
				delete(activeData, cid)
				dataMu.Unlock()
			}()
			_ = s.serveRelayDataConn(dctx, relayWSURL, cid)
		}()
	}

	for {
		_, data, err := ctrlWS.Read(ctx)
		if err != nil {
			return err
		}
		lastSeen = time.Now()
		var evt struct {
			Type          string   `json:"type"`
			ConnectionID  string   `json:"connectionId"`
			ConnectionIDs []string `json:"connectionIds"`
		}
		if json.Unmarshal(data, &evt) != nil {
			continue
		}
		switch evt.Type {
		case "sync":
			for _, cid := range evt.ConnectionIDs {
				spawnData(cid)
			}
		case "connected":
			spawnData(evt.ConnectionID)
		case "disconnected":
			dataMu.Lock()
			if cancel, ok := activeData[evt.ConnectionID]; ok {
				cancel()
				delete(activeData, evt.ConnectionID)
			}
			dataMu.Unlock()
		}
	}
}

type e2eeSinkAdapter struct {
	ctx  context.Context
	raw  *wsSink
	sess *e2ee.DaemonSession
}

func (a *e2eeSinkAdapter) SendText(_ context.Context, text string) error {
	return a.sess.Send(e2ee.Frame{Data: []byte(text), IsBinary: false})
}

func (a *e2eeSinkAdapter) SendBinary(_ context.Context, data []byte) error {
	return a.sess.Send(e2ee.Frame{Data: data, IsBinary: true})
}

func (a *e2eeSinkAdapter) Close(code websocket.StatusCode, reason string) error {
	return a.raw.Close(code, reason)
}

type rawTransportAdapter struct {
	ctx context.Context
	raw *wsSink
}

func (r *rawTransportAdapter) SendText(text string) error {
	return r.raw.SendText(r.ctx, text)
}

func (r *rawTransportAdapter) SendBinary(data []byte) error {
	return r.raw.SendBinary(r.ctx, data)
}

func (r *rawTransportAdapter) Close(code int, reason string) error {
	return r.raw.Close(websocket.StatusCode(code), reason)
}

func (s *Server) serveRelayDataConn(ctx context.Context, relayWSURL, cid string) error {
	u, err := url.Parse(relayWSURL)
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("serverId", s.serverID)
	q.Set("role", "server")
	q.Set("v", "2")
	q.Set("connectionId", cid)
	u.RawQuery = q.Encode()

	ws, _, err := websocket.Dial(ctx, u.String(), nil)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	ws.SetReadLimit(64 * 1024 * 1024)

	rawSink := &wsSink{ws: ws}
	e2eeSess := e2ee.NewDaemonSession(&rawTransportAdapter{ctx: ctx, raw: rawSink}, s.keyPair)
	adapter := &e2eeSinkAdapter{ctx: ctx, raw: rawSink, sess: e2eeSess}

	s.serveSessionOnSink(ctx, adapter, func(rctx context.Context) (e2ee.Frame, error) {
		for {
			msgType, data, err := ws.Read(rctx)
			if err != nil {
				return e2ee.Frame{}, err
			}
			plain, err := e2eeSess.Receive(e2ee.Frame{
				Data:     data,
				IsBinary: msgType == websocket.MessageBinary,
			})
			if err != nil {
				_ = rawSink.Close(websocket.StatusInternalError, err.Error())
				return e2ee.Frame{}, err
			}
			if plain != nil {
				return *plain, nil
			}
		}
	})
	return nil
}

func (s *Server) serveSessionOnSink(
	ctx context.Context,
	sink frameSink,
	readNext func(context.Context) (e2ee.Frame, error),
) {
	s.mu.Lock()
	s.clients[sink] = false
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, sink)
		s.mu.Unlock()
		// A closed socket must stop receiving terminal output; the terminal outlives it.
		s.releaseTerminalSubscriptions(sink, "")
	}()

	// A socket that never sends `hello` holds a connection slot and a goroutine forever.
	// Node closes it after 15s with 4001; without the same deadline a half-open client (a
	// browser tab suspended before the handshake) accumulates until the daemon restarts.
	helloDeadline := time.AfterFunc(wsHelloTimeout, func() {
		s.mu.Lock()
		greeted := s.clients[sink]
		s.mu.Unlock()
		if !greeted {
			_ = sink.Close(wsCloseHelloTimeout, "Timed out waiting for hello")
		}
	})
	defer helloDeadline.Stop()

	for {
		frame, err := readNext(ctx)
		if err != nil {
			return
		}
		if frame.IsBinary {
			s.handleBinaryFrame(ctx, sink, frame.Data)
			continue
		}
		s.handleTextFrame(ctx, sink, frame.Data)
	}
}

func (s *Server) handleBinaryFrame(ctx context.Context, sink frameSink, raw []byte) {
	tf, err := terminal.DecodeFrame(raw)
	if err != nil {
		return
	}
	switch tf.Opcode {
	case terminal.OpcodeInput:
		sess := s.ensureTerminalSlot(tf.Slot, sink)
		if sess != nil {
			_ = sess.WriteInput(tf.Payload)
		}
	case terminal.OpcodeResize:
		rsz, err := terminal.DecodeResizePayload(tf.Payload)
		if err == nil {
			sess := s.ensureTerminalSlot(tf.Slot, sink)
			if sess != nil {
				_ = sess.Resize(uint16(rsz.Rows), uint16(rsz.Cols))
			}
		}
	}
	_ = ctx
}

func (s *Server) ensureTerminalSlot(slot uint8, sink frameSink) *terminal.Session {
	s.mu.Lock()
	sess, ok := s.terminals[slot]
	s.mu.Unlock()
	if ok {
		return sess
	}

	cwd, _ := os.Getwd()
	created, err := terminal.StartSession(terminal.StartOptions{
		ID:   fmt.Sprintf("term_%d", slot),
		Name: fmt.Sprintf("Terminal %d", slot+1),
		Cwd:  cwd,
	})
	if err != nil {
		return nil
	}

	s.mu.Lock()
	if existing, ok := s.terminals[slot]; ok {
		s.mu.Unlock()
		_ = created.Close()
		return existing
	}
	s.terminals[slot] = created
	s.mu.Unlock()

	// The creator is a subscriber like any other; registering it means unsubscribe works for
	// the socket that opened the terminal too.
	unsubscribe, _ := created.Subscribe(func(ev terminal.OutputEvent) {
		outFrame := terminal.EncodeFrame(terminal.OpcodeOutput, slot, ev.Data)
		_ = sink.SendBinary(context.Background(), outFrame)
	})
	// This helper only knows the slot; the id map is the canonical key and may not have an
	// entry yet, so key the subscription by the session's own id.
	s.registerTerminalSubscription(sink, created.ID, unsubscribe)
	return created
}

func (s *Server) handleTextFrame(ctx context.Context, sink frameSink, raw []byte) {
	var envelope struct {
		Type            string          `json:"type"`
		ClientID        string          `json:"clientId"`
		ProtocolVersion int             `json:"protocolVersion"`
		AppVersion      string          `json:"appVersion"`
		Message         json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return
	}

	switch envelope.Type {
	case "ping":
		_ = sendJSON(ctx, sink, map[string]any{"type": "pong"})
	case "recording_state":
		return
	case "hello":
		if envelope.ProtocolVersion != WSProtocolVersion {
			_ = sink.Close(wsCloseIncompatibleProto, "Incompatible protocol version")
			return
		}
		if strings.TrimSpace(envelope.ClientID) == "" {
			_ = sink.Close(wsCloseInvalidHello, "Invalid hello")
			return
		}
		s.mu.Lock()
		s.clients[sink] = true
		s.mu.Unlock()
		_ = sendSessionMsg(ctx, sink, "status", s.buildServerInfoPayload())
	case "session":
		s.handleSessionMessage(ctx, sink, envelope.Message)
	}
}

func (s *Server) buildServerInfoPayload() map[string]any {
	hostname, _ := os.Hostname()
	return map[string]any{
		"status":           "server_info",
		"serverId":         s.serverID,
		"hostname":         hostname,
		"version":          s.version,
		"permissions":      ownerPermissions,
		"desktopManaged":   false,
		"webPushPublicKey": s.vapidKeys.PublicKey,
		"features": map[string]any{
			"webPush":                         s.vapidKeys.PublicKey != "",
			"skillInstallTargets":             true,
			"agentRoles":                      true,
			"agentRoleNames":                  []string{"chief"},
			"agentRequestReceipts":            true,
			"hubAgentRpc":                     true,
			"hubRelationship":                 true,
			"directorySync":                   true,
			"workspaceLabels":                 true,
			"workspaceSetupRun":               true,
			"providersSnapshot":               true,
			"providersSnapshotCwd":            true,
			"checkoutForgeSetAutoMerge":       true,
			"checkoutGithubSetAutoMerge":      true,
			"githubCheckDetails":              true,
			"forgeCheckDetails":               true,
			"forgeSearch":                     true,
			"forgeProviders":                  true,
			"projectGithubClone":              true,
			"workspaceGithubRepositorySearch": true,
			"daemonStatusRpc":                 true,
			"daemonConfigReload":              true,
			"relayConfig":                     true,
			"pushTokenRevocation":             true,
			"plugins":                         true,
			"pluginManagement":                true,
			"pluginGitManagement":             true,
			"pluginLogs":                      true,
			"pluginThemes":                    true,
			"pluginSettings":                  true,
			"pluginTimelineItems":             true,
			"skillManagement":                 true,
			"daemonTunnels":                   true,
			"projectSetupSkill":               true,
			"terminalAgentHookProviders":      true,
			"terminalShellConfig":             true,
			"terminal-restore-modes":          true,
			"terminal-input-mode-replay":      true,
			"terminal-size-ownership":         true,
			"workspaceTerminals":              true,
			"rewind":                          true,
			"agentTimelinePromptIndex":        true,
			"agentHistorySearch":              true,
			"checkoutRefresh":                 true,
			"workspaceAgentRename":            true,
			"workspaceMultiplicity":           true,
			"projectRemove":                   true,
			"projectAdd":                      true,
			"projectList":                     true,
			"worktreeRestore":                 true,
			"workspaceRecovery":               true,
			"workspaceFileEditing":            true,
			"providerUsageList":               true,
			"agentDetach":                     true,
			"agentThinkingUpdate":             true,
			"daemonDiagnostics":               true,
			"daemonSelfUpdate":                true,
			"agentForkContext":                true,
			"agentForkContextCursor":          true,
			"providerSubagents":               true,
			"providerSubagentNesting":         true,
			"workspacePinning":                true,
			"workspaceMarkUnread":             true,
			"projectCreateDirectory":          true,
			"commitsList":                     true,
			"commitBaseClassification":        true,
			"providerRemoval":                 true,
			"importSessionWorkspaceTarget":    true,
			"importSessionSearch":             true,
			"selectiveAgentTimeline":          true,
			"explicitEventSubscriptions":      true,
			"canonicalSubmittedPrompts":       true,
			"stableProjectIdentity":           true,
			"workspaceScriptManagement":       true,
			"projectCustomIcon":               true,
			"fsEntryOps":                      true,
			"fsEntryDuplicate":                true,
			"checkoutDiscardChanges":          true,
			"agentProfiles":                   true,
			"agentConfigApply":                true,
			"daemonNetworkConfig":             true,
			"daemonServiceInstall":            true,
		},
	}
}

func (s *Server) handleSessionMessage(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var base struct {
		Type      string `json:"type"`
		RequestID string `json:"requestId"`
	}
	if err := json.Unmarshal(raw, &base); err != nil {
		return
	}

	switch base.Type {
	case "ping":
		var ping struct {
			RequestID    string `json:"requestId"`
			ClientSentAt int64  `json:"clientSentAt"`
		}
		_ = json.Unmarshal(raw, &ping)
		now := time.Now().UnixMilli()
		_ = sendSessionMsg(ctx, sink, "pong", map[string]any{
			"requestId":        ping.RequestID,
			"clientSentAt":     ping.ClientSentAt,
			"serverReceivedAt": now,
			"serverSentAt":     now,
		})

	case "client_heartbeat":
		return

	case "session.events.set_subscription.request":
		var req struct {
			RequestID string   `json:"requestId"`
			Events    []string `json:"events"`
		}
		_ = json.Unmarshal(raw, &req)
		events := req.Events
		if events == nil {
			events = []string{}
		}
		_ = sendSessionMsg(ctx, sink, "session.events.set_subscription.response", map[string]any{
			"requestId": req.RequestID,
			"events":    events,
		})

	case "agent.timeline.set_subscription.request":
		var req struct {
			RequestID string   `json:"requestId"`
			AgentIDs  []string `json:"agentIds"`
		}
		_ = json.Unmarshal(raw, &req)
		ids := req.AgentIDs
		if ids == nil {
			ids = []string{}
		}
		_ = sendSessionMsg(ctx, sink, "agent.timeline.set_subscription.response", map[string]any{
			"requestId": base.RequestID,
			"agentIds":  ids,
		})

	case "daemon.get_status.request":
		hostname, _ := os.Hostname()
		exe, _ := os.Executable()
		_ = sendSessionMsg(ctx, sink, "daemon.get_status.response", map[string]any{
			"requestId":    base.RequestID,
			"serverId":     s.serverID,
			"hostname":     hostname,
			"version":      s.version,
			"publicKeyB64": s.pubKeyB64,
			"pid":          os.Getpid(),
			"nodePath":     exe,
			"listen":       nil,
			"providers": []map[string]any{
				{"provider": "pi", "available": true, "error": nil},
			},
		})

	case "get_daemon_config_request":
		_ = sendSessionMsg(ctx, sink, "get_daemon_config_response", map[string]any{
			"requestId": base.RequestID,
			"config":    s.store.LoadDaemonConfig(),
		})

	case "list_available_providers_request":
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_ = sendSessionMsg(ctx, sink, "list_available_providers_response", map[string]any{
			"requestId": base.RequestID,
			"fetchedAt": now,
			"error":     nil,
			"providers": providers.BuildAvailableProviders(s.piCommand),
		})

	case "get_providers_snapshot_request":
		var req struct {
			RequestID   string `json:"requestId"`
			Cwd         string `json:"cwd"`
			IfNoneMatch string `json:"ifNoneMatch"`
		}
		_ = json.Unmarshal(raw, &req)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if req.IfNoneMatch != "" && req.IfNoneMatch == s.providerSnapshotTag() {
			_ = sendSessionMsg(ctx, sink, "get_providers_snapshot_response", map[string]any{
				"requestId":   base.RequestID,
				"generatedAt": now,
				"notModified": true,
				"entries":     []any{},
			})
			return
		}
		models := s.probeOrCachedPiModels(ctx)
		cfg := s.store.LoadDaemonConfig()
		customProvs, _ := cfg["providers"].(map[string]any)
		entries := providers.BuildSnapshotEntries(models, s.piCommand, customProvs)
		respPayload := map[string]any{
			"requestId":   base.RequestID,
			"generatedAt": now,
			"entries":     entries,
			// snapshotHash lets the client skip re-applying an identical catalog and is what
			// `ifNoneMatch` compares against on the next call.
			"snapshotHash": providerSnapshotHash(entries),
			// fetchedAt drives the "last refreshed" line in the providers sheet.
			"fetchedAt": providerFetchedAt(entries, now),
			// compactSnapshot is the same catalog with thinking option lists deduped; the
			// app's provider cache reads it to avoid re-downloading identical option sets.
			"compactSnapshot": providers.BuildCompactSnapshot(entries),
		}
		if strings.TrimSpace(req.Cwd) != "" {
			respPayload["cwd"] = req.Cwd
		}
		_ = sendSessionMsg(ctx, sink, "get_providers_snapshot_response", respPayload)

	case "refresh_providers_snapshot_request":
		s.mu.Lock()
		s.cachedPiModels = nil
		s.mu.Unlock()
		models := s.probeOrCachedPiModels(ctx)
		cfg := s.store.LoadDaemonConfig()
		customProvs, _ := cfg["providers"].(map[string]any)
		entries := providers.BuildSnapshotEntries(models, s.piCommand, customProvs)
		nowStr := time.Now().UTC().Format(time.RFC3339Nano)
		// The providers sheet subscribes to providers_snapshot_update and swaps its cached
		// catalog on this message; sending only the response left open sheets stale.
		s.broadcastSessionMsg("providers_snapshot_update", map[string]any{
			// `cwd` is optional, not nullable: a null makes the client drop the whole update.
			"generatedAt":     nowStr,
			"entries":         entries,
			"snapshotHash":    providerSnapshotHash(entries),
			"fetchedAt":       providerFetchedAt(entries, nowStr),
			"compactSnapshot": providers.BuildCompactSnapshot(entries),
		})
		_ = sendSessionMsg(ctx, sink, "refresh_providers_snapshot_response", map[string]any{
			"requestId":    base.RequestID,
			"acknowledged": true,
		})

	case "list_provider_models_request":
		var req struct {
			RequestID string `json:"requestId"`
			Provider  string `json:"provider"`
		}
		_ = json.Unmarshal(raw, &req)
		prov := strings.TrimSpace(req.Provider)
		if prov == "" {
			prov = "pi"
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		var models []pi.CatalogModel
		if prov == "pi" {
			models = s.probeOrCachedPiModels(ctx)
		} else {
			models = providers.GetProviderSpec(prov).Models
		}
		_ = sendSessionMsg(ctx, sink, "list_provider_models_response", map[string]any{
			"requestId": base.RequestID,
			"provider":  prov,
			"models":    models,
			"error":     nil,
			"fetchedAt": now,
		})

	case "list_provider_modes_request":
		var req struct {
			RequestID string `json:"requestId"`
			Provider  string `json:"provider"`
		}
		_ = json.Unmarshal(raw, &req)
		prov := strings.TrimSpace(req.Provider)
		if prov == "" {
			prov = "pi"
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_ = sendSessionMsg(ctx, sink, "list_provider_modes_response", map[string]any{
			"requestId": base.RequestID,
			"provider":  prov,
			"modes":     providers.GetProviderSpec(prov).Modes,
			"error":     nil,
			"fetchedAt": now,
		})

	case "list_provider_features_request":
		var req struct {
			RequestID string `json:"requestId"`
			Provider  string `json:"provider"`
		}
		_ = json.Unmarshal(raw, &req)
		prov := strings.TrimSpace(req.Provider)
		if prov == "" {
			prov = "pi"
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_ = sendSessionMsg(ctx, sink, "list_provider_features_response", map[string]any{
			"requestId": base.RequestID,
			"provider":  prov,
			"features":  providers.GetProviderSpec(prov).Features,
			"error":     nil,
			"fetchedAt": now,
		})

	case "file_explorer_request":
		s.handleFileExplorer(ctx, sink, raw)

	case "fs.file.subscribe.request":
		s.handleFileSubscribe(ctx, sink, raw)

	case "fs.file.unsubscribe.request":
		s.handleFileUnsubscribe(ctx, sink, raw)

	case "fs.file.write.request":
		s.handleFileWrite(ctx, sink, raw)

	case "fs.entry.create.request":
		s.handleFileEntryCreate(ctx, sink, raw)

	case "fs.entry.rename.request":
		s.handleFileEntryRename(ctx, sink, raw)

	case "fs.entry.delete.request":
		s.handleFileEntryDelete(ctx, sink, raw)

	case "checkout_status_request":
		s.handleCheckoutStatus(ctx, sink, raw)

	case "checkout.commits.list.request":
		s.handleCheckoutCommitsList(ctx, sink, raw)

	case "fetch_recent_provider_sessions_request":
		s.handleFetchRecentProviderSessions(ctx, sink, raw)

	case "import_agent_request", "resume_agent_request":
		s.handleImportAgent(ctx, sink, raw)

	case "create_terminal_request":
		s.handleCreateTerminal(ctx, sink, raw)

	case "list_terminals_request":
		s.handleListTerminals(ctx, sink, raw)

	case "subscribe_terminal_request":
		s.handleSubscribeTerminal(ctx, sink, raw)

	case "terminal.shell.detect.request":
		// Discover every usable shell, not just $SHELL: the picker exists so a user can switch,
		// and returning one entry made it look like only one shell was installed.
		configured := ""
		if cfg := s.store.LoadDaemonConfig(); cfg != nil {
			if daemon, ok := cfg["daemon"].(map[string]any); ok {
				if v, ok := daemon["terminalDefaultShell"].(string); ok {
					configured = strings.TrimSpace(v)
				}
			}
		}
		detected := terminal.DetectInstalledShells()
		shellList := make([]map[string]any, 0, len(detected))
		for _, sh := range detected {
			shellList = append(shellList, map[string]any{
				"path":      sh.Path,
				"name":      sh.Name,
				"source":    sh.Source,
				"isDefault": sh.IsDefault,
			})
		}
		shellDetectPayload := map[string]any{
			"requestId":       base.RequestID,
			"shells":          shellList,
			"resolvedDefault": terminal.ResolveDefaultShell(configured),
			"error":           nil,
		}
		// `configured` is the explicit daemon.terminalDefaultShell; absent in auto mode.
		if configured != "" {
			shellDetectPayload["configured"] = configured
		}
		_ = sendSessionMsg(ctx, sink, "terminal.shell.detect.response", shellDetectPayload)

	case "project.list.request":
		s.handleProjectList(ctx, sink, base.RequestID)

	case "fetch_workspaces_request":
		s.handleFetchWorkspaces(ctx, sink, raw)

	case "workspace.create.request":
		s.handleWorkspaceCreate(ctx, sink, raw)

	case "fetch_agents_request", "fetch_agent_history_request":
		s.handleFetchAgents(ctx, sink, base.Type, raw)

	case "fetch_agent_request":
		var req struct {
			RequestID string `json:"requestId"`
			AgentID   string `json:"agentId"`
		}
		_ = json.Unmarshal(raw, &req)
		agentPayload := s.getAgentPayload(req.AgentID)
		var projectPlacement any
		if rec, _ := s.store.GetAgent(req.AgentID); rec != nil {
			projectPlacement = s.buildProjectPlacementForRecord(*rec)
		}
		_ = sendSessionMsg(ctx, sink, "fetch_agent_response", map[string]any{
			"requestId": req.RequestID,
			"agent":     agentPayload,
			"project":   projectPlacement,
			"error":     nil,
		})

	case "create_agent_request":
		s.handleCreateAgent(ctx, sink, raw)

	case "send_agent_message_request":
		s.handleSendAgentMessage(ctx, sink, raw)

	case "fetch_agent_timeline_request":
		s.handleFetchAgentTimeline(ctx, sink, raw)

	case "wait_for_finish_request":
		s.handleWaitForFinish(ctx, sink, raw)

	case "cancel_agent_request":
		var req struct {
			RequestID string `json:"requestId"`
			AgentID   string `json:"agentId"`
		}
		_ = json.Unmarshal(raw, &req)
		s.mu.Lock()
		mp := s.agents[req.AgentID]
		s.mu.Unlock()
		if mp != nil && mp.session != nil {
			_ = mp.session.Abort(ctx)
		}
		s.mu.Lock()
		var agentSnapshot any
		if mp2 := s.agents[req.AgentID]; mp2 != nil {
			agentSnapshot = s.buildAgentSnapshotPayload(mp2.record)
		}
		s.mu.Unlock()
		_ = sendSessionMsg(ctx, sink, "cancel_agent_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"agent":     agentSnapshot,
			"error":     nil,
		})
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_cancelled",
			"agentId":   req.AgentID,
			"requestId": req.RequestID,
		})

	case "set_agent_model_request":
		s.handleSetAgentModel(ctx, sink, raw)

	case "set_agent_thinking_request":
		s.handleSetAgentThinking(ctx, sink, raw)

	case "set_agent_mode_request":
		s.handleSetAgentMode(ctx, sink, raw)

	case "agent.config.apply.request":
		s.handleAgentConfigApply(ctx, sink, raw)

	case "delete_agent_request":
		s.handleDeleteAgent(ctx, sink, raw)

	case "archive_agent_request":
		s.handleArchiveAgent(ctx, sink, raw)

	case "update_agent_request":
		s.handleUpdateAgent(ctx, sink, raw)

	case "list_commands_request":
		s.handleListCommands(ctx, sink, raw)

	case "create_byspace_worktree_request":
		s.handleCreateBySpaceWorktree(ctx, sink, raw)

	case "byspace_worktree_list_request":
		s.handleBySpaceWorktreeList(ctx, sink, raw)

	case "subscribe_checkout_diff_request":
		s.handleSubscribeCheckoutDiff(ctx, sink, raw)

	case "checkout_commit_request":
		s.handleCheckoutCommit(ctx, sink, raw)

	case "checkout.discard_changes.request":
		s.handleCheckoutDiscardChanges(ctx, sink, raw)

	case "schedule/create",
		"schedule/list",
		"schedule/inspect",
		"schedule/logs",
		"schedule/pause",
		"schedule/resume",
		"schedule/delete",
		"schedule/run-once",
		"schedule/update":
		s.handleScheduleMessage(ctx, sink, base.Type, raw)

	case "agent_permission_response":
		s.handleAgentPermissionResponse(ctx, sink, raw)

	case "agent.provider_subagents.list.request":
		s.handleProviderSubagentsList(ctx, sink, raw)

	case "agent.provider_subagents.timeline.get.request":
		s.handleProviderSubagentTimeline(ctx, sink, raw)

	case "daemon.get_pairing_offer.request":
		s.handleGetPairingOffer(ctx, sink, raw)

	case "register_push_token":
		s.handleRegisterPushToken(raw)

	case "push.unregister.request":
		s.handlePushUnregister(ctx, sink, raw)

	case "diagnostics.request":
		s.handleDiagnostics(ctx, sink, raw)

	case "project.add.request":
		s.handleProjectAdd(ctx, sink, raw)

	case "project.create_directory.request":
		s.handleProjectCreateDirectory(ctx, sink, raw)

	case "project.rename.request":
		s.handleProjectRename(ctx, sink, raw)

	case "project.remove.request":
		s.handleProjectRemove(ctx, sink, raw)

	case "project.icon.set.request", "project.icon.get.request", "project_icon_request":
		s.handleProjectIcon(ctx, sink, base.Type, raw)

	case "open_project_request":
		s.handleOpenProject(ctx, sink, raw)

	case "directory_suggestions_request":
		s.handleDirectorySuggestions(ctx, sink, raw)

	case "archive_workspace_request", "byspace_worktree_archive_request":
		s.handleArchiveWorkspace(ctx, sink, base.Type, raw)

	case "workspace.title.set.request":
		s.handleWorkspaceTitleSet(ctx, sink, raw)

	case "workspace.pin.set.request":
		s.handleWorkspacePinSet(ctx, sink, raw)

	case "workspace.clear_attention.request", "workspace.mark_unread.request":
		s.handleWorkspaceAttention(ctx, sink, base.Type, raw)

	case "workspace.label.list.request",
		"workspace.label.assignment.set.request",
		"workspace.label.update.request",
		"workspace.label.delete.request",
		"workspace.label.delete.inspect.request":
		s.handleWorkspaceLabels(ctx, sink, base.Type, raw)

	case "workspace.setup.run.request", "workspace_setup_status_request":
		s.handleWorkspaceSetupProject(ctx, sink, base.Type, raw)

	case "plugin.list.request",
		"plugin.catalog.get.request",
		"plugin.logs.get.request",
		"plugin.source.status.request",
		"plugin.source.update.request",
		"plugin.directory.inspect.request",
		"plugin.directory.install.request",
		"plugin.source.install.request",
		"plugin.reload.request",
		"plugin.enable.request",
		"plugin.disable.request",
		"plugin.remove.request",
		"plugin.rpc.invoke.request":
		s.handlePluginRPC(ctx, sink, base.Type, raw)

	case "workspace.recovery.inspect.request", "workspace.recovery.restore.request":
		s.handleWorkspaceRecovery(ctx, sink, base.Type, raw)

	case "read_project_config_request", "write_project_config_request":
		s.handleProjectConfig(ctx, sink, base.Type, raw)

	case "start_workspace_script_request",
		"workspace.script.list.request",
		"workspace.script.start.request",
		"workspace.script.stop.request":
		s.handleWorkspaceScripts(ctx, sink, base.Type, raw)

	case "list_available_editors_request", "open_in_editor_request":
		s.handleEditors(ctx, sink, base.Type, raw)

	case "fs.entry.duplicate.request", "file_download_token_request", "file.upload.request":
		s.handleFileExtraOps(ctx, sink, base.Type, raw)

	case "unsubscribe_checkout_diff_request",
		"checkout.refresh.request",
		"checkout.commits.file_diff.request",
		"validate_branch_request",
		"branch_suggestions_request",
		"checkout_switch_branch_request",
		"checkout.rename_branch.request",
		"checkout_push_request",
		"checkout_pull_request",
		"checkout_merge_request",
		"checkout_merge_from_base_request",
		"stash_list_request",
		"stash_save_request",
		"stash_pop_request":
		s.handleGitParityOps(ctx, sink, base.Type, raw)

	case "checkout_pr_status_request",
		"checkout_pr_create_request",
		"checkout_pr_merge_request",
		"pull_request_timeline_request",
		"checkout.forge.set_auto_merge.request",
		"checkout.github.set_auto_merge.request",
		"checkout.forge.get_check_details.request",
		"checkout.github.get_check_details.request",
		"forge.search.request",
		"github_search_request",
		"workspace.github.search_repositories.request",
		"project.github.clone.request":
		s.handleForgeParityOps(ctx, sink, base.Type, raw)

	case "subscribe_terminals_request",
		"unsubscribe_terminals_request",
		"unsubscribe_terminal_request",
		"terminal_input",
		"kill_terminal_request",
		"capture_terminal_request",
		"terminal.rename.request":
		s.handleTerminalParityOps(ctx, sink, base.Type, raw)

	case "clear_agent_attention",
		"refresh_agent_request",
		"close_items_request",
		"agent.detach.request",
		"agent.rewind.request",
		"agent.fork_context.request",
		"agent.timeline.list_prompts.request",
		"agent.timeline.append.request",
		"set_agent_feature_request",
		"abort_request":
		s.handleAgentParityOps(ctx, sink, base.Type, raw)

	case "agent.skills.get_status.request",
		"agent.skills.reconcile.request",
		"agent.skills.uninstall.request",
		"agent.skills.save_selection.request",
		"agent.skills.import_legacy_selection.request",
		"provider.usage.list.request",
		"provider_diagnostic_request",
		"set_daemon_config_request",
		"daemon.config.reload.request",
		"daemon.update.request",
		"restart_server_request",
		"shutdown_server_request",
		"tunnel.list.request",
		"tunnel.open.request",
		"tunnel.close.request",
		"tunnel.stats.request",
		"tunnel.create.request",
		"tunnel.remove.request",
		"hub.management.daemon.connect.request",
		"hub.management.daemon.get_status.request",
		"hub.management.daemon.disconnect.request",
		"hub.management.daemon.permissions.update.request",
		"hub.execution.agent.validate.request",
		"hub.execution.agent.create.request",
		"hub.execution.control.request",
		"set_voice_mode",
		"dictation_stream_start",
		"dictation_stream_chunk",
		"dictation_stream_finish",
		"dictation_stream_cancel",
		"voice_audio_chunk",
		"audio_played":
		s.handleSystemParityOps(ctx, sink, base.Type, raw)
	}
}

func (s *Server) handleProjectList(ctx context.Context, sink frameSink, requestID string) {
	projects, _ := s.store.ListProjects()
	descriptors := make([]map[string]any, 0, len(projects))
	for _, p := range projects {
		if p.ArchivedAt != nil {
			continue
		}
		descriptors = append(descriptors, buildProjectDescriptor(p))
	}
	_ = sendSessionMsg(ctx, sink, "project.list.response", map[string]any{
		"requestId": requestID,
		"projects":  descriptors,
		"sync":      s.directorySyncMetadata("snapshot"),
	})
}

func (s *Server) handleFetchWorkspaces(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		// The list is searchable, sortable and pageable; ignoring these made the sidebar ignore
		// its own search box and always render the full list in storage order.
		Filter    *workspaceFilter   `json:"filter"`
		Sort      []workspaceSortKey `json:"sort"`
		Page      *workspacePage     `json:"page"`
		Subscribe *struct {
			SubscriptionID string `json:"subscriptionId"`
		} `json:"subscribe"`
	}
	_ = json.Unmarshal(raw, &req)

	projects, _ := s.store.ListProjects()
	workspaces, _ := s.store.ListWorkspaces()

	prjByID := make(map[string]store.ProjectRecord, len(projects))
	wsCountByPrj := make(map[string]int)
	for _, p := range projects {
		prjByID[p.ProjectID] = p
	}

	entries := make([]map[string]any, 0, len(workspaces))
	for _, ws := range workspaces {
		if ws.ArchivedAt != nil {
			continue
		}
		prj, ok := prjByID[ws.ProjectID]
		if !ok || prj.ArchivedAt != nil {
			continue
		}
		wsCountByPrj[ws.ProjectID]++
		entries = append(entries, buildWorkspaceDescriptor(ws, prj))
	}

	entries = filterSortPageWorkspaces(entries, req.Filter, req.Sort, req.Page)

	emptyProjects := make([]map[string]any, 0)
	for _, p := range projects {
		if p.ArchivedAt == nil && wsCountByPrj[p.ProjectID] == 0 {
			emptyProjects = append(emptyProjects, buildProjectDescriptor(p))
		}
	}

	payload := map[string]any{
		"requestId":     req.RequestID,
		"entries":       entries,
		"emptyProjects": emptyProjects,
		"pageInfo": map[string]any{
			"nextCursor": nil,
			"prevCursor": nil,
			"hasMore":    false,
		},
		"sync": s.directorySyncMetadata("snapshot"),
	}
	if req.Subscribe != nil && req.Subscribe.SubscriptionID != "" {
		payload["subscriptionId"] = req.Subscribe.SubscriptionID
	}
	_ = sendSessionMsg(ctx, sink, "fetch_workspaces_response", payload)
}

func (s *Server) handleWorkspaceCreate(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID         string  `json:"requestId"`
		Title             *string `json:"title"`
		FirstAgentContext any     `json:"firstAgentContext"`
		Source            struct {
			Kind string `json:"kind"`
			Path string `json:"path"`
		} `json:"source"`
	}
	_ = json.Unmarshal(raw, &req)
	prj, ws, err := s.store.EnsureWorkspaceForCwd(req.Source.Path)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
			"requestId":       req.RequestID,
			"workspace":       nil,
			"setupTerminalId": nil,
			"error":           err.Error(),
		})
		return
	}
	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		ws.Title = req.Title
		_ = s.store.UpsertWorkspace(ws)
	}
	// Same reason as the worktree path: opening a workspace that has never been set up
	// must run its setup commands, otherwise the first command the user types fails.
	setupCommands := workspace.ReadSetupCommands(ws.Cwd)
	setupSkippedReason := any(nil)
	if len(setupCommands) == 0 {
		setupSkippedReason = "no setup commands configured"
	} else {
		go s.runWorkspaceSetup(ws.WorkspaceID, ws.Cwd, "", setupCommands)
	}

	respPayload := map[string]any{
		"requestId":       req.RequestID,
		"workspace":       buildWorkspaceDescriptor(ws, prj),
		"setupTerminalId": nil,
		"error":           nil,
	}
	// Optional-not-nullable: add only when it carries a value.
	if setupSkippedReason != nil {
		respPayload["setupSkippedReason"] = setupSkippedReason
	}
	s.broadcastWorkspaceUpsert(ws, prj)
	s.broadcastCheckoutStatusUpdate(ctx, ws.Cwd)
	if req.FirstAgentContext != nil {
		respPayload["firstAgentContext"] = req.FirstAgentContext
	}
	_ = sendSessionMsg(ctx, sink, "workspace.create.response", respPayload)
}

func (s *Server) handleFetchAgents(ctx context.Context, sink frameSink, reqType string, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		SearchQuery string `json:"searchQuery"`
		Search      string `json:"search"`
		Scope       string `json:"scope"`
		Page        *struct {
			Limit  int    `json:"limit"`
			Cursor string `json:"cursor"`
		} `json:"page"`
		Filter map[string]any `json:"filter"`
		// `sort` is an array of {key, direction} in the protocol; a bare string is also accepted.
		SortKeys []struct {
			Key       string `json:"key"`
			Direction string `json:"direction"`
		} `json:"sort"`
		Sort      string `json:"sortString"`
		Limit     int    `json:"limit"`
		Cursor    string `json:"cursor"`
		Subscribe *struct {
			SubscriptionID string `json:"subscriptionId"`
		} `json:"subscribe"`
	}
	_ = json.Unmarshal(raw, &req)

	searchQuery := req.SearchQuery
	if strings.TrimSpace(searchQuery) == "" {
		searchQuery = req.Search
	}
	sortField := req.Sort
	if sortField == "" && len(req.SortKeys) > 0 {
		sortField = req.SortKeys[0].Key
	}

	limit := req.Limit
	cursor := req.Cursor
	if req.Page != nil {
		if req.Page.Limit > 0 {
			limit = req.Page.Limit
		}
		if req.Page.Cursor != "" {
			cursor = req.Page.Cursor
		}
	}
	scope := strings.ToLower(strings.TrimSpace(req.Scope))
	if scope == "" {
		if reqType == "fetch_agent_history_request" {
			scope = "archived"
		} else {
			scope = "active"
		}
	}

	allRecords, _ := s.store.ListAgents()
	activeOrHist := make([]store.AgentRecord, 0, len(allRecords))
	for _, rec := range allRecords {
		switch scope {
		case "all":
			activeOrHist = append(activeOrHist, rec)
		case "archived":
			if rec.ArchivedAt != nil {
				activeOrHist = append(activeOrHist, rec)
			}
		default: // "active"
			if rec.ArchivedAt == nil {
				activeOrHist = append(activeOrHist, rec)
			}
		}
	}
	records, hasMore, nextCursor := s.filterAndSortAgents(activeOrHist, searchQuery, req.Filter, sortField, limit, cursor)

	projects, _ := s.store.ListProjects()
	workspaces, _ := s.store.ListWorkspaces()

	prjByID := make(map[string]store.ProjectRecord, len(projects))
	for _, p := range projects {
		prjByID[p.ProjectID] = p
	}
	wsByID := make(map[string]store.WorkspaceRecord, len(workspaces))
	for _, w := range workspaces {
		wsByID[w.WorkspaceID] = w
	}

	entries := make([]map[string]any, 0, len(records))
	for _, rec := range records {
		agentPayload := s.buildAgentSnapshotPayload(rec)
		projKey := rec.Cwd
		projName := filepath.Base(rec.Cwd)
		wsName := projName
		var branch any
		if ws, ok := wsByID[rec.WorkspaceID]; ok {
			wsName = ws.DisplayName
			if ws.Branch != nil {
				branch = *ws.Branch
			}
			if prj, ok := prjByID[ws.ProjectID]; ok {
				projKey = prj.RootPath
				projName = prj.DisplayName
			}
		}
		entry := map[string]any{
			"agent": agentPayload,
			"project": map[string]any{
				"projectKey":    projKey,
				"projectName":   projName,
				"workspaceName": wsName,
				"checkout": map[string]any{
					"cwd":                    rec.Cwd,
					"isGit":                  true,
					"currentBranch":          branch,
					"remoteUrl":              nil,
					"isBySpaceOwnedWorktree": false,
					"mainRepoRoot":           nil,
				},
			},
		}
		// searchScore / searchMatches let the client highlight the matched span; syncSeq is the
		// per-entry cursor the directory replica advances on change.
		if searchQuery != "" {
			entry["searchScore"] = 0
			entry["searchMatches"] = []any{}
		}
		entry["syncSeq"] = directorySyncSeq(rec.UpdatedAt)
		entries = append(entries, entry)
	}

	respType := "fetch_agents_response"
	if reqType == "fetch_agent_history_request" {
		respType = "fetch_agent_history_response"
	}
	payload := map[string]any{
		"requestId": req.RequestID,
		"entries":   entries,
		"pageInfo": map[string]any{
			"nextCursor": nextCursor,
			"prevCursor": nil,
			"hasMore":    hasMore,
		},
	}
	payload["subscriptionId"] = nil
	if req.Subscribe != nil && req.Subscribe.SubscriptionID != "" {
		payload["subscriptionId"] = req.Subscribe.SubscriptionID
	}
	payload["sync"] = s.directorySyncMetadata("snapshot")
	if reqType == "fetch_agent_history_request" {
		payload["searchTruncated"] = false
	}
	_ = sendSessionMsg(ctx, sink, respType, payload)
}

func (s *Server) handleCreateAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID       string            `json:"requestId"`
		WorkspaceID     string            `json:"workspaceId"`
		InitialPrompt   *string           `json:"initialPrompt"`
		ClientMessageID string            `json:"clientMessageId"`
		IdempotencyKey  string            `json:"idempotencyKey"`
		CallerAgentID   string            `json:"callerAgentId"`
		WorktreeName    string            `json:"worktreeName"`
		OutputSchema    any               `json:"outputSchema"`
		AutoArchive     any               `json:"autoArchive"`
		Git             any               `json:"git"`
		Env             map[string]string `json:"env"`
		Images          []struct {
			Data     string `json:"data"`
			MimeType string `json:"mimeType"`
		} `json:"images"`
		Attachments []struct {
			Type     string `json:"type"`
			FileName string `json:"fileName"`
			Path     string `json:"path"`
			MimeType string `json:"mimeType"`
			Data     string `json:"data"`
		} `json:"attachments"`
		Config struct {
			Provider         string            `json:"provider"`
			Cwd              string            `json:"cwd"`
			Title            *string           `json:"title"`
			Model            *string           `json:"model"`
			ThinkingOptionID *string           `json:"thinkingOptionId"`
			ModeID           *string           `json:"modeId"`
			Role             *string           `json:"role"`
			SystemPrompt     *string           `json:"systemPrompt"`
			Labels           map[string]string `json:"labels"`
		} `json:"config"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return
	}

	cwd := strings.TrimSpace(req.Config.Cwd)
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	absCwd, err := filepath.Abs(cwd)
	if err == nil {
		cwd = absCwd
	}

	_, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_create_failed",
			"requestId": req.RequestID,
			"error":     err.Error(),
		})
		return
	}

	provider := strings.TrimSpace(req.Config.Provider)
	if provider == "" {
		provider = "pi"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	agentID := newAgentID()
	title := req.Config.Title
	if title == nil && req.InitialPrompt != nil {
		trimmed := strings.TrimSpace(*req.InitialPrompt)
		if trimmed != "" {
			if len(trimmed) > 60 {
				trimmed = trimmed[:60]
			}
			title = &trimmed
		}
	}

	if strings.TrimSpace(req.IdempotencyKey) != "" {
		if existing, ok := s.lookupIdempotentAgent(req.IdempotencyKey); ok {
			_ = sendSessionMsg(ctx, sink, "status", map[string]any{
				"status":    "agent_created",
				"agentId":   existing.ID,
				"requestId": req.RequestID,
				"agent":     s.buildAgentSnapshotPayload(existing),
			})
			return
		}
	}

	agentLabels := map[string]string{}
	for k, v := range req.Config.Labels {
		if !strings.HasPrefix(k, "byspace.") {
			agentLabels[k] = v
		}
	}
	if req.Config.Role != nil && strings.TrimSpace(*req.Config.Role) != "" {
		agentLabels["byspace.agent-role"] = strings.TrimSpace(*req.Config.Role)
	}
	if autoArchive, ok := req.AutoArchive.(bool); ok {
		agentLabels["byspace.auto-archive"] = map[bool]string{true: "true", false: "false"}[autoArchive]
	}
	var callerPtr *string
	if strings.TrimSpace(req.CallerAgentID) != "" {
		caller := strings.TrimSpace(req.CallerAgentID)
		callerPtr = &caller
	}

	rec := store.AgentRecord{
		ID:            agentID,
		Provider:      provider,
		Cwd:           cwd,
		WorkspaceID:   ws.WorkspaceID,
		CreatedAt:     now,
		UpdatedAt:     now,
		Title:         title,
		Labels:        agentLabels,
		LastStatus:    "idle",
		LastModeID:    req.Config.ModeID,
		ParentAgentID: callerPtr,
		Config: &store.AgentConfig{
			Model:            req.Config.Model,
			ThinkingOptionID: req.Config.ThinkingOptionID,
			ModeID:           req.Config.ModeID,
			Role:             req.Config.Role,
			SystemPrompt:     req.Config.SystemPrompt,
		},
	}

	mp, err := s.startOrGetPiAgent(rec)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_create_failed",
			"requestId": req.RequestID,
			"error":     err.Error(),
		})
		return
	}

	if err := s.store.UpsertAgent(mp.record); err != nil {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_create_failed",
			"requestId": req.RequestID,
			"error":     err.Error(),
		})
		return
	}

	if req.InitialPrompt != nil && strings.TrimSpace(*req.InitialPrompt) != "" {
		mp.session.SetNextClientMessageID(req.ClientMessageID)
		createdImages := make([]pi.ImageContent, 0, len(req.Images))
		for _, img := range req.Images {
			if img.Data == "" {
				continue
			}
			createdImages = append(createdImages, pi.ImageContent{Type: "image", Data: img.Data, MimeType: img.MimeType})
		}
		createdText := appendAttachmentHints(*req.InitialPrompt, req.Attachments)
		_ = mp.session.Prompt(ctx, createdText, createdImages)
		s.mu.Lock()
		mp.record.LastStatus = mp.session.Status()
		mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		s.mu.Unlock()
		_ = s.store.UpsertAgent(mp.record)
		s.rememberIdempotentAgent(req.IdempotencyKey, agentID)
	}

	_ = sendSessionMsg(ctx, sink, "status", map[string]any{
		"status":    "agent_created",
		"agentId":   agentID,
		"requestId": req.RequestID,
		"agent":     s.buildAgentSnapshotPayload(mp.record),
	})
	s.broadcastAgentUpdate(mp.record)
}

func (s *Server) handleSendAgentMessage(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID          string `json:"requestId"`
		AgentID            string `json:"agentId"`
		Text               string `json:"text"`
		Prompt             string `json:"prompt"`
		MessageID          string `json:"messageId"`
		ClientMessageID    string `json:"clientMessageId"`
		ActiveTurnBehavior string `json:"activeTurnBehavior"`
		Images             []struct {
			Data     string `json:"data"`
			MimeType string `json:"mimeType"`
		} `json:"images"`
		Attachments []struct {
			Type     string `json:"type"`
			FileName string `json:"fileName"`
			Path     string `json:"path"`
			MimeType string `json:"mimeType"`
			Data     string `json:"data"`
		} `json:"attachments"`
	}
	_ = json.Unmarshal(raw, &req)
	text := req.Text
	if text == "" {
		text = req.Prompt
	}
	clientMsgID := req.MessageID
	if clientMsgID == "" {
		clientMsgID = req.ClientMessageID
	}

	images := make([]pi.ImageContent, 0, len(req.Images))
	for _, img := range req.Images {
		if img.Data == "" {
			continue
		}
		images = append(images, pi.ImageContent{Type: "image", Data: img.Data, MimeType: img.MimeType})
	}
	text = appendAttachmentHints(text, req.Attachments)

	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "send_agent_message_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     err.Error(),
		})
		return
	}

	mp.session.SetNextClientMessageID(clientMsgID)
	// Node's steerOrReplaceActiveTurn returns {status:"inactive"} when the agent has no
	// active turn, and the caller then starts a normal turn. Steering unconditionally
	// would send `steer` to a provider whose turn already finished: pi accepts it as a
	// queued message that never becomes a turn, so the user's second message silently
	// disappears and the spinner never resolves.
	var promptErr error
	wantSteer := strings.EqualFold(strings.TrimSpace(req.ActiveTurnBehavior), "steer")
	if wantSteer {
		if turnID, _ := mp.session.ActiveTurn(); turnID != "" {
			promptErr = mp.session.Steer(ctx, text, images)
		} else {
			promptErr = mp.session.Prompt(ctx, text, images)
		}
	} else {
		promptErr = mp.session.Prompt(ctx, text, images)
	}
	if promptErr != nil {
		_ = sendSessionMsg(ctx, sink, "send_agent_message_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     promptErr.Error(),
		})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mp.record.UpdatedAt = now
	mp.record.LastUserMessageAt = &now
	mp.record.LastStatus = mp.session.Status()
	_ = s.store.UpsertAgent(mp.record)
	s.broadcastAgentUpdate(mp.record)

	_ = sendSessionMsg(ctx, sink, "send_agent_message_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
	})
}

func (s *Server) handleFetchAgentTimeline(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		AgentID     string `json:"agentId"`
		Direction   string `json:"direction"`
		Projection  string `json:"projection"`
		MergeWindow bool   `json:"mergeWindow"`
		// limit bounds a windowed fetch; 0 means "server default".
		Limit  int `json:"limit"`
		Cursor *struct {
			Epoch string `json:"epoch"`
			Seq   int    `json:"seq"`
		} `json:"cursor"`
	}
	_ = json.Unmarshal(raw, &req)

	direction := req.Direction
	if direction == "" {
		if req.Cursor != nil {
			direction = "after"
		} else {
			direction = "tail"
		}
	}
	projection := req.Projection
	if projection == "" {
		projection = "projected"
	}

	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "fetch_agent_timeline_response", map[string]any{
			"requestId":   req.RequestID,
			"agentId":     req.AgentID,
			"direction":   direction,
			"projection":  projection,
			"epoch":       s.epoch,
			"reset":       false,
			"staleCursor": false,
			"gap":         false,
			"entries":     []any{},
			"error":       err.Error(),
		})
		return
	}

	allTL := mp.session.Timeline()
	filteredTL := allTL
	if direction == "after" && req.Cursor != nil {
		filteredTL = make([]pi.TimelineEntry, 0, len(allTL))
		for _, e := range allTL {
			end := e.SeqEnd
			if end < e.Seq {
				end = e.Seq
			}
			if end > req.Cursor.Seq {
				filteredTL = append(filteredTL, e)
			}
		}
	}

	entries := make([]map[string]any, 0, len(filteredTL))
	for _, e := range filteredTL {
		startSeq := e.Seq
		if startSeq <= 0 {
			startSeq = 1
		}
		endSeq := e.SeqEnd
		if endSeq < startSeq {
			endSeq = startSeq
		}
		entries = append(entries, map[string]any{
			"provider":  mp.record.Provider,
			"item":      e.Item,
			"timestamp": e.Timestamp,
			"seqStart":  startSeq,
			"seqEnd":    endSeq,
			"sourceSeqRanges": []map[string]any{
				{"startSeq": startSeq, "endSeq": endSeq},
			},
			"turnId":    e.TurnID,
			"collapsed": []string{},
		})
	}

	var startCursor, endCursor any
	if len(filteredTL) > 0 {
		firstStart := filteredTL[0].Seq
		if firstStart <= 0 {
			firstStart = 1
		}
		lastEnd := filteredTL[len(filteredTL)-1].SeqEnd
		if lastEnd < filteredTL[len(filteredTL)-1].Seq {
			lastEnd = filteredTL[len(filteredTL)-1].Seq
		}
		startCursor = map[string]any{"epoch": s.epoch, "seq": firstStart}
		endCursor = map[string]any{"epoch": s.epoch, "seq": lastEnd}
	}
	streamMax := mp.session.StreamSeq()
	var minSeq, maxSeq any
	if len(allTL) > 0 {
		minSeq = 1
		if streamMax > 0 {
			maxSeq = streamMax
		} else {
			maxSeq = len(allTL)
		}
	}

	// A windowed request asks for at most `limit` entries. Ignoring it made a client
	// that pages through a long conversation receive the whole history every time.
	if req.Limit > 0 && len(entries) > req.Limit {
		entries = entries[len(entries)-req.Limit:]
	}
	_ = sendSessionMsg(ctx, sink, "fetch_agent_timeline_response", map[string]any{
		"requestId":   req.RequestID,
		"agentId":     req.AgentID,
		"agent":       s.buildAgentSnapshotPayload(mp.record),
		"direction":   direction,
		"projection":  projection,
		"epoch":       s.epoch,
		"reset":       false,
		"staleCursor": false,
		"gap":         false,
		"window": map[string]any{
			"minSeq":  minSeq,
			"maxSeq":  maxSeq,
			"nextSeq": streamMax + 1,
		},
		"startCursor": startCursor,
		"endCursor":   endCursor,
		"hasOlder":    false,
		"hasNewer":    false,
		"mergeWindow": req.MergeWindow,
		"entries":     entries,
		"error":       nil,
	})
}

func (s *Server) handleWaitForFinish(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		AgentID   string `json:"agentId"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	_ = json.Unmarshal(raw, &req)

	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "wait_for_finish_response", map[string]any{
			"requestId": req.RequestID,
			"status":    "error",
			"final":     nil,
			"error":     err.Error(),
			// lastMessage is the assistant's final text; CLI `byspace wait` prints it.
			"lastMessage": nil,
		})
		return
	}

	wctx := ctx
	var cancel context.CancelFunc
	if req.TimeoutMs > 0 {
		wctx, cancel = context.WithTimeout(ctx, time.Duration(req.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	if err := mp.session.WaitForFinish(wctx); err != nil {
		_ = sendSessionMsg(ctx, sink, "wait_for_finish_response", map[string]any{
			"requestId":   req.RequestID,
			"status":      "timeout",
			"final":       nil,
			"error":       err.Error(),
			"lastMessage": mp.session.LastAssistantText(),
		})
		return
	}

	mp.record.LastStatus = mp.session.Status()
	mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_ = s.store.UpsertAgent(mp.record)

	finalText := mp.session.LastAssistantText()
	_ = sendSessionMsg(ctx, sink, "wait_for_finish_response", map[string]any{
		"requestId": req.RequestID,
		"status":    "completed",
		// `final` is the full agent snapshot, not an ad-hoc summary: clients merge it into
		// their agent map, and `lastMessage` is what `byspace wait` prints.
		"final":       s.buildAgentSnapshotPayload(mp.record),
		"error":       nil,
		"lastMessage": finalText,
	})
}

func (s *Server) ensureAgentLoaded(agentID string) (*managedPi, error) {
	s.mu.Lock()
	if mp, ok := s.agents[agentID]; ok {
		s.mu.Unlock()
		return mp, nil
	}
	// Concurrent requests for the same agent must share one initialization. Without this,
	// two requests arriving while an agent is cold both see "not loaded" and each spawns a
	// provider process — the loser's process is orphaned and keeps the session file open.
	if pending, ok := s.agentLoads[agentID]; ok {
		s.mu.Unlock()
		<-pending.done
		s.mu.Lock()
		mp, exists := s.agents[agentID]
		loadErr := pending.err
		delete(s.agentLoads, agentID)
		s.mu.Unlock()
		if exists {
			return mp, nil
		}
		if loadErr != nil {
			return nil, loadErr
		}
		return nil, fmt.Errorf("agent %s failed to load", agentID)
	}
	load := &agentLoad{done: make(chan struct{})}
	if s.agentLoads == nil {
		s.agentLoads = make(map[string]*agentLoad)
	}
	s.agentLoads[agentID] = load
	s.mu.Unlock()

	mp, err := s.loadAgent(agentID)

	s.mu.Lock()
	load.err = err
	close(load.done)
	s.mu.Unlock()
	return mp, err
}

// loadAgent performs the actual read-and-spawn, with no locking expectations.
func (s *Server) loadAgent(agentID string) (*managedPi, error) {
	rec, err := s.store.GetAgent(agentID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}
	// An archived agent is history, not a runnable session. Resuming it would resurrect a
	// conversation the user removed from the sidebar and start spending tokens on it again.
	if rec.ArchivedAt != nil {
		return nil, fmt.Errorf("agent is archived: %s", agentID)
	}
	// A record pointing at a provider this build does not register cannot be resumed; say so
	// instead of spawning a command that does not exist.
	if !providers.IsKnownProvider(rec.Provider) {
		return nil, fmt.Errorf("agent %s references unavailable provider %q", agentID, rec.Provider)
	}
	return s.startOrGetPiAgent(*rec)
}

func (s *Server) startOrGetPiAgent(rec store.AgentRecord) (*managedPi, error) {
	s.mu.Lock()
	if existing, ok := s.agents[rec.ID]; ok {
		s.mu.Unlock()
		return existing, nil
	}
	s.mu.Unlock()

	var model, modeID, thinking, sessionPath string
	if rec.Config != nil {
		if rec.Config.Model != nil {
			model = *rec.Config.Model
		}
		if rec.Config.ModeID != nil {
			modeID = *rec.Config.ModeID
		}
		if rec.Config.ThinkingOptionID != nil {
			thinking = *rec.Config.ThinkingOptionID
		}
	}
	if rec.Persistence != nil {
		if nh, ok := rec.Persistence.NativeHandle.(string); ok && nh != "" {
			sessionPath = nh
		} else if rec.Persistence.SessionID != "" {
			if _, statErr := os.Stat(rec.Persistence.SessionID); statErr == nil {
				sessionPath = rec.Persistence.SessionID
			}
		}
	}

	var cmdOverride string
	if rec.Provider == "pi" || rec.Provider == "" {
		cmdOverride = s.piCommand
	}
	var providerEnv []string
	if rec.Config != nil && len(rec.Config.ProviderOptions) > 0 {
		base := os.Environ()
		for k, v := range rec.Config.ProviderOptions {
			if str, ok := v.(string); ok {
				base = append(base, k+"="+str)
			}
		}
		providerEnv = base
	}
	sess, err := providers.StartProviderSession(providers.LaunchConfig{
		Provider:         rec.Provider,
		CommandOverride:  cmdOverride,
		Cwd:              rec.Cwd,
		Model:            model,
		ModeID:           modeID,
		ThinkingOptionID: thinking,
		SessionHandle:    sessionPath,
		Env:              providerEnv,
	})
	if err != nil {
		return nil, err
	}

	if sessionPath != "" && (rec.Provider == "pi" || rec.Provider == "") {
		if restored, loadErr := pi.LoadTimelineFromJSONL(sessionPath); loadErr == nil && len(restored) > 0 {
			sess.SeedTimeline(restored)
		}
	}

	mp := &managedPi{
		record:  rec,
		session: sess,
	}

	s.mu.Lock()
	s.agents[rec.ID] = mp
	s.mu.Unlock()

	if rec.Persistence == nil {
		go s.syncPiPersistence(mp)
	}

	sess.OnEvent(func(ev map[string]any) {
		evType, _ := ev["type"].(string)
		nowStr := time.Now().UTC().Format(time.RFC3339Nano)
		isPi := rec.Provider == "pi" || rec.Provider == "" || rec.Provider == "omp"
		switch evType {
		case "byspace_turn_started":
			turnID, _ := ev["turnId"].(string)
			// Poll while the turn runs so the context ring fills as tokens accumulate,
			// the same cadence as PiUsagePoller (every 3s).
			mp.startUsagePolling(s, sess)
			s.mu.Lock()
			mp.record.LastStatus = "running"
			mp.record.UpdatedAt = nowStr
			recStartCopy := mp.record
			s.mu.Unlock()
			s.broadcastSessionMsg("agent_stream", map[string]any{
				"agentId":   rec.ID,
				"provider":  rec.Provider,
				"timestamp": nowStr,
				"event": map[string]any{
					"type":     "turn_started",
					"provider": rec.Provider,
					"turnId":   turnID,
				},
			})
			s.broadcastAgentUpdate(recStartCopy)

		case "turn_start":
			if !isPi {
				s.mu.Lock()
				mp.record.LastStatus = "running"
				mp.record.UpdatedAt = nowStr
				recStartCopy := mp.record
				s.mu.Unlock()
				s.broadcastSessionMsg("agent_stream", map[string]any{
					"agentId":   rec.ID,
					"provider":  rec.Provider,
					"timestamp": nowStr,
					"event": map[string]any{
						"type":     "turn_started",
						"provider": rec.Provider,
					},
				})
				s.broadcastAgentUpdate(recStartCopy)
			}

		case "byspace_stream_timeline":
			seq, _ := ev["seq"].(int)
			turnID, _ := ev["turnId"].(string)
			s.broadcastSessionMsg("agent_stream", map[string]any{
				"agentId":   rec.ID,
				"provider":  rec.Provider,
				"timestamp": nowStr,
				"seq":       seq,
				"epoch":     s.epoch,
				"event": map[string]any{
					"type":     "timeline",
					"provider": rec.Provider,
					"turnId":   turnID,
					"item":     ev["item"],
				},
			})
			for _, sub := range sess.ListSubagents(rec.ID) {
				s.broadcastSessionMsg("agent.provider_subagents.update", map[string]any{
					"kind":     "upsert",
					"subagent": sub,
				})
			}

		case "message_end":
			if !isPi {
				if txt := sess.LastAssistantText(); txt != "" {
					s.broadcastSessionMsg("agent_stream", map[string]any{
						"agentId":   rec.ID,
						"provider":  rec.Provider,
						"timestamp": nowStr,
						"event": map[string]any{
							"type":     "timeline",
							"provider": rec.Provider,
							"item": map[string]any{
								"type": "assistant_message",
								"text": txt,
							},
						},
					})
				}
			}

		case "tool_execution_start", "tool_execution_end":
			if !isPi {
				tl := sess.Timeline()
				for i := len(tl) - 1; i >= 0; i-- {
					if tl[i].Item.Type == "tool_call" {
						s.broadcastSessionMsg("agent_stream", map[string]any{
							"agentId":   rec.ID,
							"provider":  rec.Provider,
							"timestamp": nowStr,
							"seq":       tl[i].Seq,
							"epoch":     "ep_1",
							"event": map[string]any{
								"type":     "timeline",
								"provider": rec.Provider,
								"item":     tl[i].Item,
							},
						})
						break
					}
				}
				for _, sub := range sess.ListSubagents(rec.ID) {
					s.broadcastSessionMsg("agent.provider_subagents.update", map[string]any{
						"kind":     "upsert",
						"subagent": sub,
					})
				}
			}

		case "extension_ui_request":
			if perm := pi.MapExtensionUIRequestToPermission(ev); perm != nil {
				// Two consumers: the timeline renders an inline card from the agent_stream
				// event, and the permission modal listens for the dedicated
				// agent_permission_request message. Sending only the former left the modal
				// empty — `ask_user` prompts never appeared.
				s.broadcastSessionMsg("agent_stream", map[string]any{
					"agentId":   rec.ID,
					"provider":  rec.Provider,
					"timestamp": nowStr,
					"event": map[string]any{
						"type":     "permission_requested",
						"provider": rec.Provider,
						"request":  perm,
					},
				})
				s.broadcastSessionMsg("agent_permission_request", map[string]any{
					"agentId": rec.ID,
					"request": perm,
				})
			}

		case "byspace_turn_completed":
			turnID, _ := ev["turnId"].(string)
			// Drop a completion from an older turn. Pi emits one completion per turn, but a
			// second prompt can start before the first turn's event is fully processed; acting
			// on the stale one would stop showing the newer turn as running.
			if token, _ := ev["turnToken"].(string); token != "" && token != sess.TurnToken() {
				break
			}
			mp.stopUsagePolling()
			// pi does not answer get_session_stats while it is still producing tokens, so the
			// final sample has to wait until the provider settles. captureFinalUsage retries.
			go s.captureFinalUsage(mp, sess)
			s.mu.Lock()
			mp.record.LastStatus = "idle"
			mp.record.UpdatedAt = nowStr
			recCopy := mp.record
			s.mu.Unlock()
			_ = s.store.UpsertAgent(recCopy)
			go s.syncPiPersistence(mp)
			s.broadcastSessionMsg("agent_stream", map[string]any{
				"agentId":   rec.ID,
				"provider":  rec.Provider,
				"timestamp": nowStr,
				"event": map[string]any{
					"type":     "turn_completed",
					"provider": rec.Provider,
					"turnId":   turnID,
				},
			})
			// Emit turn_completed first, then the terminal snapshot. Clients key the
			// "stop" affordance off turn_completed and read the snapshot for status, so
			// the order matters: a trailing running snapshot would re-arm the spinner.
			s.broadcastAgentUpdate(recCopy)

		case "agent_end", "agent_settled", "process_exit":
			if !isPi || evType == "process_exit" {
				s.mu.Lock()
				mp.record.LastStatus = sess.Status()
				mp.record.UpdatedAt = nowStr
				recCopy := mp.record
				// Drop the dead runtime so the next send/resume rebuilds it from
				// persistence instead of writing into a closed pipe. Node does this by
				// closing the agent when the provider session dies.
				delete(s.agents, rec.ID)
				s.mu.Unlock()
				_ = s.store.UpsertAgent(recCopy)
				if evType == "process_exit" {
					// A provider that dies mid-run ends the turn in `turn_failed`, not
					// `turn_completed`: the client must surface the failure instead of
					// waiting forever for output that will never arrive.
					reason := "provider process exited"
					if mp.session != nil {
						if detail := mp.session.LastError(); detail != "" {
							reason = detail
						}
					}
					s.broadcastSessionMsg("agent_stream", map[string]any{
						"agentId":   rec.ID,
						"provider":  rec.Provider,
						"timestamp": nowStr,
						"event": map[string]any{
							"type":     "turn_failed",
							"provider": rec.Provider,
							"error":    reason,
						},
					})
				}
				if evType == "agent_end" {
					go s.syncPiPersistence(mp)
					s.broadcastSessionMsg("agent_stream", map[string]any{
						"agentId":   rec.ID,
						"provider":  rec.Provider,
						"timestamp": nowStr,
						"event": map[string]any{
							"type":     "turn_completed",
							"provider": rec.Provider,
						},
					})
				}
				s.broadcastAgentUpdate(recCopy)
			}
		}
	})

	return mp, nil
}

func (s *Server) syncPiPersistence(mp *managedPi) {
	if mp == nil || mp.session == nil {
		return
	}
	sctx, scancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer scancel()
	st, err := mp.session.GetState(sctx)
	if err != nil || st == nil || (st.SessionID == "" && st.SessionFile == "") {
		return
	}
	sid := st.SessionID
	if sid == "" && st.SessionFile != "" {
		sid = st.SessionFile
	}
	s.mu.Lock()
	mp.record.Persistence = &store.AgentPersistenceHandle{
		Provider:     "pi",
		SessionID:    sid,
		NativeHandle: st.SessionFile,
	}
	recCopy := mp.record
	s.mu.Unlock()
	_ = s.store.UpsertAgent(recCopy)
}

func (s *Server) broadcastAgentUpdate(rec store.AgentRecord) {
	s.broadcastSessionMsg("agent_update", map[string]any{
		"kind":    "upsert",
		"agent":   s.buildAgentSnapshotPayload(rec),
		"project": s.buildProjectPlacementForRecord(rec),
	})
}

func (s *Server) broadcastSessionMsg(msgType string, payload any) {
	s.mu.Lock()
	sinks := make([]frameSink, 0, len(s.clients))
	for sink, handshaked := range s.clients {
		if handshaked {
			sinks = append(sinks, sink)
		}
	}
	s.mu.Unlock()

	ctx := context.Background()
	for _, sink := range sinks {
		_ = sendSessionMsg(ctx, sink, msgType, payload)
	}
}

func (s *Server) getAgentPayload(agentID string) any {
	s.mu.Lock()
	mp, ok := s.agents[agentID]
	s.mu.Unlock()
	if ok {
		mp.record.LastStatus = mp.session.Status()
		return s.buildAgentSnapshotPayload(mp.record)
	}
	rec, err := s.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return nil
	}
	return s.buildAgentSnapshotPayload(*rec)
}

func (s *Server) buildAgentSnapshotPayload(rec store.AgentRecord) map[string]any {
	status := rec.LastStatus
	pendingPerms := []map[string]any{}
	var activeTurn any
	s.mu.Lock()
	if mp, ok := s.agents[rec.ID]; ok && mp.session != nil {
		status = mp.session.Status()
		pendingPerms = mp.session.PendingPermissions()
		if tid, startedAt := mp.session.ActiveTurn(); tid != "" && status == "running" {
			var sa any
			if startedAt != "" {
				sa = startedAt
			}
			activeTurn = map[string]any{
				"turnId":    tid,
				"startedAt": sa,
			}
		}
	}
	s.mu.Unlock()
	if status == "" {
		status = "closed"
	}

	var model, thinking, modeID any
	if rec.Config != nil {
		model = rec.Config.Model
		thinking = rec.Config.ThinkingOptionID
		modeID = rec.Config.ModeID
	}

	labels := rec.Labels
	if labels == nil {
		labels = map[string]string{}
	}

	payload := map[string]any{
		"id":                        rec.ID,
		"provider":                  rec.Provider,
		"cwd":                       rec.Cwd,
		"workspaceId":               rec.WorkspaceID,
		"model":                     model,
		"thinkingOptionId":          thinking,
		"effectiveThinkingOptionId": thinking,
		"createdAt":                 rec.CreatedAt,
		"updatedAt":                 rec.UpdatedAt,
		"lastUserMessageAt":         rec.LastUserMessageAt,
		"status":                    status,
		"activeTurn":                activeTurn,
		"capabilities": map[string]any{
			"supportsStreaming":          true,
			"supportsSessionPersistence": true,
			"supportsDynamicModes":       false,
			"supportsMcpServers":         true,
			"supportsReasoningStream":    true,
			"supportsToolInvocations":    true,
			"supportsRewindConversation": true,
			"supportsRewindFiles":        true,
			"supportsRewindBoth":         true,
			"canCancel":                  true,
			"canSelectModel":             true,
			"canSelectThinking":          true,
			"supportsImages":             true,
			"supportsAttachments":        true,
		},
		"currentModeId":      modeID,
		"availableModes":     providers.GetProviderSpec(rec.Provider).Modes,
		"features":           providers.GetProviderSpec(rec.Provider).Features,
		"pendingPermissions": pendingPerms,
		"persistence":        rec.Persistence,
		"title":              rec.Title,
		"labels":             labels,
		"archivedAt":         rec.ArchivedAt,
		"requiresAttention":  rec.RequiresAttention,
		"attentionReason":    rec.AttentionReason,
		"attentionTimestamp": rec.AttentionTimestamp,
	}
	// runtimeInfo and lastError are optional, not nullable, in AgentSnapshotPayloadSchema:
	// emitting null fails the whole response, so they are added only when they carry a value.
	if rec.RuntimeInfo != nil {
		payload["runtimeInfo"] = rec.RuntimeInfo
	}
	if rec.LastError != nil && strings.TrimSpace(*rec.LastError) != "" {
		payload["lastError"] = *rec.LastError
	}
	// lastUsage is optional (not nullable) in AgentSnapshotPayloadSchema: emitting null fails
	// validation, so the key is omitted until the provider reports something.
	if rec.Usage != nil {
		payload["lastUsage"] = rec.Usage
	}
	return payload
}

func (s *Server) buildProjectPlacementForRecord(rec store.AgentRecord) map[string]any {
	projects, _ := s.store.ListProjects()
	workspaces, _ := s.store.ListWorkspaces()
	prjByID := make(map[string]store.ProjectRecord, len(projects))
	for _, p := range projects {
		prjByID[p.ProjectID] = p
	}
	wsByID := make(map[string]store.WorkspaceRecord, len(workspaces))
	for _, w := range workspaces {
		wsByID[w.WorkspaceID] = w
	}
	projKey := rec.Cwd
	projName := filepath.Base(rec.Cwd)
	wsName := projName
	var branch any
	if ws, ok := wsByID[rec.WorkspaceID]; ok {
		wsName = ws.DisplayName
		if ws.Branch != nil {
			branch = *ws.Branch
		}
		if prj, ok := prjByID[ws.ProjectID]; ok {
			projKey = projectIdentityKey(prj)
			projName = prj.DisplayName
		}
	}
	isGit := false
	isBySpaceOwned := false
	var mainRepoRoot *string
	if ws, ok := wsByID[rec.WorkspaceID]; ok {
		isGit = !isHomeWorkspaceRecord(ws)
		isBySpaceOwned = ws.IsBySpaceOwnedWorktree
		mainRepoRoot = ws.MainRepoRoot
	}
	return map[string]any{
		"projectKey":    projKey,
		"projectName":   projName,
		"workspaceName": wsName,
		"checkout":      buildProjectCheckoutPayload(rec.Cwd, isGit, branchPtr(branch), isBySpaceOwned, mainRepoRoot),
	}
}

func buildProjectDescriptor(p store.ProjectRecord) map[string]any {
	displayName := p.DisplayName
	if p.CustomName != nil && strings.TrimSpace(*p.CustomName) != "" {
		displayName = strings.TrimSpace(*p.CustomName)
	}
	projectKind := p.Kind
	if projectKind != "git" && projectKind != "non_git" && projectKind != "directory" {
		projectKind = "git"
	}
	out := map[string]any{
		"projectId":                 p.ProjectID,
		"projectDisplayName":        displayName,
		"projectCustomName":         p.CustomName,
		"projectCustomIconRevision": p.CustomIconRevision,
		"projectRootPath":           p.RootPath,
		"projectKind":               projectKind,
		// projectIconRevision separates the built-in icon from a custom one so the sidebar
		// knows whether to fetch /projects/icons/<id>.json. Optional (not nullable): only set
		// when there is a custom icon, otherwise the key is omitted.
		"projectIconRevision": nil,
		// syncSeq is the per-record cursor the directory replica advances on each change.
		"syncSeq": directorySyncSeq(p.UpdatedAt),
	}
	if p.CustomIconRevision != nil && strings.TrimSpace(*p.CustomIconRevision) != "" {
		out["projectIconRevision"] = *p.CustomIconRevision
	} else {
		delete(out, "projectIconRevision")
	}
	if p.ProjectKey != nil {
		out["projectKey"] = *p.ProjectKey
	}
	return out
}

func buildWorkspaceDescriptor(ws store.WorkspaceRecord, prj store.ProjectRecord) map[string]any {
	name := ws.DisplayName
	if ws.Title != nil && strings.TrimSpace(*ws.Title) != "" {
		name = strings.TrimSpace(*ws.Title)
	} else if ws.Branch != nil && strings.TrimSpace(*ws.Branch) != "" {
		name = strings.TrimSpace(*ws.Branch)
	}
	projectDisplayName := prj.DisplayName
	if prj.CustomName != nil && strings.TrimSpace(*prj.CustomName) != "" {
		projectDisplayName = strings.TrimSpace(*prj.CustomName)
	}
	projectKind := prj.Kind
	if projectKind != "git" && projectKind != "non_git" && projectKind != "directory" {
		projectKind = "git"
	}
	workspaceKind := ws.Kind
	switch workspaceKind {
	case "directory", "local_checkout", "checkout", "worktree":
	default:
		workspaceKind = "local_checkout"
	}
	labels := ws.Labels
	if labels == nil {
		labels = []string{}
	}
	for _, lbl := range labels {
		if lbl == store.HomeWorkspaceLabel {
			projectKind = "non_git"
			workspaceKind = "directory"
			break
		}
	}
	var gitRuntime any
	if workspaceKind != "directory" && projectKind == "git" {
		gitRuntime = map[string]any{
			"currentBranch":          ws.Branch,
			"remoteUrl":              nil,
			"isBySpaceOwnedWorktree": ws.IsBySpaceOwnedWorktree,
			"isDirty":                false,
			"aheadBehind":            nil,
			"aheadOfOrigin":          nil,
			"behindOfOrigin":         nil,
		}
	}
	out := map[string]any{
		"id":                        ws.WorkspaceID,
		"projectId":                 prj.ProjectID,
		"projectDisplayName":        projectDisplayName,
		"projectCustomName":         prj.CustomName,
		"projectCustomIconRevision": prj.CustomIconRevision,
		"projectRootPath":           prj.RootPath,
		"workspaceDirectory":        ws.Cwd,
		"projectKind":               projectKind,
		"workspaceKind":             workspaceKind,
		"name":                      name,
		"title":                     ws.Title,
		"labels":                    labels,
		"pinnedAt":                  ws.PinnedAt,
		"archivingAt":               nil,
		"status":                    "done",
		"statusEnteredAt":           nil,
		"activityAt":                nil,
		"diffStat":                  nil,
		"scripts":                   []any{},
		"gitRuntime":                gitRuntime,
		"githubRuntime":             nil,
		"project": map[string]any{
			"projectKey":    projectIdentityKey(prj),
			"projectName":   projectDisplayName,
			"workspaceName": name,
			"checkout": buildProjectCheckoutPayload(
				ws.Cwd,
				projectKind == "git" && workspaceKind != "directory",
				ws.Branch,
				ws.IsBySpaceOwnedWorktree,
				ws.MainRepoRoot,
			),
		},
	}
	if ws.IsBySpaceOwnedWorktree {
		out["worktreeSlug"] = filepath.Base(ws.Cwd)
	}
	return out
}

// appendAttachmentHints materializes non-image composer attachments as text references
// so the model can read them from disk; oversized images ride the same path.
func appendAttachmentHints(text string, attachments []struct {
	Type     string `json:"type"`
	FileName string `json:"fileName"`
	Path     string `json:"path"`
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}) string {
	if len(attachments) == 0 {
		return text
	}
	lines := make([]string, 0, len(attachments))
	for _, att := range attachments {
		name := strings.TrimSpace(att.FileName)
		if name == "" {
			name = filepath.Base(att.Path)
		}
		if name == "" || name == "." {
			name = "attachment"
		}
		switch {
		case strings.TrimSpace(att.Path) != "":
			lines = append(lines, fmt.Sprintf("[Attached file: %s (%s) at %s]", name, att.MimeType, att.Path))
		case att.Type == "uploaded_file":
			lines = append(lines, fmt.Sprintf("[Attached file: %s (%s)]", name, att.MimeType))
		}
	}
	if len(lines) == 0 {
		return text
	}
	if strings.TrimSpace(text) == "" {
		return strings.Join(lines, "\n")
	}
	return text + "\n\n" + strings.Join(lines, "\n")
}

func newAgentID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "agt_" + hex.EncodeToString(b[:])
}

func sendSessionMsg(ctx context.Context, sink frameSink, msgType string, payload any) error {
	return sendJSON(ctx, sink, map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":    msgType,
			"payload": payload,
		},
	})
}

func sendJSON(ctx context.Context, sink frameSink, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return sink.SendText(ctx, string(b))
}

// branchPtr narrows an `any` branch value back to a *string for the checkout payload builder.
func branchPtr(v any) *string {
	if str, ok := v.(string); ok {
		return &str
	}
	return nil
}

// isHomeWorkspaceRecord reports whether the workspace carries the daemon-owned home label.
func isHomeWorkspaceRecord(ws store.WorkspaceRecord) bool {
	for _, lbl := range ws.Labels {
		if lbl == store.HomeWorkspaceLabel {
			return true
		}
	}
	return false
}

// buildProjectCheckoutPayload renders the `project.checkout` discriminated union exactly as
// ProjectCheckoutLitePayloadSchema demands: the non-git variant forbids a branch name, and the
// byspace-worktree variant requires mainRepoRoot as a string. Emitting one shape for all three
// cases makes the whole fetch_workspaces_response fail validation client-side.
func buildProjectCheckoutPayload(cwd string, isGit bool, branch *string, isBySpaceOwned bool, mainRepoRoot *string) map[string]any {
	if !isGit {
		return map[string]any{
			"cwd":                    cwd,
			"isGit":                  false,
			"currentBranch":          nil,
			"remoteUrl":              nil,
			"isBySpaceOwnedWorktree": false,
			"mainRepoRoot":           nil,
		}
	}
	if isBySpaceOwned {
		root := cwd
		if mainRepoRoot != nil && strings.TrimSpace(*mainRepoRoot) != "" {
			root = *mainRepoRoot
		}
		return map[string]any{
			"cwd":                    cwd,
			"isGit":                  true,
			"currentBranch":          branch,
			"remoteUrl":              nil,
			"isBySpaceOwnedWorktree": true,
			"mainRepoRoot":           root,
		}
	}
	return map[string]any{
		"cwd":                    cwd,
		"isGit":                  true,
		"currentBranch":          branch,
		"remoteUrl":              nil,
		"isBySpaceOwnedWorktree": false,
		"mainRepoRoot":           mainRepoRoot,
	}
}

// idempotentAgents deduplicates create_agent_request retries by idempotencyKey so a flaky
// transport cannot spawn two agents for one user action.
func (s *Server) lookupIdempotentAgent(key string) (store.AgentRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.idempotentAgents == nil {
		return store.AgentRecord{}, false
	}
	agentID, ok := s.idempotentAgents[key]
	if !ok {
		return store.AgentRecord{}, false
	}
	rec, err := s.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return store.AgentRecord{}, false
	}
	return *rec, true
}

func (s *Server) rememberIdempotentAgent(key, agentID string) {
	if strings.TrimSpace(key) == "" {
		return
	}
	s.mu.Lock()
	if s.idempotentAgents == nil {
		s.idempotentAgents = make(map[string]string)
	}
	s.idempotentAgents[key] = agentID
	s.mu.Unlock()
}

// applyCORS writes the allow-listed CORS headers and answers preflight requests.
// It reports whether the request was fully handled.
func (s *Server) applyCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		for _, allowed := range s.corsOrigins() {
			if allowed == "*" || allowed == origin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Vary", "Origin")
				break
			}
		}
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

// corsOrigins caches the resolved allow-list; config changes are rare and the
// middleware runs on every request.
func (s *Server) corsOrigins() []string {
	s.corsMu.RLock()
	if s.corsCache != nil {
		defer s.corsMu.RUnlock()
		return s.corsCache
	}
	s.corsMu.RUnlock()

	origins := s.store.CORSAllowedOrigins()
	s.corsMu.Lock()
	s.corsCache = origins
	s.corsMu.Unlock()
	return origins
}

// projectIdentityKey is the grouping key the sidebar joins on: the derived remote/path identity,
// falling back to the project id only when a record predates key derivation.
func projectIdentityKey(prj store.ProjectRecord) string {
	if prj.ProjectKey != nil && strings.TrimSpace(*prj.ProjectKey) != "" {
		return *prj.ProjectKey
	}
	return prj.ProjectID
}

// startUsagePolling samples the provider's token/cost accounting while a turn is in flight.
//
// The composer's context ring and session cost come from `agent.lastUsage`, which only exists
// if the daemon keeps asking. Node runs PiUsagePoller on a 3s timer; doing it only at turn end
// means the ring sits at 0% for the whole run and the hover tooltip has no data to show.
func (mp *managedPi) startUsagePolling(s *Server, sess providers.ManagedSession) {
	// pi emits one turn_started per model step (a tool-using turn has several), so this must
	// be idempotent: restarting the ticker on every step means it never reaches its first tick
	// when steps are short.
	s.mu.Lock()
	already := mp.usageStop != nil
	s.mu.Unlock()
	if already {
		return
	}
	stop := make(chan struct{})
	s.mu.Lock()
	mp.usageStop = stop
	s.mu.Unlock()
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				uctx, ucancel := context.WithTimeout(context.Background(), 5*time.Second)
				usage := sess.Usage(uctx)
				ucancel()
				if usage == nil {
					continue
				}
				s.mu.Lock()
				mp.record.Usage = usage
				recCopy := mp.record
				s.mu.Unlock()
				s.broadcastAgentUpdate(recCopy)
			}
		}
	}()
}

// stopUsagePolling ends the in-flight usage sampler; safe to call when none is running.
func (mp *managedPi) stopUsagePolling() {
	if mp.usageStop != nil {
		close(mp.usageStop)
		mp.usageStop = nil
	}
}

// captureFinalUsage samples token/cost accounting once the provider has gone idle.
//
// pi rejects get_session_stats while it is still streaming, so this must run after agent_end
// rather than at turn end. Mirrors PiUsagePoller.completeTurn in the node daemon.
func (s *Server) captureFinalUsage(mp *managedPi, sess providers.ManagedSession) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Give the provider a moment to settle before asking; a retry covers a slow flush.
	var usage *sdk.AgentUsage
	for attempt := 0; attempt < 3; attempt++ {
		usage = sess.Usage(ctx)
		if usage != nil {
			break
		}
		select {
		case <-time.After(500 * time.Millisecond):
		case <-ctx.Done():
			return
		}
	}
	if usage == nil {
		return
	}
	s.mu.Lock()
	mp.record.Usage = usage
	recCopy := mp.record
	s.mu.Unlock()
	s.broadcastAgentUpdate(recCopy)
}

// directorySyncMetadata is the cursor the client uses to detect a stale directory replica.
// It is checked against the same counters that drive incremental updates.
func (s *Server) directorySyncMetadata(mode string) map[string]any {
	catalog := s.store.LoadLabelCatalog()
	return map[string]any{
		"generation": catalog.Generation,
		"headSeq":    catalog.HeadSeq,
		"mode":       mode,
		"removals":   []any{},
	}
}

// broadcastWorkspaceUpsert tells connected clients that one workspace changed.
//
// The app maintains a directory replica and applies these deltas; without them the sidebar
// only changes on a full fetch, so an archived or newly created workspace lingers until reload.
func (s *Server) broadcastWorkspaceUpsert(ws store.WorkspaceRecord, prj store.ProjectRecord) {
	if ws.ArchivedAt != nil {
		s.broadcastSessionMsg("workspace_update", map[string]any{
			"kind":        "remove",
			"id":          ws.WorkspaceID,
			"projectId":   ws.ProjectID,
			"archivedAt":  ws.ArchivedAt,
			"projectRoot": prj.RootPath,
		})
		return
	}
	catalog := s.store.LoadLabelCatalog()
	s.broadcastSessionMsg("workspace_update", map[string]any{
		"kind":       "upsert",
		"workspace":  buildWorkspaceDescriptor(ws, prj),
		"generation": catalog.Generation,
		"seq":        catalog.HeadSeq + 1,
	})
}

// broadcastCheckoutStatusUpdate pushes a fresh git status for one checkout.
//
// The app subscribes to this and patches its query cache; polling `checkout_status_request`
// instead would mean every open workspace re-reads git on a timer.
func (s *Server) broadcastCheckoutStatusUpdate(ctx context.Context, cwd string) {
	if strings.TrimSpace(cwd) == "" {
		return
	}
	st := workspace.GetCheckoutStatus(ctx, cwd, "")
	s.broadcastSessionMsg("checkout_status_update", st)
}

// providerSnapshotHash fingerprints a provider catalog so the client can tell an unchanged
// snapshot from a rebuilt one, and so `ifNoneMatch` has something stable to compare against.
func providerSnapshotHash(entries []map[string]any) string {
	b, err := json.Marshal(entries)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(b)
	return "psh_" + hex.EncodeToString(sum[:8])
}

// providerFetchedAt builds the per-provider timestamp map the providers sheet renders as
// "last refreshed", taking each entry's own fetchedAt.
func providerFetchedAt(entries []map[string]any, fallback string) map[string]string {
	out := make(map[string]string, len(entries))
	for _, entry := range entries {
		provider, _ := entry["provider"].(string)
		if provider == "" {
			continue
		}
		if ts, ok := entry["fetchedAt"].(string); ok && ts != "" {
			out[provider] = ts
			continue
		}
		out[provider] = fallback
	}
	return out
}

// directorySyncSeq turns a record's updatedAt into the positive cursor the directory replica
// compares; zero would be rejected by the schema (`positive()`).
//
// Milliseconds, not nanoseconds: the protocol validates `int` against JavaScript's safe integer
// range (2^53-1 ≈ 9e15), and UnixNano is ~1.7e18 — every response would fail validation.
func directorySyncSeq(updatedAt string) int64 {
	t, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return 1
	}
	seq := t.UnixMilli()
	if seq <= 0 {
		return 1
	}
	return seq
}

// projectForWorkspace returns the project record that owns a workspace.
func (s *Server) projectForWorkspace(projectID string) (store.ProjectRecord, bool) {
	projects, _ := s.store.ListProjects()
	for _, prj := range projects {
		if prj.ProjectID == projectID {
			return prj, true
		}
	}
	return store.ProjectRecord{}, false
}

// hostAllowed decides whether a request's Host header may be served.
//
// Ported from the hostnames allow-list in config.ts. A daemon bound to loopback is still
// reachable by name from a browser: DNS rebinding points evil.example at 127.0.0.1 and the
// request arrives with Host: evil.example. Loopback literals and the operator's configured
// hostnames are the only Hosts that should be accepted.
func (s *Server) hostAllowed(hostHeader string) bool {
	host := hostHeader
	if h, _, err := net.SplitHostPort(hostHeader); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return true
	}

	// IP literals are unambiguous: the browser cannot rebind an IP.
	if ip := net.ParseIP(host); ip != nil {
		return true
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}

	s.mu.Lock()
	allowed := append([]string(nil), s.allowedHostnames...)
	s.mu.Unlock()
	for _, entry := range allowed {
		entry = strings.ToLower(strings.TrimSpace(entry))
		if entry == "" {
			continue
		}
		// "*" keeps the daemon usable behind an arbitrary reverse proxy; it is the
		// operator's explicit choice, not a default.
		if entry == "*" || entry == host {
			return true
		}
		// Support a leading-dot suffix rule (".example.com").
		if strings.HasPrefix(entry, ".") && strings.HasSuffix(host, entry) {
			return true
		}
	}

	// No allow-list configured means "not restricted", which is the node default: the check
	// exists for operators who opt in, not as a policy imposed on every install.
	if len(allowed) == 0 {
		return true
	}
	return false
}

// resolveAllowedHostnames merges the persisted hostnames config with the environment.
//
// The env var wins when set, matching the precedence the node daemon documents: an operator
// launching the container with BYSPACE_HOSTNAMES expects it to apply, not to be overridden by
// whatever an old config.json happens to hold.
func resolveAllowedHostnames(st *store.Store) []string {
	split := func(raw string) []string {
		out := make([]string, 0, 4)
		for _, part := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	}

	for _, key := range []string{"BYSPACE_HOSTNAMES", "BYSPACE_ALLOWED_HOSTS"} {
		if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
			return split(raw)
		}
	}
	if cfg := st.LoadDaemonConfig(); cfg != nil {
		if daemon, ok := cfg["daemon"].(map[string]any); ok {
			if list, ok := daemon["hostnames"].([]any); ok {
				out := make([]string, 0, len(list))
				for _, item := range list {
					if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
						out = append(out, strings.TrimSpace(s))
					}
				}
				return out
			}
		}
	}
	return nil
}

// agentLoad is one in-flight cold start, shared by every concurrent caller.
type agentLoad struct {
	done chan struct{}
	err  error
}
