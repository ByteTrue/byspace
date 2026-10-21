package store

import "testing"

// Two details from agent-archive.ts are visible to the user and easy to drop.
func TestBuildArchivedAgentRecord(t *testing.T) {
	reason := "finished"
	stamp := "2026-01-01T00:00:00Z"

	running := AgentRecord{
		ID:                 "agt_1",
		LastStatus:         "running",
		UpdatedAt:          "2026-01-01T00:00:00Z",
		RequiresAttention:  true,
		AttentionReason:    &reason,
		AttentionTimestamp: &stamp,
	}
	archived := BuildArchivedAgentRecord(running, "2026-02-02T00:00:00Z")

	// A running agent becomes idle, not "closed". "closed" means the provider is gone; an archived
	// agent still has a readable transcript, and the status drives the sidebar's spinner.
	if archived.LastStatus != "idle" {
		t.Fatalf("status = %q, want idle", archived.LastStatus)
	}
	// Attention is cleared, or the archived agent keeps an unread dot forever: nothing will ever
	// resolve it, because an archived agent cannot finish a turn.
	if archived.RequiresAttention || archived.AttentionReason != nil || archived.AttentionTimestamp != nil {
		t.Fatalf("attention not cleared: %+v", archived)
	}
	if archived.ArchivedAt == nil || *archived.ArchivedAt != "2026-02-02T00:00:00Z" {
		t.Fatalf("archivedAt = %v", archived.ArchivedAt)
	}

	// initializing is normalized the same way.
	initializing := BuildArchivedAgentRecord(AgentRecord{ID: "agt_2", LastStatus: "initializing"}, stamp)
	if initializing.LastStatus != "idle" {
		t.Fatalf("initializing → %q", initializing.LastStatus)
	}

	// Any other status is left alone: an errored agent that is archived is still an errored agent,
	// and rewriting it to idle would hide why it failed.
	errored := BuildArchivedAgentRecord(AgentRecord{ID: "agt_3", LastStatus: "error"}, stamp)
	if errored.LastStatus != "error" {
		t.Fatalf("error → %q", errored.LastStatus)
	}
}

// Archiving must not touch the original record; callers keep using it to broadcast.
func TestBuildArchivedAgentRecordDoesNotMutate(t *testing.T) {
	reason := "finished"
	original := AgentRecord{ID: "agt_4", LastStatus: "running", RequiresAttention: true, AttentionReason: &reason}
	archived := BuildArchivedAgentRecord(original, "2026-01-01T00:00:00Z")
	if archived.ID != original.ID {
		t.Fatal("id changed")
	}
	if original.LastStatus != "running" || !original.RequiresAttention || original.ArchivedAt != nil {
		t.Fatalf("the input was mutated: %+v", original)
	}
}

// Sending a message to an archived agent brings it back: the archive is a tidy-up, not a tombstone.
func TestUnarchiveAgent(t *testing.T) {
	store := New(t.TempDir())
	archived := "2026-01-01T00:00:00Z"

	if err := store.UpsertAgent(AgentRecord{
		ID: "agt_1", Provider: "pi", Cwd: "/tmp", ArchivedAt: &archived, LastStatus: "idle",
	}); err != nil {
		t.Fatal(err)
	}

	restored, err := store.UnarchiveAgent("agt_1")
	if err != nil {
		t.Fatal(err)
	}
	if restored == nil || restored.ArchivedAt != nil {
		t.Fatalf("not restored: %+v", restored)
	}
	// An archived agent was normalized to idle on the way in; leaving "closed" would make the
	// sidebar show a dead agent until the first turn completed.
	if restored.LastStatus != "idle" {
		t.Fatalf("status = %q", restored.LastStatus)
	}

	// It persisted.
	reloaded, err := store.GetAgent("agt_1")
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.ArchivedAt != nil {
		t.Fatal("unarchive did not persist")
	}

	// A second call is a no-op rather than an error: the caller cannot know whether the archive was
	// still there.
	if again, err := store.UnarchiveAgent("agt_1"); err != nil || again != nil {
		t.Fatalf("second call: %+v %v", again, err)
	}
	if missing, err := store.UnarchiveAgent("agt_nope"); err != nil || missing != nil {
		t.Fatalf("missing agent: %+v %v", missing, err)
	}
}
