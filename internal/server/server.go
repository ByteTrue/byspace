package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/webui"
)

const WSProtocolVersion = 1

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
	cachedPiModels    []pi.CatalogModel
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
	if ui == nil {
		ui = webui.NewHandler(opts.WebDir)
	}
	ui = ui.WithConnectionHint("BySpace")

	srv := &Server{
		homeDir:           homeDir,
		serverID:          serverID,
		version:           ver,
		keyPair:           kp,
		pubKeyB64:         pubB64,
		vapidKeys:         vapidKeys,
		store:             store.New(homeDir),
		webUI:             ui,
		piCommand:         opts.PiCommand,
		piSessionDir:      opts.PiSessionDir,
		agents:            make(map[string]*managedPi),
		terminals:         make(map[uint8]*terminal.Session),
		terminalSlotsByID: make(map[string]uint8),
		downloadTokens:    make(map[string]downloadTokenEntry),
		fileSubs:          make(map[string]fileSubscription),
		diffSubs:          make(map[string]diffSubscription),
		clients:           make(map[frameSink]bool),
	}
	srv.schedules = schedule.NewService(homeDir, srv.executeScheduledPiRun)
	return srv, nil
}

func (s *Server) ServerID() string     { return s.serverID }
func (s *Server) PublicKeyB64() string { return s.pubKeyB64 }
func (s *Server) HomeDir() string      { return s.homeDir }
func (s *Server) Store() *store.Store  { return s.store }

// Close shuts down any live Pi agent subprocesses and PTY sessions.
func (s *Server) Close() error {
	s.mu.Lock()
	agents := make([]*managedPi, 0, len(s.agents))
	for _, a := range s.agents {
		agents = append(agents, a)
	}
	terms := make([]*terminal.Session, 0, len(s.terminals))
	for _, t := range s.terminals {
		terms = append(terms, t)
	}
	s.mu.Unlock()

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
	}()

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

	created.Subscribe(func(ev terminal.OutputEvent) {
		outFrame := terminal.EncodeFrame(terminal.OpcodeOutput, slot, ev.Data)
		_ = sink.SendBinary(context.Background(), outFrame)
	})
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
			_ = sink.Close(4400, "Incompatible protocol version")
			return
		}
		if strings.TrimSpace(envelope.ClientID) == "" {
			_ = sink.Close(4402, "Invalid hello")
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
			"webPush":                      s.vapidKeys.PublicKey != "",
			"skillInstallTargets":          true,
			"agentRequestReceipts":         true,
			"hubAgentRpc":                  true,
			"directorySync":                true,
			"workspaceSetupRun":            true,
			"providersSnapshot":            true,
			"providersSnapshotCwd":         true,
			"daemonStatusRpc":              true,
			"daemonConfigReload":           true,
			"relayConfig":                  true,
			"pushTokenRevocation":          true,
			"plugins":                      true,
			"pluginManagement":             true,
			"skillManagement":              true,
			"agentRoles":                   true,
			"agentRoleNames":               []string{},
			"daemonTunnels":                true,
			"projectSetupSkill":            true,
			"terminalAgentHookProviders":   true,
			"terminalShellConfig":          true,
			"terminal-restore-modes":       true,
			"terminal-input-mode-replay":   true,
			"terminal-size-ownership":      true,
			"workspaceTerminals":           true,
			"rewind":                       true,
			"agentTimelinePromptIndex":     true,
			"agentHistorySearch":           true,
			"checkoutRefresh":              true,
			"workspaceAgentRename":         true,
			"workspaceMultiplicity":        true,
			"projectRemove":                true,
			"projectAdd":                   true,
			"projectList":                  true,
			"worktreeRestore":              true,
			"workspaceRecovery":            true,
			"workspaceFileEditing":         true,
			"providerUsageList":            true,
			"agentDetach":                  true,
			"agentThinkingUpdate":          true,
			"daemonDiagnostics":            true,
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
		_ = sendSessionMsg(ctx, sink, "session.events.set_subscription.response", map[string]any{
			"requestId": base.RequestID,
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
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
		}
		_ = json.Unmarshal(raw, &req)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		models := s.probeOrCachedPiModels(ctx)
		cfg := s.store.LoadDaemonConfig()
		customProvs, _ := cfg["providers"].(map[string]any)
		respPayload := map[string]any{
			"requestId":   base.RequestID,
			"generatedAt": now,
			"entries":     providers.BuildSnapshotEntries(models, s.piCommand, customProvs),
		}
		if strings.TrimSpace(req.Cwd) != "" {
			respPayload["cwd"] = req.Cwd
		}
		_ = sendSessionMsg(ctx, sink, "get_providers_snapshot_response", respPayload)

	case "refresh_providers_snapshot_request":
		s.mu.Lock()
		s.cachedPiModels = nil
		s.mu.Unlock()
		_ = s.probeOrCachedPiModels(ctx)
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
		sh := os.Getenv("SHELL")
		if sh == "" {
			sh = "/bin/sh"
		}
		_ = sendSessionMsg(ctx, sink, "terminal.shell.detect.response", map[string]any{
			"requestId":       base.RequestID,
			"shells":          []map[string]any{{"path": sh, "name": filepath.Base(sh)}},
			"resolvedDefault": sh,
			"error":           nil,
		})

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
		_ = sendSessionMsg(ctx, sink, "fetch_agent_response", map[string]any{
			"requestId": req.RequestID,
			"agent":     agentPayload,
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
	})
}

func (s *Server) handleFetchWorkspaces(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
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
		Source    struct {
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
	_ = sendSessionMsg(ctx, sink, "workspace.create.response", map[string]any{
		"requestId":       req.RequestID,
		"workspace":       buildWorkspaceDescriptor(ws, prj),
		"setupTerminalId": nil,
		"error":           nil,
	})
}

func (s *Server) handleFetchAgents(ctx context.Context, sink frameSink, reqType string, raw json.RawMessage) {
	var req struct {
		RequestID   string         `json:"requestId"`
		SearchQuery string         `json:"searchQuery"`
		Filter      map[string]any `json:"filter"`
		Sort        string         `json:"sort"`
		Limit       int            `json:"limit"`
		Cursor      string         `json:"cursor"`
		Subscribe   *struct {
			SubscriptionID string `json:"subscriptionId"`
		} `json:"subscribe"`
	}
	_ = json.Unmarshal(raw, &req)

	allRecords, _ := s.store.ListAgents()
	activeOrHist := make([]store.AgentRecord, 0, len(allRecords))
	for _, rec := range allRecords {
		if rec.ArchivedAt != nil && reqType == "fetch_agents_request" {
			continue
		}
		activeOrHist = append(activeOrHist, rec)
	}
	records, hasMore, nextCursor := FilterAndSortAgents(activeOrHist, req.SearchQuery, req.Filter, req.Sort, req.Limit, req.Cursor)

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
		entries = append(entries, map[string]any{
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
				},
			},
		})
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
	if req.Subscribe != nil && req.Subscribe.SubscriptionID != "" {
		payload["subscriptionId"] = req.Subscribe.SubscriptionID
	}
	_ = sendSessionMsg(ctx, sink, respType, payload)
}

func (s *Server) handleCreateAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string  `json:"requestId"`
		WorkspaceID   string  `json:"workspaceId"`
		InitialPrompt *string `json:"initialPrompt"`
		Config        struct {
			Provider         string  `json:"provider"`
			Cwd              string  `json:"cwd"`
			Title            *string `json:"title"`
			Model            *string `json:"model"`
			ThinkingOptionID *string `json:"thinkingOptionId"`
			ModeID           *string `json:"modeId"`
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

	rec := store.AgentRecord{
		ID:          agentID,
		Provider:    provider,
		Cwd:         cwd,
		WorkspaceID: ws.WorkspaceID,
		CreatedAt:   now,
		UpdatedAt:   now,
		Title:       title,
		Labels:      map[string]string{},
		LastStatus:  "idle",
		Config: &store.AgentConfig{
			Model:            req.Config.Model,
			ThinkingOptionID: req.Config.ThinkingOptionID,
			ModeID:           req.Config.ModeID,
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

	_ = sendSessionMsg(ctx, sink, "status", map[string]any{
		"status":    "agent_created",
		"agentId":   agentID,
		"requestId": req.RequestID,
		"agent":     s.buildAgentSnapshotPayload(mp.record),
	})

	if req.InitialPrompt != nil && strings.TrimSpace(*req.InitialPrompt) != "" {
		promptText := *req.InitialPrompt
		go func() {
			pctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			_ = mp.session.Prompt(pctx, promptText, nil)
			s.mu.Lock()
			mp.record.LastStatus = mp.session.Status()
			mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			recCopy := mp.record
			s.mu.Unlock()
			_ = s.store.UpsertAgent(recCopy)
		}()
	}
}

func (s *Server) handleSendAgentMessage(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		AgentID   string `json:"agentId"`
		Text      string `json:"text"`
	}
	_ = json.Unmarshal(raw, &req)

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

	if err := mp.session.Prompt(ctx, req.Text, nil); err != nil {
		_ = sendSessionMsg(ctx, sink, "send_agent_message_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     err.Error(),
		})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mp.record.UpdatedAt = now
	mp.record.LastUserMessageAt = &now
	mp.record.LastStatus = mp.session.Status()
	_ = s.store.UpsertAgent(mp.record)

	_ = sendSessionMsg(ctx, sink, "send_agent_message_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
	})
}

func (s *Server) handleFetchAgentTimeline(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID  string `json:"requestId"`
		AgentID    string `json:"agentId"`
		Direction  string `json:"direction"`
		Projection string `json:"projection"`
	}
	_ = json.Unmarshal(raw, &req)

	direction := req.Direction
	if direction == "" {
		direction = "tail"
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
			"epoch":       "ep_1",
			"reset":       false,
			"staleCursor": false,
			"gap":         false,
			"entries":     []any{},
			"error":       err.Error(),
		})
		return
	}

	tl := mp.session.Timeline()
	entries := make([]map[string]any, 0, len(tl))
	for _, e := range tl {
		entries = append(entries, map[string]any{
			"provider":  mp.record.Provider,
			"item":      e.Item,
			"timestamp": e.Timestamp,
			"seqStart":  e.Seq,
			"seqEnd":    e.Seq,
			"sourceSeqRanges": []map[string]any{
				{"startSeq": e.Seq, "endSeq": e.Seq},
			},
			"turnId":    e.TurnID,
			"collapsed": []string{},
		})
	}

	var startCursor, endCursor any
	if len(tl) > 0 {
		startCursor = map[string]any{"epoch": "ep_1", "seq": tl[0].Seq}
		endCursor = map[string]any{"epoch": "ep_1", "seq": tl[len(tl)-1].Seq}
	}

	_ = sendSessionMsg(ctx, sink, "fetch_agent_timeline_response", map[string]any{
		"requestId":   req.RequestID,
		"agentId":     req.AgentID,
		"agent":       s.buildAgentSnapshotPayload(mp.record),
		"direction":   direction,
		"projection":  projection,
		"epoch":       "ep_1",
		"reset":       false,
		"staleCursor": false,
		"gap":         false,
		"window": map[string]any{
			"minSeq":  1,
			"maxSeq":  len(tl),
			"nextSeq": len(tl) + 1,
		},
		"startCursor": startCursor,
		"endCursor":   endCursor,
		"hasOlder":    false,
		"hasNewer":    false,
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
			"requestId": req.RequestID,
			"status":    "timeout",
			"final":     nil,
			"error":     err.Error(),
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
		"final": map[string]any{
			"agentId":       req.AgentID,
			"status":        mp.record.LastStatus,
			"assistantText": finalText,
		},
		"error": nil,
	})
}

func (s *Server) ensureAgentLoaded(agentID string) (*managedPi, error) {
	s.mu.Lock()
	if mp, ok := s.agents[agentID]; ok {
		s.mu.Unlock()
		return mp, nil
	}
	s.mu.Unlock()

	rec, err := s.store.GetAgent(agentID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
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
	sess, err := providers.StartProviderSession(providers.LaunchConfig{
		Provider:         rec.Provider,
		CommandOverride:  cmdOverride,
		Cwd:              rec.Cwd,
		Model:            model,
		ModeID:           modeID,
		ThinkingOptionID: thinking,
		SessionHandle:    sessionPath,
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
		switch evType {
		case "turn_start":
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
			s.broadcastSessionMsg("status", map[string]any{
				"status":  "agent_updated",
				"agentId": rec.ID,
				"agent":   s.buildAgentSnapshotPayload(recStartCopy),
			})
		case "message_end":
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
		case "tool_execution_start", "tool_execution_end":
			tl := sess.Timeline()
			for i := len(tl) - 1; i >= 0; i-- {
				if tl[i].Item.Type == "tool_call" {
					s.broadcastSessionMsg("agent_stream", map[string]any{
						"agentId":   rec.ID,
						"provider":  rec.Provider,
						"timestamp": nowStr,
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
		case "extension_ui_request":
			if perm := pi.MapExtensionUIRequestToPermission(ev); perm != nil {
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
			}
		case "agent_end", "agent_settled", "process_exit":
			s.mu.Lock()
			mp.record.LastStatus = sess.Status()
			mp.record.UpdatedAt = nowStr
			recCopy := mp.record
			s.mu.Unlock()
			_ = s.store.UpsertAgent(recCopy)
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
			s.broadcastSessionMsg("status", map[string]any{
				"status":  "agent_updated",
				"agentId": rec.ID,
				"agent":   s.buildAgentSnapshotPayload(recCopy),
			})
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
	s.mu.Lock()
	if mp, ok := s.agents[rec.ID]; ok && mp.session != nil {
		status = mp.session.Status()
		pendingPerms = mp.session.PendingPermissions()
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

	return map[string]any{
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
		"activeTurn":                nil,
		"capabilities": map[string]any{
			"supportsStreaming":          true,
			"supportsSessionPersistence": true,
			"supportsDynamicModes":       false,
			"supportsMcpServers":         true,
			"supportsReasoningStream":    true,
			"supportsToolInvocations":    true,
			"canCancel":                  true,
			"canSelectModel":             true,
			"canSelectThinking":          true,
			"supportsImages":             true,
			"supportsAttachments":        true,
		},
		"currentModeId":      modeID,
		"availableModes":     []any{},
		"features":           []any{},
		"pendingPermissions": pendingPerms,
		"persistence":        rec.Persistence,
		"title":              rec.Title,
		"labels":             labels,
		"requiresAttention":  rec.RequiresAttention,
		"attentionReason":    rec.AttentionReason,
		"attentionTimestamp": rec.AttentionTimestamp,
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
	return map[string]any{
		"id":                        ws.WorkspaceID,
		"projectId":                 prj.ProjectID,
		"projectDisplayName":        projectDisplayName,
		"projectCustomName":         prj.CustomName,
		"projectCustomIconRevision": prj.CustomIconRevision,
		"projectRootPath":           prj.RootPath,
		"workspaceDirectory":        ws.Cwd,
		"worktreeSlug":              filepath.Base(ws.Cwd),
		"projectKind":               projectKind,
		"workspaceKind":             workspaceKind,
		"name":                      name,
		"title":                     ws.Title,
		"pinnedAt":                  ws.PinnedAt,
		"archivingAt":               nil,
		"status":                    "done",
		"statusEnteredAt":           ws.CreatedAt,
		"activityAt":                ws.UpdatedAt,
		"diffStat": map[string]any{
			"additions": 0,
			"deletions": 0,
		},
		"scripts": []any{},
		"gitRuntime": map[string]any{
			"currentBranch":          ws.Branch,
			"remoteUrl":              nil,
			"isBySpaceOwnedWorktree": ws.IsBySpaceOwnedWorktree,
			"isDirty":                false,
			"aheadBehind":            nil,
			"aheadOfOrigin":          nil,
			"behindOfOrigin":         nil,
		},
		"githubRuntime": nil,
	}
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
