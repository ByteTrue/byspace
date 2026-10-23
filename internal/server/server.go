package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/agentmode"
	"github.com/ByteTrue/byspace/internal/agentroles"
	"github.com/ByteTrue/byspace/internal/agenttitle"
	"github.com/ByteTrue/byspace/internal/attachment"
	"github.com/ByteTrue/byspace/internal/attention"
	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/serviceproxy"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/tunnel"
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
	// ListenAddr is the address the daemon bound to; the MCP bridge it injects into agents
	// must call the same one.
	ListenAddr string
	// DisableMCPInjection stops the daemon from adding its own MCP server to created agents.
	// Set from `serve --no-inject-mcp`: a user who configures their agent's MCP servers by hand
	// does not want one appearing behind their back.
	DisableMCPInjection bool
	// DisableWebUI turns off the bundled web UI. Set from `serve --no-web-ui`, which matters when
	// the daemon is one half of a split deployment and the UI is served elsewhere.
	DisableWebUI bool
	// RelayUseTLS marks pairing offers as wss://. Set from `serve --relay-use-tls`.
	RelayUseTLS bool
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
	homeDir  string
	serverID string
	version  string
	// epoch is the process-level timeline epoch. It changes on every daemon start, so a client can
	// tell its cached sequence numbers are stale and must discard positions from the previous run.
	//
	// Every response and event that carries a cursor or a sequence has to stamp this one value.
	// There used to be a second field with the same meaning and a different format, and the two
	// disagreed: the client compares the epoch on a prompt index against the epoch it already holds
	// from the timeline cursor, so the chat outline saw every index as stale and never rendered.
	epoch        string
	keyPair      e2ee.KeyPair
	pubKeyB64    string
	vapidKeys    home.VAPIDKeys
	store        *store.Store
	schedules    *schedule.Service
	webUI        *webui.Handler
	piCommand    string
	piSessionDir string
	// disableMCPInjection comes from --no-inject-mcp; read where the MCP server is attached to a
	// new agent.
	disableMCPInjection bool

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
	listenAddr            string
	// capabilityToken authorizes an agent's own MCP bridge to /mcp/agents without the user's
	// password, which the agent does not have.
	capabilityToken string
	// relay owns the relay connection's lifecycle so settings changes take effect without a
	// restart.
	relay *relayRuntime
	// relayOverride is a --relay flag that outranks the stored config.
	relayOverride string
	// clientPresence is what connected clients report about themselves, used to suppress
	// notifications for an agent the user is already looking at.
	clientPresence []attention.ClientPresence
	// sinkPermissions holds the granted permissions per connection. A connection absent from
	// this map acts as the owner, which is how a direct local connection behaves.
	sinkPermissions map[frameSink][]string
	// pushHTTPClient overrides the push transport; a test harness needs to reach a local
	// TLS push service without a trusted certificate.
	pushHTTPClient *http.Client
	// pendingUploads holds in-flight chunked uploads, keyed by request id.
	pendingUploads map[string]*pendingUpload
	// lastConfigSnapshot is the config as of the previous reload, so the next reload can say
	// which paths changed.
	lastConfigSnapshot map[string]any
	corsMu             sync.RWMutex
	corsCache          []string
	setupSnapshots     map[string]*setupSnapshot
	workspaceScripts   map[string]*workspaceScript
	// tunnels is the outbound (D1) registry, created on first use.
	tunnels *tunnel.Registry
	// tunnelTargetServer is the inbound (D2) handler, created on first use.
	tunnelTargetServer *tunnel.Target
	// tunnelStreamSinks maps an inbound stream id to the client that opened it, so downstream
	// bytes return to that socket rather than being broadcast.
	tunnelStreamSinks map[string]frameSink
	// tunnelsEnabled is the experimental gate (issue 063). It starts closed.
	tunnelsEnabled bool
	// serviceProxyRoutes serves `type: "service"` scripts at their hostnames.
	serviceProxyRoutes *serviceproxy.Proxy
	// labelSubscribers are sinks that asked for incremental label updates.
	labelSubscribers map[frameSink]bool
	// setupRuns guards against two concurrent setup runs for one workspace.
	setupRunsMu sync.Mutex
	setupRuns   map[string]bool
	// shutdownRequested receives a reason when a client asks the daemon to restart or stop. The
	// process owner (the CLI's `serve` loop) listens: a server cannot restart itself.
	shutdownRequested chan string
	// notifiedChildren records which (child, reason) pairs already prompted their parent.
	notifiedChildren   map[string]bool
	notifiedChildrenMu sync.Mutex
	scriptPorts        *servicePortAllocator
	idempotentAgents   map[string]string
	cachedPiModels     []pi.CatalogModel
	// cachedPiModelsCwd records which directory the cached model list was probed in: a different
	// project can expose different models, so the cache must not outlive its context.
	cachedPiModelsCwd string
	cachedPiCommands  []pi.SlashCommand
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
	if ui == nil && !opts.DisableWebUI {
		ui = webui.NewHandler(opts.WebDir)
	}
	if ui != nil {
		ui = ui.WithConnectionHint("BySpace")
	}

	st := store.New(homeDir)
	st.SetServerID(serverID)
	// E2E specs assert exact workspace counts, so the daemon-owned Chief workspace must be
	// suppressible: with it present every count shifts by one.
	// Node removes the pre-1.0 `agent-timelines` directory on every boot; it was superseded by
	// provider-owned transcripts. Leaving it behind means old timeline files linger and can be
	// picked up by nothing, but they do consume disk and confuse anyone inspecting the home.
	_ = os.RemoveAll(filepath.Join(homeDir, "agent-timelines"))

	// A home can lose its workspace registry while agent records survive (partial copy, failed
	// write, an upgraded install). Rebuilding from the agents is the difference between an empty
	// sidebar and a usable one.
	_, _ = st.RebuildWorkspaceRegistryFromAgents()

	// Existing homes may hold projects persisted before key derivation existed; without a key
	// they cannot join a cross-host group.
	_ = st.BackfillProjectKeys()
	if strings.TrimSpace(os.Getenv("BYSPACE_DISABLE_HOME_WORKSPACE")) != "1" {
		_ = st.EnsureHomeWorkspace(serverID)
	}
	capabilityToken := ""
	if raw, err := os.ReadFile(filepath.Join(homeDir, "mcp-capability-token")); err == nil {
		capabilityToken = strings.TrimSpace(string(raw))
	} else {
		// Per-daemon-run token: an agent's MCP bridge presents it instead of the user's
		// password, and it stops working when the daemon restarts.
		buf := make([]byte, 24)
		if _, randErr := rand.Read(buf); randErr == nil {
			capabilityToken = base64.RawURLEncoding.EncodeToString(buf)
			_ = home.WriteAtomic(filepath.Join(homeDir, "mcp-capability-token"), []byte(capabilityToken+"\n"), 0o600)
		}
	}

	srv := &Server{
		shutdownRequested:     make(chan string, 1),
		homeDir:               homeDir,
		listenAddr:            opts.ListenAddr,
		capabilityToken:       capabilityToken,
		relay:                 newRelayRuntime(RelayConfig{}),
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
		disableMCPInjection:   opts.DisableMCPInjection,
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
	// Legacy agent records written before workspaceId existed have no owner, which makes them
	// invisible: they appear in no workspace and History cannot restore them. Stamp them once
	// here so nothing downstream needs a fallback.
	if backfilled := srv.store.BackfillWorkspaceOwnership(); backfilled > 0 {
		fmt.Fprintf(os.Stderr, "backfilled workspace ownership for %d agent record(s)\n", backfilled)
	}

	srv.startSubscriptionPoller()
	// A relay configured in settings must connect at boot, not only when a CLI flag is passed.
	srv.ApplyRelayConfig(context.Background())
	// Terminal tabs are recreated at startup from the persisted metadata. The processes and their
	// scrollback are gone — nothing can bring a shell back — but the tabs are not: reopening the
	// app should show the terminal the user was using, with its original id so the client's saved
	// layout still resolves.
	srv.restorePersistedTerminals()
	// The daemon ships the skills, so after an update every installed copy is stale until someone
	// re-saves the selection — and the user has no reason to do that.
	srv.autoUpdateInstalledSkills()
	return srv, nil
}

func (s *Server) ServerID() string     { return s.serverID }
func (s *Server) PublicKeyB64() string { return s.pubKeyB64 }
func (s *Server) HomeDir() string      { return s.homeDir }
func (s *Server) Store() *store.Store  { return s.store }

// Close shuts down any live Pi agent subprocesses and PTY sessions.
func (s *Server) Close() error {
	// The shared `opencode serve` process outlives individual agents, so it is stopped here rather
	// than in an agent's Close. Without this the daemon exits and leaves an orphaned server holding a
	// port until the machine restarts.
	providers.ShutdownOpenCodePool()

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

	// A registered service hostname is served by the reverse proxy, not by the daemon API. Checked
	// after hostAllowed so a rebinding attempt cannot reach a script, and before auth because a dev
	// server has its own access control (usually none).
	s.mu.Lock()
	proxy := s.serviceProxyRoutes
	s.mu.Unlock()
	if proxy != nil {
		if _, registered := proxy.Lookup(r.Host); registered {
			proxy.ServeHTTP(w, r)
			return
		}
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
	// Terminal frames and file-transfer frames share the byte stream; they are discriminated by
	// opcode. Trying the terminal decoder first dropped every upload silently, because a file
	// frame carries a request id where the terminal decoder expects a slot.
	// Tunnel frames come first: their opcodes (0x20..0x22) sit above both other families, and
	// the terminal decoder would reject them as a bad slot — silently dropping every forwarded
	// byte from a peer.
	if len(raw) > 0 && tunnel.IsTunnelOpcode(raw[0]) {
		frame, ok := tunnel.DecodeFrame(raw)
		if !ok {
			return
		}
		s.tunnelTarget().HandleFrame(frame, func(outgoing tunnel.Frame) error {
			encoded, encodeErr := tunnel.EncodeFrame(outgoing.Opcode, outgoing.TunnelID, outgoing.Payload)
			if encodeErr != nil {
				return encodeErr
			}
			// The peer that opened this stream is the sink that must receive the bytes back.
			return s.sendTunnelFrameToOpener(ctx, outgoing.TunnelID, encoded)
		})
		return
	}

	if len(raw) > 0 && terminal.IsFileTransferOpcode(terminal.Opcode(raw[0])) {
		fileFrame, err := terminal.DecodeFileFrame(raw)
		if err != nil {
			return
		}
		if response := s.receiveUploadFrame(fileFrame); response != nil {
			_ = sendSessionMsg(ctx, sink, "file.upload.response", response)
		}
		return
	}

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
		// Node dispatches a session message without awaiting the handler (`void
		// this.dispatchSessionMessage(...)`), so one slow read never delays the frames queued
		// behind it. Handling them inline here made a send_agent_message wait ~950ms behind an
		// unrelated checkout_pr_status plus two provider snapshots, and the composer spends
		// that whole window with submit disabled.
		if sessionMessageNeedsOrder(envelope.Message) {
			// Node still registers these before the next frame is read (its handler runs
			// synchronously up to the first await). Binary transfer frames depend on it: an
			// upload's metadata frame must land before its first chunk.
			s.handleSessionMessage(ctx, sink, envelope.Message)
			return
		}
		go func(ctx context.Context, raw json.RawMessage) {
			defer func() {
				if recovered := recover(); recovered != nil {
					fmt.Fprintf(os.Stderr, "session handler panicked: %v\n%s\n", recovered, debug.Stack())
				}
			}()
			// A disconnect must not abort a handler the client already committed to; Node keeps
			// running them too.
			s.handleSessionMessage(context.WithoutCancel(ctx), sink, raw)
		}(ctx, envelope.Message)
	}
}

// sessionMessageNeedsOrder lists the messages that register socket-scoped state a following
// binary frame or subscription event depends on. They run inline; everything else is dispatched
// concurrently.
func sessionMessageNeedsOrder(raw json.RawMessage) bool {
	var head struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(raw, &head)
	switch head.Type {
	case "file.upload.request",
		"create_terminal_request",
		"subscribe_terminal_request",
		"subscribe_terminals_request",
		"fs.file.subscribe.request",
		"subscribe_checkout_diff_request",
		"session.events.set_subscription.request",
		"agent.timeline.set_subscription.request":
		return true
	}
	return false
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
			"webPush":              s.vapidKeys.PublicKey != "",
			"skillInstallTargets":  true,
			"agentRoles":           true,
			"agentRoleNames":       []string{"chief"},
			"agentRequestReceipts": true,
			// Hub was removed by decision (issue 025, commit 446bc38a3d). The wire messages still parse.
			"hubAgentRpc": false,
			// Hub was removed by decision (issue 025).
			"hubRelationship": false,
			// Cross-host directory sync is undecided product work.
			"directorySync":                   false,
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
			// The plugin system was retired by decision (issue 025, commit a5c6bb6588). Wire parsing stays.
			"plugins": false,
			// Plugin system retired by decision (issue 025).
			"pluginManagement": false,
			// Plugin system retired by decision (issue 025).
			"pluginGitManagement": false,
			// Plugin system retired by decision (issue 025).
			"pluginLogs": false,
			// Plugin system retired by decision (issue 025).
			"pluginThemes": false,
			// Plugin system retired by decision (issue 025).
			"pluginSettings": false,
			// Plugin system retired by decision (issue 025).
			"pluginTimelineItems": false,
			"skillManagement":     true,
			// Tunnel is a delivered feature (issue 062) that the Go port has not picked up yet; the RPCs
			// Implemented: registry, relay client, target-side forwarding. The experimental gate
			// (issue 063) still starts closed, so the UI shows the entry point and the feature is
			// off until the operator opts in — which is the published behaviour.
			"daemonTunnels":              true,
			"projectSetupSkill":          true,
			"terminalAgentHookProviders": true,
			"terminalShellConfig":        true,
			"terminal-restore-modes":     true,
			"terminal-input-mode-replay": true,
			"terminal-size-ownership":    true,
			"workspaceTerminals":         true,
			"rewind":                     true,
			"agentTimelinePromptIndex":   true,
			"agentHistorySearch":         true,
			"checkoutRefresh":            true,
			"workspaceAgentRename":       true,
			"workspaceMultiplicity":      true,
			"projectRemove":              true,
			"projectAdd":                 true,
			"projectList":                true,
			"worktreeRestore":            true,
			"workspaceRecovery":          true,
			"workspaceFileEditing":       true,
			"providerUsageList":          true,
			"agentDetach":                true,
			"agentThinkingUpdate":        true,
			"daemonDiagnostics":          true,
			// Implemented: downloads the release for this platform and replaces the binary.
			"daemonSelfUpdate":             true,
			"agentForkContext":             true,
			"agentForkContextCursor":       true,
			"providerSubagents":            true,
			"providerSubagentNesting":      true,
			"workspacePinning":             true,
			"workspaceMarkUnread":          true,
			"projectCreateDirectory":       true,
			"commitsList":                  true,
			"commitBaseClassification":     true,
			"providerRemoval":              true,
			"importSessionWorkspaceTarget": true,
			"importSessionSearch":          true,
			"selectiveAgentTimeline":       true,
			"explicitEventSubscriptions":   true,
			"canonicalSubmittedPrompts":    true,
			"stableProjectIdentity":        true,
			"workspaceScriptManagement":    true,
			"projectCustomIcon":            true,
			"fsEntryOps":                   true,
			"fsEntryDuplicate":             true,
			"checkoutDiscardChanges":       true,
			"agentProfiles":                true,
			"agentConfigApply":             true,
			"daemonNetworkConfig":          true,
			"daemonServiceInstall":         true,
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

	// Every request is authorized before it is dispatched. The table says which semantic
	// permission each operation needs; a connection that authenticated with a password but was
	// granted no permissions must not be able to drive agents or edit files just because it
	// reached the handler. Local connections hold everything, which is what keeps the app
	// working unchanged.
	if !s.authorizationForSink(sink).AllowsInbound(base.Type) {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "error",
			"error":     "Permission denied for " + base.Type,
			"requestId": base.RequestID,
		})
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
		// `cwd` scopes the probe — a provider's model list can depend on the project — and
		// `providers` narrows it to the cards the user touched, so refreshing one does not re-probe
		// every provider. Both are optional: an empty request refreshes everything.
		var refreshReq struct {
			RequestID string   `json:"requestId"`
			Cwd       string   `json:"cwd"`
			Providers []string `json:"providers"`
		}
		_ = json.Unmarshal(raw, &refreshReq)

		s.mu.Lock()
		s.cachedPiModels = nil
		if strings.TrimSpace(refreshReq.Cwd) != "" {
			s.cachedPiModelsCwd = refreshReq.Cwd
		}
		s.mu.Unlock()
		models := s.probePiModelsInCwd(ctx, refreshReq.Cwd)
		cfg := s.store.LoadDaemonConfig()
		customProvs, _ := cfg["providers"].(map[string]any)
		entries := providers.BuildSnapshotEntries(models, s.piCommand, customProvs)
		if len(refreshReq.Providers) > 0 {
			entries = filterSnapshotEntries(entries, refreshReq.Providers)
		}
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
			// cwd scopes the probe: a project can carry repo-local provider config, so the same
			// provider exposes different models in different checkouts.
			Cwd string `json:"cwd"`
			// DraftConfig describes a provider the user is configuring but has not saved. Its
			// features must come from the draft, not from a saved entry that does not exist yet —
			// otherwise the "add provider" form shows the wrong toggles and then changes them
			// after saving.
			DraftConfig map[string]any `json:"draftConfig"`
		}
		_ = json.Unmarshal(raw, &req)
		prov := strings.TrimSpace(req.Provider)
		if prov == "" {
			if draftProvider, ok := req.DraftConfig["provider"].(string); ok && strings.TrimSpace(draftProvider) != "" {
				prov = strings.TrimSpace(draftProvider)
			} else {
				prov = "pi"
			}
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		var models []pi.CatalogModel
		if prov == "pi" {
			// cwd scopes the probe; empty means "whatever is cached".
			models = s.probePiModelsInCwd(ctx, req.Cwd)
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
			// Same reason as models: modes can depend on the checkout.
			Cwd string `json:"cwd"`
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
			// DraftConfig describes a provider the user is configuring but has not saved; its
			// features must come from the draft rather than from an entry that does not exist yet.
			DraftConfig map[string]any `json:"draftConfig"`
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
			// The model comes from the draft: the provider sheet asks for features while the user is
			// still choosing, and a model-gated feature (fast mode) must not appear before a model that
			// supports it is picked.
			"features":  providers.ProviderFeaturesFor(prov, draftModelFromConfig(req.DraftConfig)),
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
		// buildAgentSnapshotPayload takes s.mu itself, so it must be called with the lock
		// released — calling it inside this block deadlocks the request handler.
		s.mu.Lock()
		var snapshotRecord *store.AgentRecord
		if mp2 := s.agents[req.AgentID]; mp2 != nil {
			rec := mp2.record
			snapshotRecord = &rec
		}
		s.mu.Unlock()
		var agentSnapshot any
		if snapshotRecord != nil {
			agentSnapshot = s.buildAgentSnapshotPayload(*snapshotRecord)
		}
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

	// COMPAT(workspaceScriptStartFlat): added before v0.21, remove after 2027-06-01. The flat name is
	// `start_workspace_script_request`; the protocol still declares it, so the daemon must keep parsing it —
	// but it must not run a second, different implementation. Both names reach the same handler.
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
		RequestID string  `json:"requestId"`
		Title     *string `json:"title"`
		// Cwd is what the CLI sends; Source.Path is what the web client sends. Both name the directory to
		// open, and reading only one of them silently opened the daemon's own working directory instead —
		// the workspace appeared, just in the wrong place, with the requested path dropped.
		Cwd string `json:"cwd"`
		// Path is the flat form the CLI's older requests used.
		Path              string `json:"path"`
		FirstAgentContext any    `json:"firstAgentContext"`
		Source            struct {
			Kind string `json:"kind"`
			Path string `json:"path"`
			// A worktree source names a project and a branch instead of a directory: the directory does not exist
			// yet, it is what this call creates. Requiring a path for every kind made every worktree-source
			// request fail with "needs a directory".
			ProjectID    string `json:"projectId"`
			BaseBranch   string `json:"baseBranch"`
			BranchName   string `json:"branchName"`
			WorktreeSlug string `json:"worktreeSlug"`
			Action       string `json:"action"`
		} `json:"source"`
	}
	_ = json.Unmarshal(raw, &req)

	// A worktree source resolves its cwd from the project, because the directory it names is the one being created.
	if strings.TrimSpace(req.Source.Kind) == "worktree" {
		projectRoot := s.projectRootByID(req.Source.ProjectID)
		if projectRoot == "" {
			_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
				"requestId":       req.RequestID,
				"workspace":       nil,
				"setupTerminalId": nil,
				"error":           "workspace.create with a worktree source needs a known project",
			})
			return
		}
		s.handleWorkspaceCreateFromWorktree(ctx, sink, req.RequestID, projectRoot, req.Title, req.Source.Action,
			req.Source.BaseBranch, req.Source.BranchName, req.Source.WorktreeSlug)
		return
	}

	cwd := firstNonEmptyTrimmed(req.Source.Path, req.Cwd, req.Path)
	if cwd == "" {
		_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
			"requestId":       req.RequestID,
			"workspace":       nil,
			"setupTerminalId": nil,
			"error":           "workspace.create needs a directory",
		})
		return
	}
	prj, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
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
		// Sync carries the client's cursor for the agent directory. Without reading it every poll
		// is a snapshot, so the client re-renders the whole list instead of applying a delta.
		Sync *struct {
			Generation string `json:"generation"`
			AfterSeq   *int64 `json:"afterSeq"`
		} `json:"sync"`
	}
	_ = json.Unmarshal(raw, &req)

	syncMode := "snapshot"
	syncReason := ""
	if req.Sync != nil {
		catalog := s.store.LoadLabelCatalog()
		switch {
		case req.Sync.Generation == "":
			syncMode, syncReason = "snapshot", "no_cursor"
		case req.Sync.Generation != catalog.Generation:
			syncMode, syncReason = "snapshot", "generation_changed"
		case req.Sync.AfterSeq == nil:
			syncMode, syncReason = "snapshot", "no_cursor"
		default:
			syncMode = "changes"
		}
	}

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
	payload["sync"] = s.directorySyncMetadataWithReason(syncMode, syncReason)
	if reqType == "fetch_agent_history_request" {
		payload["searchTruncated"] = false
	}
	_ = sendSessionMsg(ctx, sink, respType, payload)
}

func (s *Server) handleCreateAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID       string  `json:"requestId"`
		WorkspaceID     string  `json:"workspaceId"`
		InitialPrompt   *string `json:"initialPrompt"`
		ClientMessageID string  `json:"clientMessageId"`
		IdempotencyKey  string  `json:"idempotencyKey"`
		CallerAgentID   string  `json:"callerAgentId"`
		WorktreeName    string  `json:"worktreeName"`
		// Worktree is the structured intent: branch off a new branch, check out an existing one,
		// or check out a change request. `worktreeName` is the simple form; this is the one the UI
		// uses, and ignoring it meant every worktree agent landed on the default branch.
		Worktree *struct {
			Mode      string `json:"mode"`
			NewBranch string `json:"newBranch"`
			Base      string `json:"base"`
			Branch    string `json:"branch"`
			PrNumber  int    `json:"prNumber"`
		} `json:"worktree"`
		OutputSchema any               `json:"outputSchema"`
		AutoArchive  any               `json:"autoArchive"`
		Git          any               `json:"git"`
		Env          map[string]string `json:"env"`
		Images       []struct {
			Data     string `json:"data"`
			MimeType string `json:"mimeType"`
		} `json:"images"`
		Attachments []promptAttachment `json:"attachments"`
		Config      struct {
			Provider         string            `json:"provider"`
			Cwd              string            `json:"cwd"`
			Title            *string           `json:"title"`
			Model            *string           `json:"model"`
			ThinkingOptionID *string           `json:"thinkingOptionId"`
			ModeID           *string           `json:"modeId"`
			Role             *string           `json:"role"`
			SystemPrompt     *string           `json:"systemPrompt"`
			Labels           map[string]string `json:"labels"`
			// ProviderOptions carries provider-specific settings the client configured (reasoning
			// effort, a model provider, sandbox flags). It was absent from this struct, so every
			// value the user set in the provider sheet was silently dropped at create time.
			ProviderOptions map[string]any `json:"providerOptions"`
			// FeatureValues are the provider's own toggles and knobs (mock's scripted-failure counters,
			// a forced assistant response). They live beside providerOptions in the protocol, not inside
			// it, and were absent here: every featureValues the specs set at create time was dropped, so
			// mockPromptRejections, mockSteerAmbiguousFailures and the rest silently did nothing.
			FeatureValues map[string]any `json:"featureValues"`
			// ToolPolicy carries the BySpace tools the user pre-approved. Codex does not inherit an
			// allow-list from us — each MCP server declares its own — so without this a pre-approved
			// tool still prompts, and a sub-agent with nobody watching hangs on that prompt.
			ToolPolicy *struct {
				Preapproved []struct {
					Kind   string `json:"kind"`
					Server string `json:"server"`
					Tool   string `json:"tool"`
				} `json:"preapproved"`
			} `json:"toolPolicy"`
		} `json:"config"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return
	}

	cwd := strings.TrimSpace(req.Config.Cwd)

	// A child agent's directory is resolved against its parent's, not against the daemon's working
	// directory: an agent working in a worktree that spawns a helper with cwd "packages/app" means
	// that path inside the worktree. Falling back to os.Getwd() put the child in the daemon's own
	// directory, which is almost never where the parent is.
	parentCwd := s.parentAgentCwd(req.CallerAgentID)
	if parentCwd != "" {
		cwd = resolveChildCwd(parentCwd, cwd)
	}

	// A structured worktree intent wins over the simple name: it says which branch to be on, and
	// the whole point of a worktree is that the branch is not the default one.
	if req.Worktree != nil && strings.TrimSpace(req.Worktree.Mode) != "" {
		if created, createErr := s.createWorktreeForIntent(ctx, cwd, req.Worktree); createErr == nil && created != "" {
			cwd = created
		}
	}

	// `worktreeName` asks for a BySpace-owned worktree for this agent. Without it a request to
	// work on a branch shares the main checkout with every other agent, so two agents on two
	// branches fight over one working tree — which is the reason worktrees exist.
	if name := strings.TrimSpace(req.WorktreeName); name != "" {
		if created, createErr := s.createWorktreeForAgent(ctx, cwd, name); createErr == nil && created != "" {
			cwd = created
		}
	}

	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	absCwd, err := filepath.Abs(cwd)
	if err == nil {
		cwd = absCwd
	}

	// An explicit workspace wins over the one inferred from cwd. Ignoring it put the agent in
	// whichever workspace happened to own the directory — for a child created with the parent's
	// cwd that is the same workspace, but for a caller that names a different one it silently
	// placed the agent somewhere the sidebar will not show it under.
	var ws *store.WorkspaceRecord
	if explicit := strings.TrimSpace(req.WorkspaceID); explicit != "" {
		ws = s.findWorkspaceRecord(explicit)
		if ws == nil {
			_ = sendSessionMsg(ctx, sink, "status", map[string]any{
				"status":    "agent_create_failed",
				"requestId": req.RequestID,
				"error":     "unknown workspace: " + explicit,
			})
			return
		}
	}
	if ws == nil {
		_, inferred, ensureErr := s.store.EnsureWorkspaceForCwd(cwd)
		if ensureErr != nil {
			_ = sendSessionMsg(ctx, sink, "status", map[string]any{
				"status":    "agent_create_failed",
				"requestId": req.RequestID,
				"error":     ensureErr.Error(),
			})
			return
		}
		inferredCopy := inferred
		ws = &inferredCopy
	}

	provider := strings.TrimSpace(req.Config.Provider)
	if provider == "" {
		provider = "pi"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	agentID := newAgentID()
	// The derived title is the first content line of the prompt, whitespace-collapsed and clamped
	// in characters. Slicing the raw prompt at 60 bytes produced a title containing a newline and
	// could cut a multi-byte character in half — the sidebar then showed a broken glyph and a
	// wrapped second line.
	derived := agenttitle.Resolve(derefOr(req.Config.Title, ""), derefOr(req.InitialPrompt, ""))
	var title *string
	if derived.Explicit != "" {
		explicit := derived.Explicit
		title = &explicit
	} else if derived.Provisional != "" {
		provisional := derived.Provisional
		title = &provisional
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

	// A client must not be able to label its agent as one of the daemon's own roles: the label
	// carries Chief's prompt and privileges, so forging it would grant them.
	agentLabels := agentroles.StripReserved(req.Config.Labels)
	for key := range agentLabels {
		if strings.HasPrefix(key, "byspace.") {
			// Other byspace.* keys are daemon-owned for the same reason.
			delete(agentLabels, key)
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
		// The parent relationship is carried in a label, not only in the field: the client groups a
		// child under its parent by reading `byspace.parent-agent-id`, so a child created without it
		// appears as an unrelated top-level agent. The constant existed and nothing wrote it.
		agentLabels[ParentAgentIDLabel] = caller
	}

	// A mode id is provider-specific, so a child created from a parent in another provider cannot
	// inherit it: the child would run with a mode its provider does not recognise, silently using
	// the provider default instead of the posture the caller asked for. Resolve refuses that unless
	// the intent can be bridged (both sides unattended) or the caller passed an explicit mode.
	resolvedMode, modeErr := agentmode.Resolve(s.agentModeInput(provider, req.Config.ModeID, callerPtr))
	if modeErr != nil {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_create_failed",
			"error":     modeErr.Error(),
			"requestId": req.RequestID,
		})
		return
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
		LastModeID:    resolvedMode,
		ParentAgentID: callerPtr,
		Config: &store.AgentConfig{
			Model:            req.Config.Model,
			ThinkingOptionID: req.Config.ThinkingOptionID,
			ModeID:           resolvedMode,
			Role:             req.Config.Role,
			SystemPrompt:     req.Config.SystemPrompt,
			ProviderOptions:  req.Config.ProviderOptions,
			FeatureValues:    req.Config.FeatureValues,
			PreapprovedTools: storePreapprovedTools(req.Config.ToolPolicy),
		},
	}

	// The workspace gets a real title from the first prompt, in the background: a worktree created
	// from a request otherwise shows a slug in the sidebar until the user renames it by hand.
	if req.InitialPrompt != nil {
		s.scheduleWorkspaceAutoName(ws.WorkspaceID, cwd, *req.InitialPrompt)
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
		mp.session.SetNextClientMessageID(normalizeClientMessageID(req.ClientMessageID))
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
		mp.record.LastStatus = resolveAgentStatus(mp.record.LastStatus, mp.session.Status())
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
		Attachments []promptAttachment `json:"attachments"`
	}
	_ = json.Unmarshal(raw, &req)
	text := req.Text
	if text == "" {
		text = req.Prompt
	}
	clientMsgID := req.MessageID
	if clientMsgID == "" {
		// A whitespace-only id is absent, not an id: two messages carrying " " would collide and one
		// would be dropped as a duplicate of the other.
		clientMsgID = resolveClientMessageID(req.ClientMessageID, newMessageID())
	}

	images := make([]pi.ImageContent, 0, len(req.Images))
	for _, img := range req.Images {
		if img.Data == "" {
			continue
		}
		images = append(images, pi.ImageContent{Type: "image", Data: img.Data, MimeType: img.MimeType})
	}
	text = appendAttachmentHints(text, req.Attachments)

	// Sending a message to an archived agent unarchives it. Node does the same by default: the
	// archive is a tidy-up, not a tombstone, and refusing would make "continue this conversation"
	// fail with an error the user cannot act on. The finish-notification path is the one exception,
	// and it does not go through here.
	if record, readErr := s.store.GetAgent(req.AgentID); readErr == nil && record != nil && record.ArchivedAt != nil {
		if unarchived, archiveErr := s.store.UnarchiveAgent(req.AgentID); archiveErr == nil && unarchived != nil {
			// The client's sidebar still shows the agent as archived; without this broadcast the
			// message is accepted and the row stays greyed out until a reload.
			s.broadcastAgentUpdate(*unarchived)
		}
	}

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
		// Interrupt semantics: the client sends "interrupt" for an ordinary send and relies on the
		// daemon to cancel any running turn before starting the new one — node does this through
		// replaceAgentRun, and the composer's own comment says the server interrupts atomically. A
		// provider is free to reject a prompt that arrives mid-turn (the scripted one does), so
		// cancelling here is what turns "send while running" into a replacement instead of a failure.
		if turnID, _ := mp.session.ActiveTurn(); turnID != "" {
			_ = mp.session.Abort(ctx)
			// Let the cancelled turn settle before opening the next one, so the provider is not asked
			// to start a turn while it is still tearing the previous one down. Bounded: a provider that
			// never reports its finish must not wedge the send.
			waitCtx, waitCancel := context.WithTimeout(ctx, 5*time.Second)
			_ = mp.session.WaitForFinish(waitCtx)
			waitCancel()
		}
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

	// A provider can accept the prompt and never start the turn. Without this wait the client shows
	// "working" with no way to tell it apart from a hung agent, and the message appears to vanish.
	// A steer has no new turn to wait for — the turn it joins is already running — so it is skipped.
	if !wantSteer {
		if startErr := s.waitForRunStart(ctx, req.AgentID, mp.record.Provider); startErr != nil {
			_ = sendSessionMsg(ctx, sink, "send_agent_message_response", map[string]any{
				"requestId": req.RequestID,
				"agentId":   req.AgentID,
				"accepted":  false,
				"error":     startErr.Error(),
			})
			return
		}
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mp.record.UpdatedAt = now
	mp.record.LastUserMessageAt = &now
	mp.record.LastStatus = resolveAgentStatus(mp.record.LastStatus, mp.session.Status())
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

	streamMax := mp.session.StreamSeq()
	// The window describes the whole timeline, not the page: minSeq/maxSeq are its bounds and
	// nextSeq is where the next live event lands. Pagination reads the same bounds so hasOlder and
	// hasNewer agree with what the window claims.
	//
	// maxSeq is the last row's real end, never the session's stream counter. The counter is
	// monotonic and does not roll back when a rewind truncates the timeline, so reading it here
	// reported a window far wider than the rows actually present — and the client treats a response
	// whose maxSeq equals its own cursor as one carrying nothing new and discards it whole, which
	// left the rewound-away messages on screen.
	winMin, winMax := 0, 0
	if len(allTL) > 0 {
		winMin = timelineSeqStartOf(allTL[0])
		winMax = timelineSeqEndOf(allTL[len(allTL)-1])
	}

	limit := req.Limit
	if limit < 0 {
		limit = 0
	}
	cursorSeq := 0
	if req.Cursor != nil {
		cursorSeq = req.Cursor.Seq
	}
	page := selectTimelinePage(projectTimelineRows(allTL, projection), direction, cursorSeq, limit, winMin, winMax)

	entries := make([]map[string]any, 0, len(page.entries))
	for _, e := range page.entries {
		collapsed := e.Collapsed
		if collapsed == nil {
			collapsed = []string{}
		}
		ranges := make([]map[string]any, 0, len(e.SourceSeqRanges))
		for _, r := range e.SourceSeqRanges {
			ranges = append(ranges, map[string]any{"startSeq": r.StartSeq, "endSeq": r.EndSeq})
		}
		entry := map[string]any{
			"provider":        mp.record.Provider,
			"item":            e.Item,
			"timestamp":       e.Timestamp,
			"seqStart":        e.SeqStart,
			"seqEnd":          e.SeqEnd,
			"sourceSeqRanges": ranges,
			"collapsed":       collapsed,
		}
		if e.TurnID != "" {
			entry["turnId"] = e.TurnID
		}
		entries = append(entries, entry)
	}

	// The cursors describe the page that was returned, not the whole timeline: the client records
	// them as the range it now holds, so a cursor spanning entries it never received would make it
	// believe it has history it does not.
	var startCursor, endCursor any
	if len(page.entries) > 0 {
		startCursor = map[string]any{"epoch": s.epoch, "seq": page.entries[0].SeqStart}
		endCursor = map[string]any{"epoch": s.epoch, "seq": page.entries[len(page.entries)-1].SeqEnd}
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
			"minSeq":  winMin,
			"maxSeq":  winMax,
			"nextSeq": streamMax + 1,
		},
		"startCursor": startCursor,
		"endCursor":   endCursor,
		"hasOlder":    page.hasOlder,
		"hasNewer":    page.hasNewer,
		"mergeWindow": req.MergeWindow,
		"entries":     entries,
		"error":       nil,
	})
}

// timelineSeqStartOf is the first source seq an entry occupies.
func timelineSeqStartOf(e pi.TimelineEntry) int {
	start := e.Seq
	if start <= 0 {
		start = 1
	}
	return start
}

// timelineSeqEndOf is the last source seq an entry occupies. A streamed message spans seq..seqEnd;
// a discrete item has seqEnd == seq (or an unset seqEnd, which means the same seq).
func timelineSeqEndOf(e pi.TimelineEntry) int {
	end := e.SeqEnd
	if start := timelineSeqStartOf(e); end < start {
		end = start
	}
	return end
}

// timelinePage is one fetch's selection plus the coverage flags the client pages on.
type timelinePage struct {
	entries  []projectedEntry
	hasOlder bool
	hasNewer bool
}

// selectTimelinePage picks the projected rows for one fetch direction and reports what remains
// beyond the page. It pages projected rows, not raw deltas: the limit the client sends counts
// messages and tool cards, and a raw page of 40 would be 40 fragments of a single assistant
// message. A limit of 0 means "no limit".
//
// `tail` and `before` keep the newest `limit` rows; `after` keeps the oldest, so a client that
// reconnects and pages forward walks history in order instead of jumping to the end.
func selectTimelinePage(all []projectedEntry, direction string, cursorSeq, limit, winMin, winMax int) timelinePage {
	if len(all) == 0 {
		// No bounds to page against: nothing older, nothing newer, in every direction.
		return timelinePage{}
	}
	switch direction {
	case "after":
		selected := make([]projectedEntry, 0, len(all))
		for _, e := range all {
			if e.SeqEnd > cursorSeq {
				selected = append(selected, e)
			}
		}
		if limit > 0 && len(selected) > limit {
			selected = selected[:limit]
		}
		startSeq := cursorSeq + 1
		if winMin > startSeq {
			startSeq = winMin
		}
		hasNewer := len(selected) > 0 && selected[len(selected)-1].SeqEnd < winMax
		return timelinePage{entries: selected, hasOlder: startSeq > winMin, hasNewer: hasNewer}
	case "before":
		endSeq := cursorSeq - 1
		if winMax < endSeq {
			endSeq = winMax
		}
		hasNewer := endSeq < winMax
		if endSeq < winMin {
			return timelinePage{entries: nil, hasNewer: hasNewer}
		}
		eligible := make([]projectedEntry, 0, len(all))
		for _, e := range all {
			if e.SeqStart <= endSeq {
				eligible = append(eligible, e)
			}
		}
		selected := eligible
		if limit > 0 && len(eligible) > limit {
			selected = eligible[len(eligible)-limit:]
		}
		return timelinePage{entries: selected, hasOlder: len(selected) < len(eligible), hasNewer: hasNewer}
	default: // tail
		selected := all
		if limit > 0 && len(all) > limit {
			selected = all[len(all)-limit:]
		}
		hasOlder := len(selected) > 0 && selected[0].SeqStart > winMin
		return timelinePage{entries: selected, hasOlder: hasOlder, hasNewer: false}
	}
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

	mp.record.LastStatus = resolveAgentStatus(mp.record.LastStatus, mp.session.Status())
	mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_ = s.store.UpsertAgent(mp.record)

	// The schema's enum is idle | error | permission | timeout. A finished turn is "idle", not
	// "completed" — an invented value made the client reject the response and reject its promise, so
	// `byspace run` failed even though the turn had succeeded. A turn that failed is "error": node
	// derives the status from the daemon's own lifecycle, and reporting idle for a failure left the
	// caller with no way to tell the run apart from a clean one.
	//
	// "permission" is not derived here. Node reaches it through a shortcut in waitForAgentEvent that
	// resolves before the turn settles; this daemon's WaitForFinish blocks on the session going idle
	// and has no such shortcut, and inventing a stand-in (a non-empty pending list at the moment the
	// turn ends) would report a state no test or client expects.
	finalStatus := "idle"
	if mp.record.LastStatus == "error" {
		finalStatus = "error"
	}
	// The error text mirrors node's resolveWaitForFinishError: the recorded failure, or a fallback.
	var waitErr any
	if finalStatus == "error" {
		message := "Agent failed"
		if mp.record.LastError != nil && strings.TrimSpace(*mp.record.LastError) != "" {
			message = *mp.record.LastError
		}
		waitErr = message
	}
	finalText := mp.session.LastAssistantText()
	_ = sendSessionMsg(ctx, sink, "wait_for_finish_response", map[string]any{
		"requestId": req.RequestID,
		"status":    finalStatus,
		// `final` is the full agent snapshot, not an ad-hoc summary: clients merge it into
		// their agent map, and `lastMessage` is what `byspace wait` prints.
		"final":       s.buildAgentSnapshotPayload(mp.record),
		"error":       waitErr,
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
	// providerOptions is structured provider configuration (codex's sandbox_mode, approval_policy,
	// sandbox_workspace_write), passed through to the adapter — not environment variables. Turning
	// each string value into `key=value` in the child environment gave the provider nothing it
	// understood and polluted every process it started.
	var providerEnv []string
	sess, err := providers.StartProviderSession(providers.LaunchConfig{
		Provider:         rec.Provider,
		CommandOverride:  cmdOverride,
		Cwd:              rec.Cwd,
		Model:            model,
		ModeID:           modeID,
		ThinkingOptionID: thinking,
		SessionHandle:    sessionPath,
		Env:              providerEnv,
		ProviderOptions:  providerOptionsOf(rec),
		FeatureValues:    featureValuesOf(rec),
		PreapprovedTools: mcpToolRefs(preapprovedToolsOf(rec)),
		// Injected through the extension: pi has no launch flag for MCP, and without this the
		// agent never sees the daemon's orchestration tools.
		MCPServers:   s.piMCPServersFor(rec),
		SystemPrompt: s.systemPromptFor(rec),
		HomeDir:      s.homeDir,
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
		// Deferred slightly: the startup sync asks pi for its state, and pi does not answer
		// before its runtime is listening. Sending it immediately left the stdio queue stuck
		// and the agent never produced a turn.
		go func() {
			for i := 0; i < 100; i++ {
				if ready, ok := sess.(interface{ Ready() bool }); !ok || ready.Ready() {
					break
				}
				time.Sleep(50 * time.Millisecond)
			}
			s.syncPiPersistence(mp)
		}()
	}

	// omp has no MCP client in the modes BySpace uses: the orchestration tools reach it through its RPC
	// host-tool channel. Declaring them is what makes an omp agent able to create agents, list
	// workspaces or schedule anything at all.
	var hostToolSink hostToolSession
	if typed, ok := sess.(hostToolSession); ok {
		hostToolSink = typed
	}
	if rec.Provider == "omp" && hostToolSink != nil {
		go s.declareOmpHostTools(hostToolSink)
	}

	sess.OnEvent(func(ev map[string]any) {
		evType, _ := ev["type"].(string)
		nowStr := time.Now().UTC().Format(time.RFC3339Nano)
		isPi := rec.Provider == "pi" || rec.Provider == "" || rec.Provider == "omp"

		// A host tool call is the provider asking the daemon to run one of its own tools. Answered
		// asynchronously so the event loop is not blocked for the length of the tool.
		if call, ok := providers.ParseOmpHostToolCall(ev); ok && hostToolSink != nil {
			go s.answerOmpHostToolCall(hostToolSink, call)
		}

		switch evType {
		case "byspace_turn_started":
			turnID, _ := ev["turnId"].(string)
			// Poll while the turn runs so the context ring fills as tokens accumulate,
			// the same cadence as PiUsagePoller (every 3s).
			mp.startUsagePolling(s, sess)
			s.mu.Lock()
			mp.record.LastStatus = "running"
			mp.record.UpdatedAt = nowStr
			// LastActivityAt is "when did this agent last do work", which is not the same as
			// when the record changed (a rename touches UpdatedAt). The client sorts and
			// groups by activity, so it has to be maintained separately.
			mp.record.LastActivityAt = nowStr
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
				mp.record.LastActivityAt = nowStr
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
							"epoch":     s.currentTimelineEpoch(),
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

		case "byspace_turn_canceled":
			// The client ends its "running" affordance on this, so a cancelled turn that never reports it leaves the
			// row spinning. The daemon also broadcasts turn_canceled on archive and close; this is the provider's own
			// interruption.
			mp.stopUsagePolling()
			s.mu.Lock()
			mp.record.LastStatus = "idle"
			mp.record.UpdatedAt = nowStr
			recCanceledCopy := mp.record
			s.mu.Unlock()
			s.broadcastSessionMsg("agent_stream", map[string]any{
				"agentId":   rec.ID,
				"provider":  rec.Provider,
				"timestamp": nowStr,
				"event": map[string]any{
					"type":     "turn_canceled",
					"provider": rec.Provider,
					"turnId":   ev["turnId"],
					"reason":   ev["reason"],
				},
			})
			s.broadcastAgentUpdate(recCanceledCopy)

		case "byspace_turn_failed":
			// A provider-reported failure ends the turn the same way a completion does, minus the success:
			// the client needs the status to leave running or the row spins forever. But it leaves running
			// into "error", not "idle" — a failed turn is not a finished one, and the sidebar, the hover
			// card and wait_for_finish all read that difference.
			mp.stopUsagePolling()
			s.mu.Lock()
			mp.record.LastStatus = "error"
			if message, ok := ev["error"].(string); ok && message != "" {
				mp.record.LastError = &message
			}
			mp.record.UpdatedAt = nowStr
			recFailedCopy := mp.record
			s.mu.Unlock()
			s.broadcastSessionMsg("agent_stream", map[string]any{
				"agentId":   rec.ID,
				"provider":  rec.Provider,
				"timestamp": nowStr,
				"event": map[string]any{
					"type":     "turn_failed",
					"provider": rec.Provider,
					"error":    mp.record.LastError,
					"turnId":   ev["turnId"],
				},
			})
			s.appendSystemErrorRow(rec, mp.session, ev)
			s.broadcastAgentUpdate(recFailedCopy)

		case "permission_requested":
			// A provider reporting a permission request in its own vocabulary (the scripted provider does this;
			// pi reports through extension_ui_request). Both messages are needed for the same reason: the
			// timeline renders an inline card from agent_stream, and the modal listens for the dedicated
			// agent_permission_request. Handling only pi's shape left every other provider's modal empty.
			request, _ := ev["request"].(map[string]any)
			if request != nil {
				s.broadcastSessionMsg("agent_stream", map[string]any{
					"agentId":   rec.ID,
					"provider":  rec.Provider,
					"timestamp": nowStr,
					"event": map[string]any{
						"type":     "permission_requested",
						"provider": rec.Provider,
						"request":  request,
					},
				})
				s.broadcastSessionMsg("agent_permission_request", map[string]any{
					"agentId": rec.ID,
					"request": request,
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
			// Tell the parent this child finished. A parent that delegated work has no other
			// way to learn the outcome: the child is a separate agent with its own turn.
			go s.notifyParentChildFinished(context.Background(), rec.ID, finishReasonFinished)
			s.mu.Lock()
			mp.record.LastStatus = "idle"
			mp.record.UpdatedAt = nowStr
			recCopy := mp.record
			s.mu.Unlock()
			// A finished turn is what the sidebar badge means by "this agent wants you". Only
			// apply it when the client is not looking at this agent, which the presence policy
			// decides — marking unconditionally would badge a conversation the user just read.
			//
			// Computed after unlocking: attentionIsFocused takes s.mu, and a re-entrant Lock
			// deadlocks the provider event loop (see notes/013).
			shouldBadge := !s.attentionIsFocused(mp.record.ID)
			_ = s.store.UpsertAgent(recCopy)
			if shouldBadge {
				s.markAgentAttention(mp.record.ID, AttentionReasonFinished, nowStr)
			}
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
					// A child that died must tell its parent, or the parent waits forever for a
					// result that will never arrive.
					go s.notifyParentChildFinished(context.Background(), rec.ID, finishReasonErrored)
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
					// The process is gone but its timeline is still in memory, and this row is what a
					// reader sees after a reload: the failure itself is otherwise only a state change.
					s.appendSystemErrorRow(rec, mp.session, map[string]any{"error": reason})
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
		mp.record.LastStatus = resolveAgentStatus(mp.record.LastStatus, mp.session.Status())
		return s.buildAgentSnapshotPayload(mp.record)
	}
	rec, err := s.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return nil
	}
	return s.buildAgentSnapshotPayload(*rec)
}

// resolveAgentStatus picks the status to report for an agent, given the daemon's own record and the
// provider session's live state.
//
// "error" is daemon-owned: it says the last turn failed and nothing has run since. No provider
// session models it — a session tears the failed turn down and reports "idle" — so reading the
// session alone erases the failure and the agent looks merely finished. The daemon's error therefore
// outranks a session that has gone idle, and stands until the next turn starts: turn_started writes
// "running" over it, and a session that is itself running (a new turn already underway) wins outright.
func resolveAgentStatus(lastStatus, sessionStatus string) string {
	if lastStatus == "error" && (sessionStatus == "idle" || sessionStatus == "") {
		return "error"
	}
	return sessionStatus
}

func (s *Server) buildAgentSnapshotPayload(rec store.AgentRecord) map[string]any {
	status := rec.LastStatus
	pendingPerms := []map[string]any{}
	var activeTurn any
	s.mu.Lock()
	if mp, ok := s.agents[rec.ID]; ok && mp.session != nil {
		status = resolveAgentStatus(rec.LastStatus, mp.session.Status())
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

	rewindCaps := providers.RewindCapabilitiesFor(rec.Provider)

	payload := map[string]any{
		"id":               rec.ID,
		"provider":         rec.Provider,
		"cwd":              rec.Cwd,
		"workspaceId":      rec.WorkspaceID,
		"model":            model,
		"thinkingOptionId": thinking,
		// The effective value is what the provider actually runs at, which may differ from the
		// configured one: a provider that does not support the requested level falls back, and the
		// runtime reports what it settled on. Showing the configured value claims a level the model
		// is not using. Ported from resolveEffectiveThinkingOptionId: runtime wins, configured is the
		// fallback.
		"effectiveThinkingOptionId": effectiveThinkingOptionID(rec, thinking),
		"createdAt":                 rec.CreatedAt,
		"updatedAt":                 rec.UpdatedAt,
		"lastUserMessageAt":         rec.LastUserMessageAt,
		// "When did this agent last do work" — distinct from updatedAt, which a rename moves.
		"lastActivityAt": lastActivityOf(rec),
		"status":         status,
		"activeTurn":     activeTurn,
		"capabilities": map[string]any{
			"supportsStreaming":          true,
			"supportsSessionPersistence": true,
			"supportsDynamicModes":       false,
			"supportsMcpServers":         true,
			"supportsReasoningStream":    true,
			"supportsToolInvocations":    true,
			// A capability is a promise the client renders a button from; claiming it everywhere made
			// Rewind appear for providers that cannot do it, and pressing it fails.
			"supportsRewindConversation": rewindCaps.Conversation,
			"supportsRewindFiles":        rewindCaps.Files,
			"supportsRewindBoth":         rewindCaps.SupportsRewindBoth(),
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
	// Optional, not nullable: sending null fails the schema, so the key is omitted when unset.
	if options := providerOptionsOf(rec); options != nil {
		payload["providerOptions"] = options
	}
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
//
// Attachments marked `contextKind: "chat_history"` are placed BEFORE the user's text, not after.
// They are the conversation the user is referring to ("continue that thread"), and the
// instruction that follows only makes sense once the history is in context. Ported from
// buildAgentPrompt, which orders the blocks the same way.
type promptAttachment struct {
	Type        string `json:"type"`
	ContextKind string `json:"contextKind"`
	FileName    string `json:"fileName"`
	Path        string `json:"path"`
	MimeType    string `json:"mimeType"`
	Data        string `json:"data"`
	// The forge attachment fields. Without these, pointing the composer at a PR or a review sent the
	// model nothing: the client supplied the title, number and body and the daemon dropped them.
	Forge       string `json:"forge"`
	Number      int    `json:"number"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	Body        string `json:"body"`
	ProjectPath string `json:"projectPath"`
	BaseRefName string `json:"baseRefName"`
	HeadRefName string `json:"headRefName"`
	ReviewMode  string `json:"mode"`
	Cwd         string `json:"cwd"`
	BaseRef     string `json:"baseRef"`
	Text        string `json:"text"`
	Size        int    `json:"size"`
	Comments    []struct {
		FilePath   string `json:"filePath"`
		Side       string `json:"side"`
		LineNumber int    `json:"lineNumber"`
		Body       string `json:"body"`
		Context    struct {
			HunkHeader string `json:"hunkHeader"`
			TargetLine struct {
				OldLineNumber *int   `json:"oldLineNumber"`
				NewLineNumber *int   `json:"newLineNumber"`
				Type          string `json:"type"`
				Content       string `json:"content"`
			} `json:"targetLine"`
			Lines []struct {
				OldLineNumber *int   `json:"oldLineNumber"`
				NewLineNumber *int   `json:"newLineNumber"`
				Type          string `json:"type"`
				Content       string `json:"content"`
			} `json:"lines"`
		} `json:"context"`
	} `json:"comments"`
}

func appendAttachmentHints(text string, attachments []promptAttachment) string {
	if len(attachments) == 0 {
		return text
	}
	historyLines := make([]string, 0, 2)
	otherLines := make([]string, 0, len(attachments))
	for _, att := range attachments {
		isHistory := strings.TrimSpace(att.ContextKind) == "chat_history"
		name := strings.TrimSpace(att.FileName)
		if name == "" {
			name = filepath.Base(att.Path)
		}
		if name == "" || name == "." {
			name = "attachment"
		}
		// Each attachment type has its own rendering; a forge link and an uploaded file are not the
		// same kind of thing to a model, and flattening them to "[Attached file]" loses the PR body
		// and the review's diff context entirely.
		line := renderAttachment(att, name)
		if line == "" {
			continue
		}
		if isHistory {
			historyLines = append(historyLines, line)
		} else {
			otherLines = append(otherLines, line)
		}
	}
	if len(historyLines) == 0 && len(otherLines) == 0 {
		return text
	}

	parts := make([]string, 0, 3)
	if len(historyLines) > 0 {
		parts = append(parts, strings.Join(historyLines, "\n"))
	}
	if trimmed := strings.TrimSpace(text); trimmed != "" {
		parts = append(parts, trimmed)
	}
	if len(otherLines) > 0 {
		parts = append(parts, strings.Join(otherLines, "\n"))
	}
	return strings.Join(parts, "\n\n")
}

// newMessageID generates a message id for a user_message that arrived without one.
func newMessageID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "msg_" + hex.EncodeToString(b[:])
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
	return s.directorySyncMetadataWithReason(mode, "")
}

// directorySyncMetadataWithReason adds the reason a snapshot was returned.
//
// `reason` is optional in the schema, so it is only present when there is one: an empty string
// renders as a reason that does not exist.
func (s *Server) directorySyncMetadataWithReason(mode, reason string) map[string]any {
	catalog := s.store.LoadLabelCatalog()
	metadata := map[string]any{
		"generation": catalog.Generation,
		"headSeq":    catalog.HeadSeq,
		"mode":       mode,
		"removals":   []any{},
	}
	if reason != "" && mode == "snapshot" {
		metadata["reason"] = reason
	}
	return metadata
}

// broadcastWorkspaceUpsert tells connected clients that one workspace changed.
//
// The app maintains a directory replica and applies these deltas; without them the sidebar
// only changes on a full fetch, so an archived or newly created workspace lingers until reload.
func (s *Server) broadcastWorkspaceUpsert(ws store.WorkspaceRecord, prj store.ProjectRecord) {
	if ws.ArchivedAt != nil {
		archivedAt := ""
		if ws.ArchivedAt != nil {
			archivedAt = *ws.ArchivedAt
		}
		s.broadcastSessionMsg("workspace_update", s.archiveRemovePayload(ws.WorkspaceID, ws.ProjectID, archivedAt))
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

// lastActivityOf reports when an agent last did work.
//
// Falls back to updatedAt for records written before LastActivityAt was maintained: a nil would
// make the sidebar's activity ordering lose the agent entirely, and the protocol requires a
// string.
func lastActivityOf(rec store.AgentRecord) string {
	if rec.LastActivityAt != "" {
		return rec.LastActivityAt
	}
	return rec.UpdatedAt
}

// ShutdownRequested reports the channel a client's restart/shutdown request arrives on.
//
// A server cannot restart itself — it does not own its process. The command that started it does,
// so the request is handed over rather than acted on here.
func (s *Server) ShutdownRequested() <-chan string { return s.shutdownRequested }

// requestShutdown asks the process owner to exit.
//
// Buffered with one slot and non-blocking: two clients pressing restart must not deadlock the
// second one waiting for the owner to drain the first.
func (s *Server) requestShutdown(reason string) {
	select {
	case s.shutdownRequested <- reason:
	default:
	}
}

// filterSnapshotEntries keeps only the providers named in a refresh request.
//
// Narrowing rather than replacing: the response and the broadcast carry the same set, so a client
// that asked for one provider does not see the others vanish from its catalog.
func filterSnapshotEntries(entries []map[string]any, wanted []string) []map[string]any {
	keep := make(map[string]bool, len(wanted))
	for _, id := range wanted {
		keep[strings.ToLower(strings.TrimSpace(id))] = true
	}
	out := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		id, _ := entry["provider"].(string)
		if keep[strings.ToLower(id)] {
			out = append(out, entry)
		}
	}
	return out
}

// effectiveThinkingOptionID reports the thinking level the agent is actually running at.
//
// Ported from resolveEffectiveThinkingOptionId. The distinction matters when a provider silently
// clamps the request: `max` on a model that tops out at `high` runs at `high`, and the UI should say
// so rather than showing a level that is not in effect. Runtime wins when it has said anything;
// otherwise the configured value is the best available answer.
func effectiveThinkingOptionID(rec store.AgentRecord, configured any) any {
	if rec.RuntimeInfo != nil {
		// Node's test is property presence (`"thinkingOptionId" in runtimeInfo`), which also
		// distinguishes an explicit null. A *string cannot: JSON null and a missing key both
		// unmarshal to nil. So an explicit null here falls back to the configured value rather than
		// reporting null. The providers that write this field write it only when they know the
		// level, so the divergent case does not arise in practice; it is noted rather than papered
		// over with a custom unmarshaler for a case nothing produces.
		if rec.RuntimeInfo.ThinkingOptionID != nil {
			normalized := strings.TrimSpace(*rec.RuntimeInfo.ThinkingOptionID)
			if normalized == "" {
				return nil
			}
			return normalized
		}
	}
	return configured
}

// ensureUnarchivedAgentLoaded loads an agent and confirms it was not archived meanwhile.
//
// Ported from ensureUnarchivedAgentLoaded. The check runs twice on purpose: an archive can land
// between the first read and the load finishing, and the loaded agent would then be a running process
// for a conversation the user just removed — spending tokens on work nobody will read. The second
// check closes it again before returning the error.
//
// Callers that start a turn use this; callers that only read a record do not need it.
func (s *Server) ensureUnarchivedAgentLoaded(agentID string) (*managedPi, error) {
	if record, err := s.store.GetAgent(agentID); err == nil && record != nil && record.ArchivedAt != nil {
		return nil, fmt.Errorf("agent is archived: %s", agentID)
	}

	mp, err := s.ensureAgentLoaded(agentID)
	if err != nil {
		return nil, err
	}

	// The second read is the point: it catches an archive that landed during the load.
	if record, readErr := s.store.GetAgent(agentID); readErr == nil && record != nil && record.ArchivedAt != nil {
		s.mu.Lock()
		delete(s.agents, agentID)
		s.mu.Unlock()
		if mp.session != nil {
			_ = mp.session.Close()
		}
		return nil, fmt.Errorf("agent is archived: %s", agentID)
	}
	return mp, nil
}

// AgentRunStartTimeout bounds how long a prompt may be accepted without the provider starting a turn.
//
// Ported from AGENT_RUN_START_TIMEOUT_MS. A provider that swallows the prompt and never emits
// turn_started leaves the client spinning with no way to tell "working" from "hung". The prompt itself
// returns eventually, but the timeout is what turns the wait into an error the user can act on.
const AgentRunStartTimeout = 60 * time.Second

// waitForRunStart waits until the agent's status becomes running, or the timeout expires.
//
// Returns nil when the turn started (or already finished — a fast turn can complete inside the wait),
// and an error naming the phase when it did not. Ported from waitForAgentRunStartWithTimeout: the
// message includes "(phase: run start)" so a log reader can tell this apart from a turn that hung
// mid-stream.
func (s *Server) waitForRunStart(ctx context.Context, agentID, provider string) error {
	deadline := time.Now().Add(AgentRunStartTimeout)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}

		// Read the runtime when it exists and the stored record otherwise: a prompt can be accepted
		// for an agent that has not been loaded yet, and the record is where the daemon writes the
		// status either way.
		s.mu.Lock()
		mp := s.agents[agentID]
		status := ""
		if mp != nil {
			status = mp.record.LastStatus
		}
		s.mu.Unlock()
		if status == "" {
			if record, err := s.store.GetAgent(agentID); err == nil && record != nil {
				status = record.LastStatus
			}
		}

		// Running means the turn started. Idle means it already finished — a short turn can complete
		// before the first tick, and treating that as a timeout would report failure for a successful
		// run.
		if status == "running" || status == "idle" {
			return nil
		}
		// closed and error are terminal too: the turn is over, one way or another.
		if status == "closed" || status == "error" {
			return nil
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("%s run did not start within %d seconds (phase: run start)", provider, int(AgentRunStartTimeout.Seconds()))
		}
	}
}

// derefOr reads an optional string with a fallback.
func derefOr(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return *value
}

// agentModeInput assembles the mode-resolution input for a create request.
//
// The parent is read from the stored record rather than the request: the request only carries the
// caller's id, and the parent's provider is what decides whether its mode id means anything.
func (s *Server) agentModeInput(provider string, requested *string, callerID *string) agentmode.Input {
	input := agentmode.Input{Requested: requested, Provider: provider}

	if callerID != nil {
		if record, err := s.store.GetAgent(*callerID); err == nil && record != nil {
			parent := &agentmode.Parent{Provider: record.Provider}
			if record.Config != nil {
				parent.ModeID = record.Config.ModeID
			}
			// A parent's mode is "unattended" when the provider says its mode runs without asking.
			// The provider snapshot is the authority; without it the flag stays false and the
			// cross-provider case is refused rather than guessed.
			if parent.ModeID != nil {
				parent.Unattended = s.providerModeIsUnattended(record.Provider, *parent.ModeID)
			}
			input.Parent = parent
		}
	}

	// The target provider's modes come from the same snapshot the UI uses, so a mode the picker
	// offered is a mode this accepts.
	if modes, known := s.providerModeIDs(input.Provider); known {
		input.AvailableModes = modes
		for _, mode := range modes {
			if s.providerModeIsUnattended(input.Provider, mode) {
				unattended := mode
				input.TargetUnattendedMode = &unattended
				break
			}
		}
	}
	return input
}

// providerModeIDs returns a provider's mode ids, and whether the set is known.
//
// "Known" means the provider declares modes. A custom or unknown provider declares none, and the
// distinction matters: unknown passes an explicit mode through unvalidated, while a provider with a
// declared-but-empty set means "this provider has no modes".
func (s *Server) providerModeIDs(provider string) ([]string, bool) {
	spec := providers.GetProviderSpec(provider)
	if len(spec.Modes) == 0 {
		return nil, false
	}
	ids := make([]string, 0, len(spec.Modes))
	for _, mode := range spec.Modes {
		ids = append(ids, mode.ID)
	}
	return ids, true
}

// providerModeIsUnattended reports whether a mode runs without asking the user.
func (s *Server) providerModeIsUnattended(provider, modeID string) bool {
	spec := providers.GetProviderSpec(provider)
	for _, mode := range spec.Modes {
		if mode.ID == modeID {
			return mode.IsUnattended
		}
	}
	return false
}

// providerOptionsOf reads an agent's provider options, nil when it has none.
//
// Nil rather than an empty map: `providerOptions` is optional in the snapshot schema, and an empty
// object tells the provider sheet "configured, all defaults" instead of "not configured".
func providerOptionsOf(rec store.AgentRecord) map[string]any {
	if rec.Config == nil || len(rec.Config.ProviderOptions) == 0 {
		return nil
	}
	return rec.Config.ProviderOptions
}

// featureValuesOf reads the provider feature toggles a client set at create time.
func featureValuesOf(rec store.AgentRecord) map[string]any {
	if rec.Config == nil || len(rec.Config.FeatureValues) == 0 {
		return nil
	}
	return rec.Config.FeatureValues
}

// renderAttachment turns one composer attachment into the text the model reads.
//
// The switch mirrors renderPromptAttachmentAsText. Legacy `github_pr` / `github_issue` kinds are still
// accepted: a client at the compat floor sends them, and they mean the same as the forge-neutral
// forms with the forge pinned to github.
func renderAttachment(att promptAttachment, fallbackName string) string {
	switch att.Type {
	case "forge_change_request":
		return attachment.ChangeRequest(att.Forge, att.Number, att.Title, att.URL, att.Body,
			att.ProjectPath, att.BaseRefName, att.HeadRefName)
	case "github_pr":
		return attachment.ChangeRequest("github", att.Number, att.Title, att.URL, att.Body,
			att.ProjectPath, att.BaseRefName, att.HeadRefName)
	case "forge_issue":
		return attachment.Issue(att.Forge, att.Number, att.Title, att.URL, att.Body, att.ProjectPath)
	case "github_issue":
		return attachment.Issue("github", att.Number, att.Title, att.URL, att.Body, "")
	case "review":
		comments := make([]attachment.ReviewComment, 0, len(att.Comments))
		for _, comment := range att.Comments {
			lines := make([]attachment.ReviewLine, 0, len(comment.Context.Lines))
			for _, line := range comment.Context.Lines {
				lines = append(lines, attachment.ReviewLine{
					OldLineNumber: line.OldLineNumber,
					NewLineNumber: line.NewLineNumber,
					Type:          line.Type,
					Content:       line.Content,
				})
			}
			comments = append(comments, attachment.ReviewComment{
				FilePath:   comment.FilePath,
				Side:       comment.Side,
				LineNumber: comment.LineNumber,
				Body:       comment.Body,
				HunkHeader: comment.Context.HunkHeader,
				Target: attachment.ReviewLine{
					OldLineNumber: comment.Context.TargetLine.OldLineNumber,
					NewLineNumber: comment.Context.TargetLine.NewLineNumber,
					Type:          comment.Context.TargetLine.Type,
					Content:       comment.Context.TargetLine.Content,
				},
				Lines: lines,
			})
		}
		return attachment.Review(att.ReviewMode, att.Cwd, att.BaseRef, comments)
	case "text":
		return attachment.Text(att.Text, att.Path, fallbackName, att.MimeType)
	case "uploaded_file":
		if strings.TrimSpace(att.Path) != "" {
			// A materialised file is more useful with its path than with a size: the model can read
			// it, and the size is what it learns from reading.
			return attachment.UploadedFile(fallbackName, att.Path, att.MimeType, att.Size)
		}
		return attachment.UploadedFile(fallbackName, "", att.MimeType, att.Size)
	}

	// Fallback for a kind this build does not render: name it and its path so the model at least
	// knows something was attached.
	if strings.TrimSpace(att.Path) != "" {
		return fmt.Sprintf("[Attached file: %s (%s) at %s]", fallbackName, att.MimeType, att.Path)
	}
	return ""
}

// parentAgentCwd returns the directory of the caller agent, or "" when there is none.
func (s *Server) parentAgentCwd(callerAgentID string) string {
	id := strings.TrimSpace(callerAgentID)
	if id == "" {
		return ""
	}
	record, err := s.store.GetAgent(id)
	if err != nil || record == nil {
		return ""
	}
	return strings.TrimSpace(record.Cwd)
}

// resolveChildCwd resolves a requested directory against the parent's.
//
// Ported from resolveChildAgentCwd: an empty request means "wherever the parent is", and a relative
// one is relative to the parent. A path that is already absolute is left alone — a caller that names
// /tmp/x means /tmp/x, not /parent/tmp/x. filepath.Join would otherwise clean away a leading slash.
func resolveChildCwd(parentCwd, requested string) string {
	trimmed := strings.TrimSpace(requested)
	if trimmed == "" {
		return parentCwd
	}
	expanded := trimmed
	if strings.HasPrefix(expanded, "~") {
		if userHome, err := os.UserHomeDir(); err == nil {
			expanded = filepath.Join(userHome, strings.TrimPrefix(expanded, "~"))
		}
	}
	if filepath.IsAbs(expanded) {
		return filepath.Clean(expanded)
	}
	return filepath.Join(parentCwd, expanded)
}

// draftModelFromConfig reads the model id out of a provider draft config.
//
// The draft is the shape the provider sheet posts; a missing or non-string model yields "", which
// ProviderFeaturesFor treats as "no model chosen" and so hides model-gated features.
func draftModelFromConfig(draft map[string]any) string {
	if draft == nil {
		return ""
	}
	if model, ok := draft["model"].(string); ok {
		return strings.TrimSpace(model)
	}
	if model, ok := draft["modelId"].(string); ok {
		return strings.TrimSpace(model)
	}
	return ""
}

// preapprovedToolRefs reads the pre-approved MCP tool list from a create request.
//
// Only `kind: "mcp"` entries are kept: the schema admits other kinds, and a grant for something that is
// not an MCP tool cannot be expressed in the provider's server config.
func storePreapprovedTools(policy *struct {
	Preapproved []struct {
		Kind   string `json:"kind"`
		Server string `json:"server"`
		Tool   string `json:"tool"`
	} `json:"preapproved"`
}) []store.PreapprovedTool {
	if policy == nil {
		return nil
	}
	out := make([]store.PreapprovedTool, 0, len(policy.Preapproved))
	for _, grant := range policy.Preapproved {
		if grant.Kind != "" && grant.Kind != "mcp" {
			continue
		}
		out = append(out, store.PreapprovedTool{Server: grant.Server, Tool: grant.Tool})
	}
	return out
}

// preapprovedToolsOf reads an agent's stored grants.
func preapprovedToolsOf(rec store.AgentRecord) []store.PreapprovedTool {
	if rec.Config == nil {
		return nil
	}
	return rec.Config.PreapprovedTools
}

// mcpToolRefs converts stored grants into the provider-facing shape.
func mcpToolRefs(tools []store.PreapprovedTool) []providers.McpToolRef {
	if len(tools) == 0 {
		return nil
	}
	out := make([]providers.McpToolRef, 0, len(tools))
	for _, tool := range tools {
		out = append(out, providers.McpToolRef{Server: tool.Server, Tool: tool.Tool})
	}
	return out
}

// hostToolSession is a provider session that can host the daemon's own tools.
//
// omp implements it; the other providers take their tools through MCP or an extension instead.
type hostToolSession interface {
	SetHostTools(ctx context.Context, tools []map[string]any) ([]string, error)
	SendHostToolResult(callID, output string, failed bool) error
}

// declareOmpHostTools sends the BySpace tool catalog to an omp session.
//
// Waits for the session to be ready first: omp does not answer RPC before its runtime is listening, and a
// request sent too early sits in the queue and blocks the prompt behind it.
func (s *Server) declareOmpHostTools(sess hostToolSession) {
	for i := 0; i < 100; i++ {
		if ready, ok := sess.(interface{ Ready() bool }); !ok || ready.Ready() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// The provider's answer is authoritative: it may refuse a tool whose schema it cannot parse, and
	// assuming all of them are live means the model calls a tool that does not exist.
	_, _ = sess.SetHostTools(ctx, mcpToolDefinitions())
}

// answerOmpHostToolCall runs one host tool call and returns its result.
func (s *Server) answerOmpHostToolCall(sess hostToolSession, call providers.OmpHostToolCall) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	result, isError := s.callMCPTool(ctx, call.Name, call.Arguments)
	output := ""
	switch typed := result.(type) {
	case string:
		output = typed
	case nil:
		output = ""
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			output = fmt.Sprint(typed)
		} else {
			output = string(encoded)
		}
	}
	if output == "" && isError {
		output = "the tool returned no output"
	}
	_ = sess.SendHostToolResult(call.CallID, output, isError)
}

// firstNonEmptyTrimmed returns the first value with content.
//
// Used where a request accepts the same fact under more than one key: guessing which one a client sends is how a field
// ends up silently read from the wrong place.
func firstNonEmptyTrimmed(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
