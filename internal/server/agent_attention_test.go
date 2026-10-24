package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func attentionServer(t *testing.T) *Server {
	t.Helper()
	tmp := t.TempDir()
	work := filepath.Join(tmp, "w")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

func putAgent(t *testing.T, srv *Server, id, workspaceID, status string, extra func(*store.AgentRecord)) {
	t.Helper()
	rec := store.AgentRecord{
		ID: id, Cwd: t.TempDir(), WorkspaceID: workspaceID, Provider: "pi",
		LastStatus: status, CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if extra != nil {
		extra(&rec)
	}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
}

// A finished agent is what the sidebar badge means by "this wants you"; without the flag a
// completed long task looks identical to one that never started.
func TestMarkAttentionOnFinishedAgent(t *testing.T) {
	srv := attentionServer(t)
	putAgent(t, srv, "a1", "w1", "idle", nil)

	if !srv.markAgentAttention("a1", AttentionReasonFinished, "2026-01-02T00:00:00Z") {
		t.Fatal("a finished agent should be markable")
	}
	rec, _ := srv.store.GetAgent("a1")
	if !rec.RequiresAttention || rec.AttentionReason == nil || *rec.AttentionReason != AttentionReasonFinished {
		t.Fatalf("attention not recorded: %+v", rec)
	}
	if rec.AttentionTimestamp == nil || *rec.AttentionTimestamp != "2026-01-02T00:00:00Z" {
		t.Fatalf("timestamp: %v", rec.AttentionTimestamp)
	}
}

// Marking a running agent is meaningless, and re-marking an already-unread one would move the
// timestamp forward and re-notify about nothing.
func TestMarkAttentionPreconditions(t *testing.T) {
	srv := attentionServer(t)
	putAgent(t, srv, "running", "w1", "running", nil)
	if srv.markAgentAttention("running", AttentionReasonFinished, "") {
		t.Fatal("a running agent must not be marked finished")
	}

	putAgent(t, srv, "archived", "w1", "idle", func(r *store.AgentRecord) {
		a := "2026-01-01T00:00:00Z"
		r.ArchivedAt = &a
	})
	if srv.markAgentAttention("archived", AttentionReasonFinished, "") {
		t.Fatal("an archived agent must not be marked")
	}

	putAgent(t, srv, "done", "w1", "idle", nil)
	if !srv.markAgentAttention("done", AttentionReasonFinished, "2026-01-02T00:00:00Z") {
		t.Fatal("first mark should succeed")
	}
	if srv.markAgentAttention("done", AttentionReasonFinished, "2026-01-03T00:00:00Z") {
		t.Fatal("second mark must be a no-op so the timestamp does not jump")
	}
	rec, _ := srv.store.GetAgent("done")
	if rec.AttentionTimestamp == nil || *rec.AttentionTimestamp != "2026-01-02T00:00:00Z" {
		t.Fatalf("timestamp moved: %v", rec.AttentionTimestamp)
	}
}

// Clearing must actually remove the flag; a no-op clear leaves the badge forever.
func TestClearAgentAttention(t *testing.T) {
	srv := attentionServer(t)
	putAgent(t, srv, "a1", "w1", "idle", nil)
	srv.markAgentAttention("a1", AttentionReasonFinished, "")
	if !srv.clearAgentAttention("a1") {
		t.Fatal("clear should report a change")
	}
	rec, _ := srv.store.GetAgent("a1")
	if rec.RequiresAttention || rec.AttentionReason != nil || rec.AttentionTimestamp != nil {
		t.Fatalf("attention not cleared: %+v", rec)
	}
	if srv.clearAgentAttention("a1") {
		t.Fatal("clearing a clean agent must report no change")
	}
}

// A workspace can hold several agents; the mark applies to the most recently active finished one.
func TestFirstMarkableAgentPicksMostRecent(t *testing.T) {
	srv := attentionServer(t)
	putAgent(t, srv, "older", "w1", "idle", func(r *store.AgentRecord) {
		r.LastActivityAt = "2026-01-01T00:00:00Z"
	})
	putAgent(t, srv, "newer", "w1", "idle", func(r *store.AgentRecord) {
		r.LastActivityAt = "2026-01-05T00:00:00Z"
	})
	putAgent(t, srv, "other-ws", "w2", "idle", nil)

	rec, ok := srv.firstMarkableAgent("w1")
	if !ok || rec.ID != "newer" {
		t.Fatalf("expected newer, got %+v ok=%v", rec.ID, ok)
	}
}

// canMarkUnread mirrors the node precondition list.
func TestCanMarkUnread(t *testing.T) {
	srv := attentionServer(t)
	putAgent(t, srv, "ok", "w1", "idle", nil)
	rec, _ := srv.store.GetAgent("ok")
	if !srv.canMarkUnread(*rec) {
		t.Fatal("a finished, unread, unarchived agent should be markable")
	}

	putAgent(t, srv, "closed", "w1", "closed", nil)
	rec, _ = srv.store.GetAgent("closed")
	if !srv.canMarkUnread(*rec) {
		t.Fatal("a closed agent counts as finished")
	}

	putAgent(t, srv, "internal", "w1", "idle", func(r *store.AgentRecord) { r.Internal = true })
	rec, _ = srv.store.GetAgent("internal")
	if srv.canMarkUnread(*rec) {
		t.Fatal("internal agents must never be markable")
	}
}
