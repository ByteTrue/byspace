package server

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// The client groups a child under its parent by reading `byspace.parent-agent-id`, so a child created
// without the label appears as an unrelated top-level agent.
func TestCreateAgentLabelsTheParent(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	if err := srv.store.UpsertAgent(store.AgentRecord{
		ID: "agt_parent", Provider: "pi", Cwd: dir, LastStatus: "idle",
	}); err != nil {
		t.Fatal(err)
	}

	raw := []byte(`{
		"requestId": "r1",
		"initialPrompt": "child work",
		"callerAgentId": "agt_parent",
		"config": {"provider": "pi", "cwd": "` + strings.ReplaceAll(dir, `\`, `\\`) + `"}
	}`)
	srv.handleCreateAgent(t.Context(), &recordingSink{}, raw)

	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	var child *store.AgentRecord
	for i := range agents {
		if agents[i].ID != "agt_parent" {
			child = &agents[i]
			break
		}
	}
	if child == nil {
		t.Fatal("no child was created")
	}
	if child.Labels[ParentAgentIDLabel] != "agt_parent" {
		t.Fatalf("parent label = %q", child.Labels[ParentAgentIDLabel])
	}
	if child.ParentAgentID == nil || *child.ParentAgentID != "agt_parent" {
		t.Fatalf("parent field = %v", child.ParentAgentID)
	}
}

// The per-agent environment is a top-level field of create_agent_request. Reading it from inside
// `config` (where the CLI used to write it) silently dropped it, and the provider never saw the
// variables.
func TestCreateAgentStoresPerAgentEnv(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()

	raw := []byte(`{
		"requestId": "r1",
		"initialPrompt": "work",
		"env": {"ANTHROPIC_BASE_URL": "https://proxy.example"},
		"config": {"provider": "pi", "cwd": "` + strings.ReplaceAll(dir, `\`, `\`) + `"}
	}`)
	srv.handleCreateAgent(t.Context(), &recordingSink{}, raw)

	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != 1 {
		t.Fatalf("agents = %d, want 1", len(agents))
	}
	if agents[0].Config == nil || agents[0].Config.Env["ANTHROPIC_BASE_URL"] != "https://proxy.example" {
		t.Fatalf("env not stored: %+v", agents[0].Config)
	}
}
