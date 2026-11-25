package server

import (
	"strings"
	"testing"
)

func TestCreateAgentSubmitsImageOnlyInitialPrompt(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv := newTunnelTestServer(t, nil)
	sink := &recordingSink{}
	raw := []byte(`{
		"requestId": "image-only-initial-prompt",
		"initialPrompt": "",
		"images": [{"data": "aGVsbG8=", "mimeType": "image/png"}],
		"config": {
			"provider": "mock",
			"cwd": "` + strings.ReplaceAll(t.TempDir(), `\`, `\\`) + `",
			"featureValues": {"mockPromptRejections": 1}
		}
	}`)

	srv.handleCreateAgent(t.Context(), sink, raw)

	failure := lastSessionPayload[struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}](t, sink, "status")
	if failure.Status != "agent_create_failed" || failure.Error != "Requested mock prompt rejection" {
		t.Fatalf("image-only prompt did not reach the provider: %+v", failure)
	}
}

func TestCreateAgentFailsWhenInitialPromptIsRejected(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv := newTunnelTestServer(t, nil)
	sink := &recordingSink{}
	raw := []byte(`{
		"requestId": "reject-initial-prompt",
		"initialPrompt": "start work",
		"config": {
			"provider": "mock",
			"cwd": "` + strings.ReplaceAll(t.TempDir(), `\`, `\\`) + `",
			"featureValues": {"mockPromptRejections": 1}
		}
	}`)

	srv.handleCreateAgent(t.Context(), sink, raw)

	failure := lastSessionPayload[struct {
		Status    string `json:"status"`
		RequestID string `json:"requestId"`
		Error     string `json:"error"`
	}](t, sink, "status")
	if failure.Status != "agent_create_failed" || failure.RequestID != "reject-initial-prompt" {
		t.Fatalf("unexpected creation response: %+v", failure)
	}
	if failure.Error != "Requested mock prompt rejection" {
		t.Fatalf("creation error = %q", failure.Error)
	}

	sink.mu.Lock()
	frames := append([]string(nil), sink.texts...)
	sink.mu.Unlock()
	for _, frame := range frames {
		if strings.Contains(frame, `"status":"agent_created"`) {
			t.Fatalf("rejected creation also reported success: %s", frame)
		}
	}

	srv.mu.Lock()
	agentCount := len(srv.agents)
	srv.mu.Unlock()
	if agentCount != 0 {
		t.Fatalf("in-memory agents = %d, want 0", agentCount)
	}
	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != 0 {
		t.Fatalf("persisted agents = %+v, want none", agents)
	}
}
