package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// Archiving a conversation must not leave its subagents running: they would keep spending
// tokens and holding provider processes for a conversation the user removed.
func TestCascadeArchiveChildrenArchivesSubtree(t *testing.T) {
	tmp := t.TempDir()
	work := filepath.Join(tmp, "w")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	put := func(id, parent, workspace string) {
		labels := map[string]string{}
		if parent != "" {
			labels[ParentAgentIDLabel] = parent
		}
		rec := store.AgentRecord{
			ID: id, Cwd: work, WorkspaceID: workspace, Provider: "pi",
			LastStatus: "idle", Labels: labels,
			CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
		}
		if err := srv.store.UpsertAgent(rec); err != nil {
			t.Fatal(err)
		}
	}
	put("parent", "", "ws1")
	put("child", "parent", "ws1")
	put("grandchild", "child", "ws1")

	srv.cascadeArchiveChildren("parent")

	for _, id := range []string{"child", "grandchild"} {
		rec, err := srv.store.GetAgent(id)
		if err != nil || rec == nil {
			t.Fatalf("%s missing: %v", id, err)
		}
		if rec.ArchivedAt == nil {
			t.Fatalf("%s was not archived", id)
		}
	}
}

// A child in another workspace, or one the user has open, must be detached rather than
// archived: archiving would delete work the user can still see.
func TestCascadeArchiveChildrenDetachesVisibleOrCrossWorkspace(t *testing.T) {
	tmp := t.TempDir()
	work := filepath.Join(tmp, "w")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	put := func(id, workspace string, extra map[string]string) {
		labels := map[string]string{ParentAgentIDLabel: "parent"}
		for k, v := range extra {
			labels[k] = v
		}
		rec := store.AgentRecord{
			ID: id, Cwd: work, WorkspaceID: workspace, Provider: "pi",
			LastStatus: "idle", Labels: labels,
			CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
		}
		if err := srv.store.UpsertAgent(rec); err != nil {
			t.Fatal(err)
		}
	}
	parent := store.AgentRecord{
		ID: "parent", Cwd: work, WorkspaceID: "ws1", Provider: "pi", LastStatus: "idle",
		CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertAgent(parent); err != nil {
		t.Fatal(err)
	}
	put("cross", "ws2", nil)
	put("opened", "ws1", map[string]string{OpenAgentTabLabelPrefix + "client1": "true"})

	srv.cascadeArchiveChildren("parent")

	for _, id := range []string{"cross", "opened"} {
		rec, _ := srv.store.GetAgent(id)
		if rec == nil {
			t.Fatalf("%s missing", id)
		}
		if rec.ArchivedAt != nil {
			t.Fatalf("%s should have been detached, not archived", id)
		}
		if rec.Labels[ParentAgentIDLabel] != "" {
			t.Fatalf("%s still points at the archived parent", id)
		}
	}
	if rec, _ := srv.store.GetAgent("opened"); rec != nil && rec.Labels[OpenAgentTabLabelPrefix+"client1"] != "" {
		t.Fatal("open-tab marker should be cleared on detach")
	}
}
