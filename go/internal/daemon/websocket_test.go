package daemon

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"byspace/internal/agent"
	"byspace/internal/hub"
	"byspace/internal/protocol"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestAgentWebSocketFlowAndBroadcast(t *testing.T) {
	provider := &webSocketTestProvider{}
	manager := agent.NewManager(map[string]agent.Provider{"pi": provider})
	defer manager.Close(context.Background())
	handler := newAgentWebSocketHandler(manager, newTestCatalog(t), "srv_test", "test-host")
	server := httptest.NewServer(handler)
	defer server.Close()
	defer handler.Close()

	first := dialAndHello(t, server.URL)
	defer first.CloseNow()
	second := dialAndHello(t, server.URL)
	defer second.CloseNow()

	writeJSON(t, first, map[string]any{"type": "ping"})
	readUntil(t, first, func(message map[string]any) bool {
		return nestedString(message, "type") == "pong"
	})

	cwd := t.TempDir()
	writeJSON(t, first, map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "create_agent_request",
			"config": map[string]any{
				"provider": "pi",
				"cwd":      cwd,
				"title":    "WebSocket test",
			},
			"workspaceId":     "workspace-test",
			"initialPrompt":   "first",
			"clientMessageId": "client-first",
			"attachments":     []any{},
			"labels":          map[string]string{"source": "test"},
			"requestId":       "create-1",
		},
	})

	created := readUntil(t, first, func(message map[string]any) bool {
		return sessionType(message) == "status" && nestedString(message, "message", "payload", "status") == "agent_created"
	})
	agentID := nestedString(created, "message", "payload", "agentId")
	if agentID == "" {
		t.Fatal("agent_created did not contain agentId")
	}
	if got := nestedString(created, "message", "payload", "agent", "workspaceId"); got != "workspace-test" {
		t.Fatalf("workspaceId = %q", got)
	}
	readUntil(t, second, func(message map[string]any) bool {
		return sessionType(message) == "agent_update" && nestedString(message, "message", "payload", "agent", "id") == agentID
	})

	waitForTimelineRows(t, manager, agentID, 2)
	writeSession(t, first, map[string]any{
		"type":       "fetch_agent_timeline_request",
		"agentId":    agentID,
		"direction":  "tail",
		"limit":      0,
		"projection": "canonical",
		"requestId":  "timeline-1",
	})
	timeline := readUntil(t, first, func(message map[string]any) bool {
		return sessionType(message) == "fetch_agent_timeline_response" && nestedString(message, "message", "payload", "requestId") == "timeline-1"
	})
	entries := nestedSlice(t, timeline, "message", "payload", "entries")
	if len(entries) != 2 {
		t.Fatalf("timeline entries = %d, want 2", len(entries))
	}
	if got := nestedString(entries[0].(map[string]any), "item", "type"); got != "user_message" {
		t.Fatalf("first timeline type = %q", got)
	}
	if got := nestedString(entries[1].(map[string]any), "item", "type"); got != "assistant_message" {
		t.Fatalf("second timeline type = %q", got)
	}

	if _, err := manager.Send(context.Background(), agentID, "broadcast-message", "broadcast"); err != nil {
		t.Fatal(err)
	}
	for index, connection := range []*websocket.Conn{first, second} {
		message := readUntil(t, connection, func(message map[string]any) bool {
			return sessionType(message) == "agent_stream" &&
				nestedString(message, "message", "payload", "event", "type") == "timeline" &&
				nestedString(message, "message", "payload", "event", "item", "text") == "broadcast"
		})
		if nestedString(message, "message", "payload", "event", "item", "type") != "user_message" {
			t.Fatalf("client %d did not receive live user row", index+1)
		}
	}

	writeSession(t, first, map[string]any{
		"type":        "send_agent_message_request",
		"agentId":     agentID,
		"text":        "hold",
		"messageId":   "client-hold",
		"attachments": []any{},
		"requestId":   "send-2",
	})
	sent := readUntil(t, first, func(message map[string]any) bool {
		return sessionType(message) == "send_agent_message_response" && nestedString(message, "message", "payload", "requestId") == "send-2"
	})
	if !nestedBool(sent, "message", "payload", "accepted") {
		t.Fatal("second prompt was not accepted")
	}

	writeSession(t, first, map[string]any{
		"type":      "cancel_agent_request",
		"agentId":   agentID,
		"requestId": "cancel-2",
	})
	canceled := readUntil(t, first, func(message map[string]any) bool {
		return sessionType(message) == "cancel_agent_response" && nestedString(message, "message", "payload", "requestId") == "cancel-2"
	})
	if value := nestedValue(canceled, "message", "payload", "error"); value != nil {
		t.Fatalf("cancel error = %v", value)
	}
	if got := nestedString(canceled, "message", "payload", "agent", "status"); got != "idle" {
		t.Fatalf("status after cancel = %q", got)
	}
}

func TestLocalWebSocketManagesHubRelationship(t *testing.T) {
	connected := make(chan struct{}, 1)
	revoked := make(chan struct{}, 1)
	var hubServer *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/api/daemons/enroll", func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+strings.Repeat("e", 32) {
			t.Error("enrollment token was not forwarded")
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		var input struct {
			DaemonID           string   `json:"daemonId"`
			CredentialVerifier string   `json:"credentialVerifier"`
			Scopes             []string `json:"scopes"`
		}
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Error(err)
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		if input.DaemonID == "" || input.CredentialVerifier == "" || len(input.Scopes) != 1 || input.Scopes[0] != "hub.execution.*" {
			t.Errorf("invalid enrollment input: %#v", input)
		}
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(response).Encode(map[string]any{
			"daemonId": input.DaemonID, "scopes": input.Scopes,
			"webSocketUrl": strings.Replace(hubServer.URL, "http://", "ws://", 1) + "/api/daemons/socket",
		})
	})
	mux.HandleFunc("/api/daemons/socket", func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") == "" || request.Header.Get("X-Paseo-Daemon-Id") == "" {
			t.Error("Hub socket authority is incomplete")
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.CloseNow()
		connected <- struct{}{}
		_, _, _ = connection.Read(request.Context())
	})
	mux.HandleFunc("/api/daemons/", func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodDelete || request.Header.Get("Authorization") == "" {
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		revoked <- struct{}{}
		response.WriteHeader(http.StatusNoContent)
	})
	hubServer = httptest.NewServer(mux)
	defer hubServer.Close()

	hubManager, err := hub.NewManager(t.Context(), hub.Options{
		Home: t.TempDir(), Hostname: "test-host", ServerID: "srv_123456789012",
		DaemonPublicKey: func() (string, error) {
			return base64.StdEncoding.EncodeToString(make([]byte, 32)), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer hubManager.Close()
	agentManager := agent.NewManager(map[string]agent.Provider{})
	defer agentManager.Close(context.Background())
	handler := newAgentWebSocketHandler(agentManager, newTestCatalog(t), "srv_test", "test-host")
	handler.setHubManager(hubManager)
	server := httptest.NewServer(handler)
	defer server.Close()
	defer handler.Close()
	connection := dialAndHello(t, server.URL)
	defer connection.CloseNow()

	writeSession(t, connection, map[string]any{
		"type": "hub.management.daemon.connect.request", "requestId": "hub-connect-1",
		"hubUrl": hubServer.URL, "token": strings.Repeat("e", 32),
	})
	connectResponse := readUntil(t, connection, func(message map[string]any) bool {
		return sessionType(message) == "hub.management.daemon.connect.response"
	})
	if got := nestedString(connectResponse, "message", "payload", "status", "state"); got != "connecting" {
		t.Fatalf("connect response state = %q", got)
	}
	select {
	case <-connected:
	case <-time.After(3 * time.Second):
		t.Fatal("daemon did not open the authenticated Hub WebSocket")
	}

	writeSession(t, connection, map[string]any{"type": "hub.management.daemon.get_status.request", "requestId": "hub-status-1"})
	statusResponse := readUntil(t, connection, func(message map[string]any) bool {
		return sessionType(message) == "hub.management.daemon.get_status.response"
	})
	if got := nestedString(statusResponse, "message", "payload", "status", "state"); got != "connected" {
		t.Fatalf("Hub state = %q", got)
	}
	encoded, _ := json.Marshal(statusResponse)
	if strings.Contains(string(encoded), strings.Repeat("e", 32)) || strings.Contains(string(encoded), "credentialVerifier") {
		t.Fatalf("Hub status leaked authority: %s", encoded)
	}

	writeSession(t, connection, map[string]any{"type": "hub.management.daemon.disconnect.request", "requestId": "hub-disconnect-1", "force": false})
	disconnectResponse := readUntil(t, connection, func(message map[string]any) bool {
		return sessionType(message) == "hub.management.daemon.disconnect.response"
	})
	if nestedString(disconnectResponse, "message", "payload", "status", "state") != "not_connected" {
		t.Fatalf("disconnect response = %#v", nestedValue(disconnectResponse, "message", "payload"))
	}
	select {
	case <-revoked:
	case <-time.After(3 * time.Second):
		t.Fatal("daemon did not revoke the Hub relationship")
	}
}

func TestRemoteAgentSessionCancelsSlowConsumerWithoutLeaking(t *testing.T) {
	provider := &webSocketTestProvider{holdFirst: true}
	manager := agent.NewManager(map[string]agent.Provider{"pi": provider})
	defer manager.Close(context.Background())
	handler := newAgentWebSocketHandler(manager, newTestCatalog(t), "srv_test", "test-host")
	defer handler.Close()

	snapshot, err := manager.Create(t.Context(), agent.Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(t.Context(), snapshot.ID, "hold", "slow-consumer"); err != nil {
		t.Fatal(err)
	}
	hello, err := json.Marshal(map[string]any{
		"type": "hello", "clientId": "slow-consumer", "clientType": "cli", "protocolVersion": 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	socket := newSlowConsumerSocket(hello, []byte(`{"type":"ping"}`))
	serveDone := make(chan struct{})
	go func() {
		handler.serveRemoteConnection(socket)
		close(serveDone)
	}()
	select {
	case <-socket.subscribed:
	case <-time.After(time.Second):
		t.Fatal("remote session did not subscribe to Agent events")
	}
	select {
	case <-socket.writeStarted:
	case <-time.After(time.Second):
		t.Fatal("remote session writer did not block")
	}

	provider.mu.Lock()
	session := provider.session
	provider.mu.Unlock()
	if session == nil {
		t.Fatal("provider session was not created")
	}
	session.mu.Lock()
	turnID := session.active
	session.mu.Unlock()
	for index := 0; index < webSocketQueueSize+32; index++ {
		session.events <- agent.ProviderEvent{
			Type:   agent.ProviderEventTimeline,
			TurnID: turnID,
			Item:   agent.TimelineItem{Type: agent.TimelineAssistantMessage, Text: "slow-consumer-row"},
		}
	}
	select {
	case <-serveDone:
	case <-time.After(2 * time.Second):
		t.Fatal("slow remote consumer was not canceled after queue exhaustion")
	}
	select {
	case <-socket.closed:
	default:
		t.Fatal("slow remote consumer socket was not closed before session exit")
	}
	if _, err := manager.Get(snapshot.ID); err != nil {
		t.Fatalf("slow remote consumer affected canonical Agent state: %v", err)
	}
}

func TestAgentWebSocketCatalogContracts(t *testing.T) {
	manager := agent.NewManager(map[string]agent.Provider{})
	defer manager.Close(context.Background())
	catalog := newTestCatalog(t)
	handler := newAgentWebSocketHandler(manager, catalog, "srv_test", "test-host")
	server := httptest.NewServer(handler)
	defer server.Close()
	defer handler.Close()
	connection := dialAndHello(t, server.URL)
	defer connection.CloseNow()
	writeSession(t, connection, map[string]any{
		"type": "client_heartbeat", "deviceType": "web", "focusedAgentId": nil,
		"lastActivityAt": time.Now().UTC().Format(time.RFC3339Nano), "appVisible": true,
	})
	writeSession(t, connection, map[string]any{"type": "subscribe_terminals_request", "cwd": t.TempDir()})
	writeSession(t, connection, map[string]any{"type": "unsubscribe_terminals_request", "cwd": t.TempDir()})

	tests := []struct {
		request      map[string]any
		responseType string
		requestID    string
	}{
		{map[string]any{"type": "fetch_workspaces_request", "requestId": "workspace-1"}, "fetch_workspaces_response", "workspace-1"},
		{map[string]any{"type": "project.list.request", "requestId": "project-1"}, "project.list.response", "project-1"},
		{map[string]any{"type": "project_icon_request", "cwd": t.TempDir(), "requestId": "icon-1"}, "project_icon_response", "icon-1"},
		{map[string]any{"type": "project.icon.get.request", "projectId": "project-1", "requestId": "icon-2"}, "project.icon.get.response", "icon-2"},
		{map[string]any{"type": "get_daemon_config_request", "requestId": "config-1"}, "get_daemon_config_response", "config-1"},
		{map[string]any{"type": "checkout_status_request", "cwd": t.TempDir(), "requestId": "checkout-1"}, "checkout_status_response", "checkout-1"},
		{map[string]any{"type": "checkout_pr_status_request", "cwd": t.TempDir(), "requestId": "pr-1"}, "checkout_pr_status_response", "pr-1"},
		{map[string]any{"type": "list_terminals_request", "cwd": t.TempDir(), "requestId": "terminals-1"}, "list_terminals_response", "terminals-1"},
		{map[string]any{"type": "workspace_setup_status_request", "workspaceId": "workspace-1", "requestId": "setup-1"}, "workspace_setup_status_response", "setup-1"},
		{map[string]any{"type": "get_providers_snapshot_request", "cwd": t.TempDir(), "requestId": "providers-1"}, "get_providers_snapshot_response", "providers-1"},
		{map[string]any{"type": "list_provider_features_request", "draftConfig": map[string]any{"provider": "pi", "cwd": t.TempDir()}, "requestId": "features-1"}, "list_provider_features_response", "features-1"},
		{map[string]any{"type": "list_available_providers_request", "requestId": "available-1"}, "list_available_providers_response", "available-1"},
		{map[string]any{"type": "list_provider_models_request", "provider": "pi", "requestId": "models-1"}, "list_provider_models_response", "models-1"},
		{map[string]any{"type": "list_provider_modes_request", "provider": "pi", "requestId": "modes-1"}, "list_provider_modes_response", "modes-1"},
		{map[string]any{"type": "refresh_providers_snapshot_request", "providers": []string{"pi"}, "requestId": "refresh-1"}, "refresh_providers_snapshot_response", "refresh-1"},
	}
	for _, test := range tests {
		writeSession(t, connection, test.request)
		response := readUntil(t, connection, func(message map[string]any) bool {
			return sessionType(message) == test.responseType && nestedString(message, "message", "payload", "requestId") == test.requestID
		})
		if nestedValue(response, "message", "payload") == nil {
			t.Fatalf("%s has no payload", test.responseType)
		}
	}
}

func TestAgentWebSocketRejectsCrossOriginAndNonLoopback(t *testing.T) {
	manager := agent.NewManager(map[string]agent.Provider{})
	defer manager.Close(context.Background())
	handler := newAgentWebSocketHandler(manager, newTestCatalog(t), "srv_test", "test-host")
	server := httptest.NewServer(handler)
	defer server.Close()
	defer handler.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, response, err := websocket.Dial(ctx, strings.Replace(server.URL, "http://", "ws://", 1), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"https://evil.example"}},
	})
	if err == nil {
		t.Fatal("cross-origin dial unexpectedly succeeded")
	}
	if response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin response = %#v", response)
	}

	loopbackAliasOrigin := strings.Replace(server.URL, "127.0.0.1", "localhost", 1)
	aliasConnection, _, err := websocket.Dial(ctx, strings.Replace(server.URL, "http://", "ws://", 1), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{loopbackAliasOrigin}},
	})
	if err != nil {
		t.Fatalf("equivalent loopback origin was rejected: %v", err)
	}
	aliasConnection.CloseNow()

	request := httptest.NewRequest(http.MethodGet, "http://localhost/ws", nil)
	request.RemoteAddr = "192.0.2.1:4242"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("non-loopback status = %d", recorder.Code)
	}

	rebindingRequest := httptest.NewRequest(http.MethodGet, "http://evil.example/ws", nil)
	rebindingRequest.RemoteAddr = "127.0.0.1:4242"
	rebindingRecorder := httptest.NewRecorder()
	handler.ServeHTTP(rebindingRecorder, rebindingRequest)
	if rebindingRecorder.Code != http.StatusForbidden {
		t.Fatalf("DNS rebinding host status = %d", rebindingRecorder.Code)
	}
}

func TestAgentWebSocketRejectsTimeoutBinaryAndOversizeFrames(t *testing.T) {
	manager := agent.NewManager(map[string]agent.Provider{})
	defer manager.Close(context.Background())
	handler := newAgentWebSocketHandler(manager, newTestCatalog(t), "srv_test", "test-host")
	handler.helloTimeout = 20 * time.Millisecond
	server := httptest.NewServer(handler)
	defer server.Close()
	defer handler.Close()
	url := strings.Replace(server.URL, "http://", "ws://", 1)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	timedOut, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	_, _, err = timedOut.Read(ctx)
	cancel()
	timedOut.CloseNow()
	if err == nil {
		t.Fatal("connection without hello remained open")
	}

	binary := dialAndHello(t, server.URL)
	writeCtx, writeCancel := context.WithTimeout(context.Background(), time.Second)
	if err := binary.Write(writeCtx, websocket.MessageBinary, []byte{1, 2, 3}); err != nil {
		writeCancel()
		t.Fatal(err)
	}
	_, _, err = binary.Read(writeCtx)
	writeCancel()
	binary.CloseNow()
	if status := websocket.CloseStatus(err); status != websocket.StatusUnsupportedData {
		t.Fatalf("binary close status = %v, err = %v", status, err)
	}

	oversize := dialAndHello(t, server.URL)
	writeCtx, writeCancel = context.WithTimeout(context.Background(), 3*time.Second)
	if err := oversize.Write(writeCtx, websocket.MessageText, bytes.Repeat([]byte{'x'}, webSocketReadLimit+1)); err != nil {
		writeCancel()
		t.Fatal(err)
	}
	_, _, err = oversize.Read(writeCtx)
	writeCancel()
	oversize.CloseNow()
	if status := websocket.CloseStatus(err); status != websocket.StatusMessageTooBig {
		t.Fatalf("oversize close status = %v, err = %v", status, err)
	}
}

func TestTimelineWindowBoundaries(t *testing.T) {
	snapshot := agent.Snapshot{
		ID:            "agent-1",
		Provider:      "pi",
		CWD:           t.TempDir(),
		Lifecycle:     agent.LifecycleIdle,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		TimelineEpoch: "epoch-1",
		Labels:        map[string]string{},
		RuntimeInfo:   agent.RuntimeInfo{Provider: "pi"},
	}
	rows := make([]agent.TimelineRow, 5)
	for index := range rows {
		rows[index] = agent.TimelineRow{
			Seq:       uint64(index + 1),
			Timestamp: time.Now(),
			TurnID:    "turn-1",
			Item:      agent.TimelineItem{Type: agent.TimelineAssistantMessage, Text: "row"},
		}
	}
	timeline := agent.TimelineSnapshot{Epoch: "epoch-1", Rows: rows}

	before := "before"
	limit := 2
	payload := timelineResponsePayload(protocolTimelineRequest("request-before", before, "epoch-1", 5, &limit), snapshot, timeline)
	entries := payload["entries"].([]map[string]any)
	if len(entries) != 2 || entries[0]["seqStart"] != uint64(3) || entries[1]["seqStart"] != uint64(4) {
		t.Fatalf("before page = %#v", entries)
	}
	if payload["hasOlder"] != true || payload["hasNewer"] != true {
		t.Fatalf("before page bounds = older:%v newer:%v", payload["hasOlder"], payload["hasNewer"])
	}

	after := "after"
	payload = timelineResponsePayload(protocolTimelineRequest("request-after", after, "epoch-1", 2, &limit), snapshot, timeline)
	entries = payload["entries"].([]map[string]any)
	if len(entries) != 2 || entries[0]["seqStart"] != uint64(3) || entries[1]["seqStart"] != uint64(4) {
		t.Fatalf("after page = %#v", entries)
	}

	zero := 0
	tail := "tail"
	payload = timelineResponsePayload(protocolTimelineRequest("request-all", tail, "epoch-1", 0, &zero), snapshot, timeline)
	if got := len(payload["entries"].([]map[string]any)); got != 5 {
		t.Fatalf("limit zero entries = %d", got)
	}

	empty := agent.TimelineSnapshot{Epoch: "epoch-empty"}
	emptyPayload := timelineResponsePayload(protocolTimelineRequest("request-empty", tail, "epoch-empty", 0, &zero), snapshot, empty)
	if len(emptyPayload["entries"].([]map[string]any)) != 0 || emptyPayload["startCursor"] != nil || emptyPayload["endCursor"] != nil {
		t.Fatalf("empty timeline payload = %#v", emptyPayload)
	}
	if emptyPayload["window"].(map[string]uint64)["nextSeq"] != 1 {
		t.Fatalf("empty timeline window = %#v", emptyPayload["window"])
	}

	payload = timelineResponsePayload(protocolTimelineRequest("request-stale", before, "stale", 3, &limit), snapshot, timeline)
	if payload["staleCursor"] != true || payload["reset"] != true {
		t.Fatalf("stale cursor flags = %#v", payload)
	}
	entries = payload["entries"].([]map[string]any)
	if len(entries) != 2 || entries[0]["seqStart"] != uint64(4) || entries[1]["seqStart"] != uint64(5) {
		t.Fatalf("stale cursor tail = %#v", entries)
	}
}

func protocolTimelineRequest(requestID, direction, epoch string, seq int, limit *int) protocol.FetchAgentTimelineRequest {
	return protocol.FetchAgentTimelineRequest{
		AgentID:    "agent-1",
		Direction:  &direction,
		Cursor:     &protocol.AgentTimelineCursor{Epoch: epoch, Seq: seq},
		Limit:      limit,
		Projection: stringPointer("canonical"),
		RequestID:  requestID,
	}
}

func dialAndHello(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, strings.Replace(serverURL, "http://", "ws://", 1), nil)
	if err != nil {
		t.Fatal(err)
	}
	writeJSON(t, connection, map[string]any{
		"type":            "hello",
		"clientId":        "websocket-test",
		"clientType":      "cli",
		"protocolVersion": 1,
	})
	serverInfo := readUntil(t, connection, func(message map[string]any) bool {
		return sessionType(message) == "status" && nestedString(message, "message", "payload", "status") == "server_info"
	})
	if got := nestedString(serverInfo, "message", "payload", "serverId"); got != "srv_test" {
		t.Fatalf("serverId = %q", got)
	}
	for _, feature := range []string{"agentTurnIdentity", "workspaceMultiplicity", "projectList", "providersSnapshot", "providersSnapshotCwd", "pairingOfferRpc"} {
		if !nestedBool(serverInfo, "message", "payload", "features", feature) {
			t.Fatalf("server feature %s is not enabled", feature)
		}
	}
	return connection
}

func writeSession(t *testing.T, connection *websocket.Conn, message map[string]any) {
	t.Helper()
	writeJSON(t, connection, map[string]any{"type": "session", "message": message})
}

func writeJSON(t *testing.T, connection *websocket.Conn, value any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, connection, value); err != nil {
		t.Fatal(err)
	}
}

func readUntil(t *testing.T, connection *websocket.Conn, predicate func(map[string]any) bool) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		var message map[string]any
		if err := wsjson.Read(ctx, connection, &message); err != nil {
			t.Fatal(err)
		}
		if predicate(message) {
			return message
		}
	}
}

func waitForTimelineRows(t *testing.T, manager *agent.Manager, agentID string, count int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		timeline, err := manager.Timeline(agentID)
		if err == nil && len(timeline.Rows) >= count {
			return
		}
		time.Sleep(time.Millisecond)
	}
	timeline, err := manager.Timeline(agentID)
	t.Fatalf("timeline did not reach %d rows: rows=%#v err=%v", count, timeline.Rows, err)
}

func sessionType(message map[string]any) string {
	return nestedString(message, "message", "type")
}

func nestedString(value map[string]any, path ...string) string {
	result := nestedValue(value, path...)
	text, _ := result.(string)
	return text
}

func nestedBool(value map[string]any, path ...string) bool {
	result := nestedValue(value, path...)
	flag, _ := result.(bool)
	return flag
}

func nestedSlice(t *testing.T, value map[string]any, path ...string) []any {
	t.Helper()
	result, ok := nestedValue(value, path...).([]any)
	if !ok {
		t.Fatalf("%v is not an array", path)
	}
	return result
}

func nestedValue(value map[string]any, path ...string) any {
	var current any = value
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func stringPointer(value string) *string { return &value }

func newTestCatalog(t *testing.T) *localCatalog {
	t.Helper()
	catalog, err := newLocalCatalog(t.TempDir(), "pi")
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

type webSocketTestProvider struct {
	mu        sync.Mutex
	session   *webSocketTestSession
	holdFirst bool
}

func (provider *webSocketTestProvider) Start(context.Context, agent.Config) (agent.Session, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	provider.session = &webSocketTestSession{events: make(chan agent.ProviderEvent, 32), holdFirst: provider.holdFirst}
	provider.session.events <- agent.ProviderEvent{Type: agent.ProviderEventThreadStarted, SessionID: "pi-session-test"}
	return provider.session, nil
}

type webSocketTestSession struct {
	mu        sync.Mutex
	events    chan agent.ProviderEvent
	prompts   int
	active    string
	closed    bool
	holdFirst bool
}

func (session *webSocketTestSession) RuntimeInfo() agent.RuntimeInfo {
	return agent.RuntimeInfo{Provider: "pi", SessionID: "pi-session-test"}
}
func (session *webSocketTestSession) Capabilities() agent.Capabilities {
	return agent.Capabilities{SupportsStreaming: true, SupportsSessionPersistence: true}
}
func (session *webSocketTestSession) Events() <-chan agent.ProviderEvent { return session.events }
func (session *webSocketTestSession) Prompt(_ context.Context, turnID, _ string) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	session.prompts++
	session.active = turnID
	session.events <- agent.ProviderEvent{Type: agent.ProviderEventTurnStarted, TurnID: turnID}
	if session.prompts == 1 && !session.holdFirst {
		session.events <- agent.ProviderEvent{
			Type:   agent.ProviderEventTimeline,
			TurnID: turnID,
			Item:   agent.TimelineItem{Type: agent.TimelineAssistantMessage, Text: "answer"},
		}
		session.events <- agent.ProviderEvent{Type: agent.ProviderEventTurnCompleted, TurnID: turnID}
	}
	return nil
}
func (session *webSocketTestSession) Abort(context.Context) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	session.events <- agent.ProviderEvent{Type: agent.ProviderEventTurnCanceled, TurnID: session.active, Error: "canceled"}
	session.active = ""
	return nil
}
func (session *webSocketTestSession) Close(context.Context) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	if !session.closed {
		session.closed = true
		close(session.events)
	}
	return nil
}

type slowConsumerSocket struct {
	reads        chan []byte
	subscribed   chan struct{}
	writeStarted chan struct{}
	closed       chan struct{}
	readCount    int
	writeOnce    sync.Once
	closeOnce    sync.Once
}

func newSlowConsumerSocket(frames ...[]byte) *slowConsumerSocket {
	socket := &slowConsumerSocket{
		reads:        make(chan []byte, len(frames)),
		subscribed:   make(chan struct{}),
		writeStarted: make(chan struct{}),
		closed:       make(chan struct{}),
	}
	for _, frame := range frames {
		socket.reads <- frame
	}
	return socket
}

func (socket *slowConsumerSocket) Read(ctx context.Context) (websocket.MessageType, []byte, error) {
	select {
	case data := <-socket.reads:
		socket.readCount++
		if socket.readCount == 2 {
			close(socket.subscribed)
		}
		return websocket.MessageText, data, nil
	case <-ctx.Done():
		return 0, nil, ctx.Err()
	case <-socket.closed:
		return 0, nil, context.Canceled
	}
}

func (socket *slowConsumerSocket) Write(ctx context.Context, _ websocket.MessageType, _ []byte) error {
	socket.writeOnce.Do(func() { close(socket.writeStarted) })
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-socket.closed:
		return context.Canceled
	}
}

func (socket *slowConsumerSocket) Close(websocket.StatusCode, string) error {
	return socket.CloseNow()
}

func (socket *slowConsumerSocket) CloseNow() error {
	socket.closeOnce.Do(func() { close(socket.closed) })
	return nil
}

func TestWebSocketProjectionIsJSONSerializable(t *testing.T) {
	payload := agentSnapshotPayload(agent.Snapshot{
		ID:          "agent-json",
		Provider:    "pi",
		CWD:         t.TempDir(),
		Lifecycle:   agent.LifecycleIdle,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		Labels:      map[string]string{},
		RuntimeInfo: agent.RuntimeInfo{Provider: "pi"},
	})
	if _, err := json.Marshal(payload); err != nil {
		t.Fatal(err)
	}
}
