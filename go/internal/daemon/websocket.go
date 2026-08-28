package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"byspace/internal/agent"
	"byspace/internal/protocol"
	"github.com/coder/websocket"
)

const (
	webSocketHelloTimeout = 5 * time.Second
	webSocketWriteTimeout = 5 * time.Second
	webSocketReadLimit    = 1 << 20
	webSocketQueueSize    = 256
)

type daemonSocket interface {
	Read(context.Context) (websocket.MessageType, []byte, error)
	Write(context.Context, websocket.MessageType, []byte) error
	Close(websocket.StatusCode, string) error
	CloseNow() error
}

type agentWebSocketHandler struct {
	manager      *agent.Manager
	catalog      *localCatalog
	serverID     string
	hostname     string
	helloTimeout time.Duration

	ctx                  context.Context
	cancel               context.CancelFunc
	mu                   sync.Mutex
	closed               bool
	pairingOfferProvider func(string, string) (pairingOfferResult, error)
	active               sync.WaitGroup
}

func newAgentWebSocketHandler(manager *agent.Manager, catalog *localCatalog, serverID, hostname string) *agentWebSocketHandler {
	ctx, cancel := context.WithCancel(context.Background())
	return &agentWebSocketHandler{
		manager:      manager,
		catalog:      catalog,
		serverID:     serverID,
		hostname:     hostname,
		helloTimeout: webSocketHelloTimeout,
		ctx:          ctx,
		cancel:       cancel,
	}
}

func (handler *agentWebSocketHandler) setPairingOfferProvider(provider func(string, string) (pairingOfferResult, error)) {
	handler.mu.Lock()
	handler.pairingOfferProvider = provider
	handler.mu.Unlock()
}

func (handler *agentWebSocketHandler) pairingOffer(appURL, relayURL string) (pairingOfferResult, error) {
	handler.mu.Lock()
	provider := handler.pairingOfferProvider
	handler.mu.Unlock()
	if provider == nil {
		return pairingOfferResult{}, nil
	}
	return provider(appURL, relayURL)
}

func (handler *agentWebSocketHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if !isLoopbackPeer(request.RemoteAddr) || !isLoopbackHost(request.Host) || !originAllowed(request) {
		http.Error(writer, "local WebSocket only", http.StatusForbidden)
		return
	}

	handler.mu.Lock()
	if handler.closed {
		handler.mu.Unlock()
		http.Error(writer, "daemon is shutting down", http.StatusServiceUnavailable)
		return
	}
	handler.active.Add(1)
	handler.mu.Unlock()
	defer handler.active.Done()

	connection, err := websocket.Accept(writer, request, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	connection.SetReadLimit(webSocketReadLimit)
	handler.serveConnection(connection)
}

func (handler *agentWebSocketHandler) Close() {
	handler.mu.Lock()
	if handler.closed {
		handler.mu.Unlock()
		return
	}
	handler.closed = true
	handler.cancel()
	handler.mu.Unlock()
	handler.active.Wait()
}

func (handler *agentWebSocketHandler) serveRemoteConnection(socket daemonSocket) {
	handler.mu.Lock()
	if handler.closed {
		handler.mu.Unlock()
		_ = socket.Close(websocket.StatusGoingAway, "daemon is shutting down")
		return
	}
	handler.active.Add(1)
	handler.mu.Unlock()
	defer handler.active.Done()
	handler.serveConnection(socket)
}

func (handler *agentWebSocketHandler) serveConnection(socket daemonSocket) {
	ctx, cancel := context.WithCancel(handler.ctx)
	defer cancel()
	defer socket.CloseNow()

	closerDone := make(chan struct{})
	go func() {
		defer close(closerDone)
		<-ctx.Done()
		_ = socket.CloseNow()
	}()
	defer func() {
		cancel()
		<-closerDone
	}()

	outbound := make(chan []byte, webSocketQueueSize)
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			select {
			case <-ctx.Done():
				return
			case data := <-outbound:
				writeCtx, writeCancel := context.WithTimeout(ctx, webSocketWriteTimeout)
				err := socket.Write(writeCtx, websocket.MessageText, data)
				writeCancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	defer func() {
		cancel()
		<-writerDone
	}()

	enqueue := func(data []byte) bool {
		select {
		case <-ctx.Done():
			return false
		case outbound <- data:
			return true
		default:
			cancel()
			return false
		}
	}
	send := func(messageType string, payload any) bool {
		data, err := protocol.EncodeSessionMessage(messageType, payload)
		if err != nil {
			cancel()
			return false
		}
		return enqueue(data)
	}

	helloCtx, helloCancel := context.WithTimeout(ctx, handler.helloTimeout)
	messageType, data, err := socket.Read(helloCtx)
	helloCancel()
	if err != nil {
		return
	}
	if messageType != websocket.MessageText {
		_ = socket.Close(websocket.StatusUnsupportedData, "hello must be text")
		return
	}
	frame, err := protocol.DecodeClientFrame(data)
	if err != nil || frame.Type != "hello" || frame.Hello == nil {
		_ = socket.Close(websocket.StatusPolicyViolation, "hello required")
		return
	}
	if frame.Hello.ProtocolVersion != 1 {
		_ = socket.Close(websocket.StatusPolicyViolation, "unsupported protocol version")
		return
	}

	serverInfo := protocol.ServerInfo{
		Status:   "server_info",
		ServerID: handler.serverID,
		Hostname: &handler.hostname,
		Capabilities: &protocol.ServerCapabilities{
			AgentSessionV2: true,
		},
		Features: &protocol.ServerFeatures{
			AgentTurnIdentity:     true,
			WorkspaceMultiplicity: true,
			ProjectList:           true,
			ProvidersSnapshot:     true,
			ProvidersSnapshotCWD:  true,
			PairingOfferRPC:       true,
		},
	}
	serverInfoData, err := protocol.EncodeServerMessage(serverInfo)
	if err != nil || !enqueue(serverInfoData) {
		return
	}

	streamAgentEvents := true
	if raw, ok := frame.Hello.Capabilities["agentStream"]; ok {
		_ = json.Unmarshal(raw, &streamAgentEvents)
	}
	unsubscribe := func() {}
	if streamAgentEvents {
		unsubscribe = handler.manager.Subscribe(func(event agent.Event) {
			provider := ""
			if snapshot, getErr := handler.manager.Get(event.AgentID); getErr == nil {
				provider = snapshot.Provider
			}
			message, ok := streamEventPayload(event, provider)
			if !ok {
				return
			}
			messageType, _ := message["type"].(string)
			if !send(messageType, message["payload"]) {
				cancel()
			}
		})
	}
	defer unsubscribe()

	client := agentWebSocketConnection{
		manager: handler.manager, catalog: handler.catalog, send: send, pairingOffer: handler.pairingOffer,
	}
	for {
		messageType, data, err = socket.Read(ctx)
		if err != nil {
			return
		}
		if messageType != websocket.MessageText {
			_ = socket.Close(websocket.StatusUnsupportedData, "binary messages are unsupported")
			return
		}
		frame, err = protocol.DecodeClientFrame(data)
		if err != nil {
			_ = socket.Close(websocket.StatusInvalidFramePayloadData, "invalid protocol message")
			return
		}
		switch frame.Type {
		case "ping":
			if !enqueue(protocol.EncodePong()) {
				return
			}
		case "session":
			if !client.handle(ctx, frame.Message) {
				return
			}
		default:
			_ = socket.Close(websocket.StatusPolicyViolation, "unexpected handshake message")
			return
		}
	}
}

type agentWebSocketConnection struct {
	manager      *agent.Manager
	catalog      *localCatalog
	send         func(string, any) bool
	pairingOffer func(string, string) (pairingOfferResult, error)
}

func (connection agentWebSocketConnection) handle(ctx context.Context, message protocol.ClientMessage) bool {
	switch request := message.(type) {
	case protocol.ClientHeartbeat:
		return true

	case protocol.FetchAgentsRequest:
		snapshots := connection.manager.List()
		sort.Slice(snapshots, func(left, right int) bool {
			return snapshots[left].CreatedAt.Before(snapshots[right].CreatedAt)
		})
		entries := make([]map[string]any, 0, len(snapshots))
		for _, snapshot := range snapshots {
			entries = append(entries, directoryEntry(snapshot))
		}
		return connection.send("fetch_agents_response", map[string]any{
			"requestId":      request.RequestID,
			"subscriptionId": nil,
			"entries":        entries,
			"pageInfo": map[string]any{
				"nextCursor": nil,
				"prevCursor": nil,
				"hasMore":    false,
			},
		})

	case protocol.FetchWorkspacesRequest:
		return connection.send("fetch_workspaces_response", map[string]any{
			"requestId":      request.RequestID,
			"subscriptionId": nil,
			"entries":        []any{connection.catalog.workspace},
			"pageInfo": map[string]any{
				"nextCursor": nil,
				"prevCursor": nil,
				"hasMore":    false,
			},
		})

	case protocol.ProjectListRequest:
		return connection.send("project.list.response", map[string]any{
			"requestId": request.RequestID,
			"projects":  []any{connection.catalog.project},
		})

	case protocol.ProjectIconRequest:
		return connection.send("project_icon_response", map[string]any{
			"requestId": request.RequestID,
			"cwd":       request.CWD,
			"icon":      nil,
			"error":     nil,
		})

	case protocol.ProjectIconGetRequest:
		return connection.send("project.icon.get.response", map[string]any{
			"requestId": request.RequestID,
			"projectId": request.ProjectID,
			"icon":      nil,
			"error":     nil,
		})

	case protocol.DaemonGetPairingOfferRequest:
		result, err := connection.pairingOffer(request.AppURL, request.RelayURL)
		payload := map[string]any{
			"requestId":    request.RequestID,
			"url":          result.URL,
			"qr":           nil,
			"relayEnabled": result.RelayEnabled,
		}
		if result.Offer.Version != 0 {
			payload["offer"] = result.Offer
		}
		if err != nil {
			payload["error"] = err.Error()
		}
		return connection.send("daemon.get_pairing_offer.response", payload)

	case protocol.GetDaemonConfigRequest:
		return connection.send("get_daemon_config_response", map[string]any{
			"requestId": request.RequestID,
			"config": map[string]any{
				"mcp":                      map[string]any{"enabled": false, "injectIntoAgents": false},
				"browserTools":             map[string]any{"enabled": false},
				"providers":                map[string]any{},
				"metadataGeneration":       map[string]any{"providers": []any{}},
				"autoArchiveAfterMerge":    false,
				"enableTerminalAgentHooks": false,
				"appendSystemPrompt":       "",
			},
		})

	case protocol.CheckoutStatusRequest:
		return connection.send("checkout_status_response", map[string]any{
			"cwd": request.CWD, "requestId": request.RequestID, "error": nil,
			"isGit": false, "isPaseoOwnedWorktree": false, "repoRoot": nil,
			"currentBranch": nil, "isDirty": nil, "baseRef": nil, "aheadBehind": nil,
			"aheadOfOrigin": nil, "behindOfOrigin": nil, "hasRemote": false, "remoteUrl": nil,
		})

	case protocol.CheckoutPRStatusRequest:
		return connection.send("checkout_pr_status_response", map[string]any{
			"cwd": request.CWD, "requestId": request.RequestID, "status": nil,
			"githubFeaturesEnabled": false, "error": nil,
		})

	case protocol.SubscribeTerminalsRequest, protocol.UnsubscribeTerminalsRequest:
		return true

	case protocol.ListTerminalsRequest:
		payload := map[string]any{"requestId": request.RequestID, "terminals": []any{}}
		if request.CWD != "" {
			payload["cwd"] = request.CWD
		}
		return connection.send("list_terminals_response", payload)

	case protocol.WorkspaceSetupStatusRequest:
		return connection.send("workspace_setup_status_response", map[string]any{
			"requestId": request.RequestID, "workspaceId": request.WorkspaceID, "snapshot": nil,
		})

	case protocol.ListProviderFeaturesRequest:
		return connection.send("list_provider_features_response", map[string]any{
			"requestId": request.RequestID, "provider": request.DraftConfig.Provider,
			"features": []any{}, "error": nil, "fetchedAt": connection.catalog.fetchedAt,
		})

	case protocol.ListAvailableProvidersRequest:
		providerStatus, _ := connection.catalog.provider["status"].(string)
		providerError, _ := connection.catalog.provider["error"].(string)
		return connection.send("list_available_providers_response", map[string]any{
			"requestId": request.RequestID,
			"providers": []any{map[string]any{
				"provider":  "pi",
				"available": providerStatus == "ready",
				"error":     pointerOrNil(providerError),
			}},
			"error":     nil,
			"fetchedAt": connection.catalog.fetchedAt,
		})

	case protocol.GetProvidersSnapshotRequest:
		payload := map[string]any{
			"requestId":   request.RequestID,
			"generatedAt": connection.catalog.fetchedAt,
			"entries":     []any{connection.catalog.provider},
		}
		if request.CWD != nil {
			payload["cwd"] = *request.CWD
		}
		return connection.send("get_providers_snapshot_response", payload)

	case protocol.RefreshProvidersSnapshotRequest:
		return connection.send("refresh_providers_snapshot_response", map[string]any{
			"requestId":    request.RequestID,
			"acknowledged": true,
		})

	case protocol.ListProviderModelsRequest:
		return connection.send("list_provider_models_response", map[string]any{
			"requestId": request.RequestID,
			"provider":  request.Provider,
			"models":    []any{},
			"error":     nil,
			"fetchedAt": connection.catalog.fetchedAt,
		})

	case protocol.ListProviderModesRequest:
		return connection.send("list_provider_modes_response", map[string]any{
			"requestId": request.RequestID,
			"provider":  request.Provider,
			"modes":     []any{},
			"error":     nil,
			"fetchedAt": connection.catalog.fetchedAt,
		})

	case protocol.CreateAgentRequest:
		if reason := unsupportedCreateAgentOption(request); reason != "" {
			return connection.send("status", map[string]any{
				"status":    "agent_create_failed",
				"requestId": request.RequestID,
				"error":     reason,
			})
		}
		title := ""
		if request.Config.Title != nil {
			title = *request.Config.Title
		}
		snapshot, err := connection.manager.Create(ctx, agent.Config{
			Provider:         request.Config.Provider,
			CWD:              request.Config.CWD,
			WorkspaceID:      request.WorkspaceID,
			Model:            pointerValue(request.Config.Model),
			ThinkingOptionID: pointerValue(request.Config.ThinkingOptionID),
			Title:            title,
			Labels:           request.Labels,
		})
		if err != nil {
			return connection.send("status", map[string]any{
				"status":    "agent_create_failed",
				"requestId": request.RequestID,
				"error":     err.Error(),
			})
		}
		if request.InitialPrompt != "" {
			clientMessageID := valueOr(request.ClientMessageID, "create:"+request.RequestID)
			_, _ = connection.manager.Send(ctx, snapshot.ID, clientMessageID, request.InitialPrompt)
			if current, getErr := connection.manager.Get(snapshot.ID); getErr == nil {
				snapshot = current
			}
		}
		return connection.send("status", map[string]any{
			"status":    "agent_created",
			"agentId":   snapshot.ID,
			"requestId": request.RequestID,
			"agent":     agentSnapshotPayload(snapshot),
		})

	case protocol.SendAgentMessageRequest:
		var sendErr error
		if rawCollectionNotEmpty(request.Images) || rawCollectionNotEmpty(request.Attachments) {
			sendErr = errors.New("unsupported: message images and attachments are not implemented")
		} else if request.ActiveTurnBehavior != nil && *request.ActiveTurnBehavior == "steer" {
			snapshot, err := connection.manager.Get(request.AgentID)
			if err != nil {
				sendErr = err
			} else if snapshot.ActiveTurnID != "" {
				sendErr = errors.New("unsupported: steering an active Pi turn is not implemented")
			}
		}
		result := agent.SendResult{}
		if sendErr == nil {
			clientMessageID := valueOr(pointerValue(request.MessageID), "request:"+request.RequestID)
			if request.ActiveTurnBehavior != nil && *request.ActiveTurnBehavior == "steer" {
				result, sendErr = connection.manager.Send(ctx, request.AgentID, clientMessageID, request.Text)
			} else {
				result, sendErr = connection.manager.SendInterrupt(ctx, request.AgentID, clientMessageID, request.Text)
			}
		}
		return connection.send("send_agent_message_response", map[string]any{
			"requestId": request.RequestID,
			"agentId":   request.AgentID,
			"accepted":  result.Accepted,
			"error":     errorPayload(sendErr),
		})

	case protocol.CancelAgentRequest:
		err := connection.manager.Abort(ctx, request.AgentID)
		var snapshot any
		if current, getErr := connection.manager.Get(request.AgentID); getErr == nil {
			snapshot = agentSnapshotPayload(current)
		}
		return connection.send("cancel_agent_response", map[string]any{
			"requestId": request.RequestID,
			"agentId":   request.AgentID,
			"agent":     snapshot,
			"error":     errorPayload(err),
		})

	case protocol.FetchAgentTimelineRequest:
		snapshot, err := connection.manager.Get(request.AgentID)
		if err != nil {
			return connection.send("fetch_agent_timeline_response", timelineErrorPayload(request, err))
		}
		timeline, err := connection.manager.Timeline(request.AgentID)
		if err != nil {
			return connection.send("fetch_agent_timeline_response", timelineErrorPayload(request, err))
		}
		return connection.send("fetch_agent_timeline_response", timelineResponsePayload(request, snapshot, timeline))
	default:
		return false
	}
}

func timelineErrorPayload(request protocol.FetchAgentTimelineRequest, err error) map[string]any {
	return map[string]any{
		"requestId":   request.RequestID,
		"agentId":     request.AgentID,
		"agent":       nil,
		"direction":   valueOrPointer(request.Direction, "tail"),
		"projection":  valueOrPointer(request.Projection, "projected"),
		"epoch":       "",
		"reset":       false,
		"staleCursor": false,
		"gap":         false,
		"window":      map[string]uint64{"minSeq": 0, "maxSeq": 0, "nextSeq": 1},
		"startCursor": nil,
		"endCursor":   nil,
		"hasOlder":    false,
		"hasNewer":    false,
		"entries":     []any{},
		"error":       err.Error(),
	}
}

func isLoopbackPeer(remoteAddress string) bool {
	if address, err := netip.ParseAddrPort(remoteAddress); err == nil {
		return address.Addr().IsLoopback()
	}
	address, err := netip.ParseAddr(remoteAddress)
	return err == nil && address.IsLoopback()
}

func isLoopbackHost(host string) bool {
	name := host
	if parsed, _, err := net.SplitHostPort(host); err == nil {
		name = parsed
	}
	return isLoopbackName(name)
}

func originAllowed(request *http.Request) bool {
	origin := request.Header.Get("Origin")
	if origin == "" {
		return true
	}
	originURL, err := url.Parse(origin)
	if err != nil || (originURL.Scheme != "http" && originURL.Scheme != "https") {
		return false
	}
	if strings.EqualFold(originURL.Host, request.Host) {
		return true
	}
	originHost, originPort, originErr := net.SplitHostPort(originURL.Host)
	requestHost, requestPort, requestErr := net.SplitHostPort(request.Host)
	return originErr == nil && requestErr == nil && originPort == requestPort &&
		isLoopbackName(originHost) && isLoopbackName(requestHost)
}

func isLoopbackName(host string) bool {
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	address, err := netip.ParseAddr(host)
	return err == nil && address.IsLoopback()
}

func unsupportedCreateAgentOption(request protocol.CreateAgentRequest) string {
	if rawCollectionNotEmpty(request.Images) || rawCollectionNotEmpty(request.Attachments) {
		return "unsupported: agent images and attachments are not implemented"
	}
	if len(request.Env) > 0 || request.CallerAgentID != "" || request.AutoArchive || request.WorktreeName != "" {
		return "unsupported: advanced agent creation options are not implemented"
	}
	if request.Config.ModeID != nil || request.Config.SystemPrompt != nil {
		return "unsupported: advanced Pi configuration is not implemented"
	}
	for _, value := range []json.RawMessage{
		request.OutputSchema,
		request.Git,
		request.Worktree,
		request.Config.FeatureValues,
		request.Config.ProviderOptions,
		request.Config.MCPServers,
	} {
		if rawValueHasContent(value) {
			return "unsupported: advanced agent creation options are not implemented"
		}
	}
	return ""
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func pointerOrNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func errorPayload(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}
