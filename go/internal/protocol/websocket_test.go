package protocol

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestDecodeCancelAgentRequest(t *testing.T) {
	frame, err := DecodeClientFrame([]byte(`{
		"type":"session",
		"message":{"type":"cancel_agent_request","agentId":"agent-1","requestId":"request-1"}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	request, ok := frame.Message.(CancelAgentRequest)
	if !ok {
		t.Fatalf("message type = %T", frame.Message)
	}
	if request.AgentID != "agent-1" || request.RequestID != "request-1" {
		t.Fatalf("request = %+v", request)
	}
}

func TestDecodeCatalogRequests(t *testing.T) {
	tests := []struct {
		message string
		want    any
	}{
		{`{"type":"client_heartbeat","deviceType":"web","focusedAgentId":null,"lastActivityAt":"2026-01-01T00:00:00Z","appVisible":true}`, ClientHeartbeat{}},
		{`{"type":"fetch_workspaces_request","requestId":"workspace-1"}`, FetchWorkspacesRequest{}},
		{`{"type":"project.list.request","requestId":"project-1"}`, ProjectListRequest{}},
		{`{"type":"project_icon_request","cwd":"/tmp/project","requestId":"icon-1"}`, ProjectIconRequest{}},
		{`{"type":"project.icon.get.request","projectId":"project-1","requestId":"icon-2"}`, ProjectIconGetRequest{}},
		{`{"type":"daemon.get_pairing_offer.request","requestId":"pair-1","appUrl":"https://app.byspace.cc.cd/","relayUrl":"wss://relay.byspace.cc.cd"}`, DaemonGetPairingOfferRequest{}},
		{`{"type":"get_daemon_config_request","requestId":"config-1"}`, GetDaemonConfigRequest{}},
		{`{"type":"checkout_status_request","cwd":"/tmp/project","requestId":"checkout-1"}`, CheckoutStatusRequest{}},
		{`{"type":"checkout_pr_status_request","cwd":"/tmp/project","requestId":"pr-1"}`, CheckoutPRStatusRequest{}},
		{`{"type":"subscribe_terminals_request","cwd":"/tmp/project"}`, SubscribeTerminalsRequest{}},
		{`{"type":"unsubscribe_terminals_request","cwd":"/tmp/project"}`, UnsubscribeTerminalsRequest{}},
		{`{"type":"list_terminals_request","cwd":"/tmp/project","requestId":"terminal-1"}`, ListTerminalsRequest{}},
		{`{"type":"workspace_setup_status_request","workspaceId":"workspace-1","requestId":"setup-1"}`, WorkspaceSetupStatusRequest{}},
		{`{"type":"list_provider_features_request","draftConfig":{"provider":"pi","cwd":"/tmp/project"},"requestId":"features-1"}`, ListProviderFeaturesRequest{}},
		{`{"type":"list_available_providers_request","requestId":"available-1"}`, ListAvailableProvidersRequest{}},
		{`{"type":"get_providers_snapshot_request","cwd":"/tmp/project","requestId":"snapshot-1"}`, GetProvidersSnapshotRequest{}},
		{`{"type":"refresh_providers_snapshot_request","providers":["pi"],"requestId":"refresh-1"}`, RefreshProvidersSnapshotRequest{}},
		{`{"type":"list_provider_models_request","provider":"pi","requestId":"models-1"}`, ListProviderModelsRequest{}},
		{`{"type":"list_provider_modes_request","provider":"pi","requestId":"modes-1"}`, ListProviderModesRequest{}},
	}
	for _, test := range tests {
		frame, err := DecodeClientFrame([]byte(`{"type":"session","message":` + test.message + `}`))
		if err != nil {
			t.Fatalf("decode %s: %v", test.message, err)
		}
		if fmt.Sprintf("%T", frame.Message) != fmt.Sprintf("%T", test.want) {
			t.Fatalf("message type = %T, want %T", frame.Message, test.want)
		}
	}
}

func TestDecodeAgentRequestsRejectMalformedKnownFields(t *testing.T) {
	for _, input := range []string{
		`{"type":"session","message":{"type":"create_agent_request","requestId":"request-1","config":{"provider":"pi","cwd":"/tmp"},"images":null}}`,
		`{"type":"session","message":{"type":"send_agent_message_request","requestId":"request-1","agentId":"agent-1","text":"hello","attachments":{}}}`,
		`{"type":"session","message":{"type":"cancel_agent_request","agentId":"agent-1"}}`,
		`{"type":"session","message":{"type":"daemon.get_pairing_offer.request","requestId":"request-1","appUrl":1}}`,
	} {
		if _, err := DecodeClientFrame([]byte(input)); err == nil {
			t.Fatalf("accepted malformed request: %s", input)
		}
	}
}

func TestEncodeSessionMessage(t *testing.T) {
	data, err := EncodeSessionMessage("example_response", map[string]any{"requestId": "request-1"})
	if err != nil {
		t.Fatal(err)
	}
	var frame struct {
		Type    string `json:"type"`
		Message struct {
			Type    string         `json:"type"`
			Payload map[string]any `json:"payload"`
		} `json:"message"`
	}
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatal(err)
	}
	if frame.Type != "session" || frame.Message.Type != "example_response" || frame.Message.Payload["requestId"] != "request-1" {
		t.Fatalf("frame = %+v", frame)
	}
}
