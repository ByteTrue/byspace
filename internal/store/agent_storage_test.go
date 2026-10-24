package store

import "testing"

// A provider session file can back more than one agent record — a fork, or a resume that created a
// second record — and importing a session has to know about all of them.
func TestListByProviderSession(t *testing.T) {
	store := New(t.TempDir())
	for _, record := range []AgentRecord{
		{ID: "agt_a", Provider: "pi", Cwd: "/tmp/a", Persistence: &AgentPersistenceHandle{Provider: "pi", SessionID: "/s/one.jsonl"}},
		{ID: "agt_b", Provider: "pi", Cwd: "/tmp/b", Persistence: &AgentPersistenceHandle{Provider: "pi", SessionID: "/s/one.jsonl"}},
		{ID: "agt_c", Provider: "claude", Cwd: "/tmp/c", Persistence: &AgentPersistenceHandle{Provider: "claude", SessionID: "/s/two.jsonl"}},
		{ID: "agt_d", Provider: "pi", Cwd: "/tmp/d"},
	} {
		if err := store.UpsertAgent(record); err != nil {
			t.Fatal(err)
		}
	}

	got, err := store.ListByProviderSession("pi", "/s/one.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("agents = %d, want both records backed by that session", len(got))
	}
	for _, agent := range got {
		if agent.Provider != "pi" {
			t.Fatalf("wrong provider: %+v", agent)
		}
	}

	// A different provider does not match the same handle.
	claude, err := store.ListByProviderSession("claude", "/s/one.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(claude) != 0 {
		t.Fatalf("cross-provider match: %+v", claude)
	}
}

func TestListByWorkspace(t *testing.T) {
	store := New(t.TempDir())
	for _, record := range []AgentRecord{
		{ID: "agt_a", Provider: "pi", Cwd: "/tmp/a", WorkspaceID: "ws_1"},
		{ID: "agt_b", Provider: "pi", Cwd: "/tmp/b", WorkspaceID: "ws_1"},
		{ID: "agt_c", Provider: "pi", Cwd: "/tmp/c", WorkspaceID: "ws_2"},
	} {
		if err := store.UpsertAgent(record); err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.ListByWorkspace("ws_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("agents = %d", len(got))
	}
	if empty, err := store.ListByWorkspace("ws_none"); err != nil || len(empty) != 0 {
		t.Fatalf("empty = %+v %v", empty, err)
	}
}
