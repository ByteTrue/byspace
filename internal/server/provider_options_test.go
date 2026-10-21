package server

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// create_agent_request had no `providerOptions` field, so every provider-specific setting the user
// configured in the provider sheet was dropped at create time: reasoning effort, a model provider, a
// sandbox flag. The agent then ran on the provider's defaults and the sheet kept showing the values.
func TestCreateAgentKeepsProviderOptions(t *testing.T) {
	srv := newTunnelTestServer(t, nil)

	raw := []byte(`{
		"requestId": "r1",
		"initialPrompt": "hi",
		"config": {
			"provider": "pi",
			"cwd": "` + strings.ReplaceAll(t.TempDir(), `\`, `\\`) + `",
			"providerOptions": {"reasoningEffort": "high", "sandbox": "workspace-write"}
		}
	}`)
	sink := &recordingSink{}
	srv.handleCreateAgent(t.Context(), sink, raw)

	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	var created *store.AgentRecord
	for i := range agents {
		if agents[i].Provider == "pi" {
			created = &agents[i]
			break
		}
	}
	if created == nil {
		t.Fatal("no agent was created")
	}
	if created.Config == nil || created.Config.ProviderOptions == nil {
		t.Fatal("providerOptions were dropped at create time")
	}
	if created.Config.ProviderOptions["reasoningEffort"] != "high" {
		t.Fatalf("providerOptions = %+v", created.Config.ProviderOptions)
	}
}

// The snapshot must send them back, or the provider sheet shows defaults after a reload.
func TestSnapshotIncludesProviderOptions(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	record := store.AgentRecord{
		ID: "agt_1", Provider: "pi", Cwd: "/tmp", LastStatus: "idle",
		Config: &store.AgentConfig{ProviderOptions: map[string]any{"reasoningEffort": "high"}},
	}
	payload := srv.buildAgentSnapshotPayload(record)
	options, ok := payload["providerOptions"].(map[string]any)
	if !ok {
		t.Fatalf("providerOptions missing from the snapshot: %+v", payload["providerOptions"])
	}
	if options["reasoningEffort"] != "high" {
		t.Fatalf("providerOptions = %+v", options)
	}
}
