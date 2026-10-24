package store

import (
	"os"
	"path/filepath"
	"testing"
)

// A home can lose its workspace registry while agent records survive. Without rebuilding, the
// sidebar is empty and every agent is unreachable even though its history is intact.
func TestRebuildWorkspaceRegistryFromAgents(t *testing.T) {
	home := t.TempDir()
	s := New(home)

	dirA := filepath.Join(home, "work", "a")
	dirB := filepath.Join(home, "work", "b")
	for _, dir := range []string{dirA, dirB} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	gone := filepath.Join(home, "work", "gone")

	put := func(id, cwd, createdAt, updatedAt string, archived bool) {
		rec := AgentRecord{
			ID: id, Cwd: cwd, Provider: "pi", LastStatus: "idle",
			CreatedAt: createdAt, UpdatedAt: updatedAt,
		}
		if archived {
			a := "2026-01-01T00:00:00Z"
			rec.ArchivedAt = &a
		}
		if err := s.UpsertAgent(rec); err != nil {
			t.Fatal(err)
		}
	}
	// Two agents share a directory, one is archived, one points at a missing directory.
	put("a1", dirA, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", false)
	put("a2", dirA, "2026-01-03T00:00:00Z", "2026-01-04T00:00:00Z", false)
	put("b1", dirB, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", false)
	put("arch", dirB, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", true)
	put("missing", gone, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", false)

	created, err := s.RebuildWorkspaceRegistryFromAgents()
	if err != nil {
		t.Fatal(err)
	}
	if created != 2 {
		t.Fatalf("created %d workspaces, want 2 (two directories, missing one skipped)", created)
	}

	list, _ := s.ListWorkspaces()
	byDir := map[string]WorkspaceRecord{}
	for _, ws := range list {
		byDir[filepath.Clean(ws.Cwd)] = ws
	}
	if _, ok := byDir[dirA]; !ok {
		t.Fatalf("directory A missing: %+v", byDir)
	}
	if _, ok := byDir[gone]; ok {
		t.Fatal("a missing directory must not become a workspace")
	}
	// One workspace per directory, not one per agent.
	if len(list) != 2 {
		t.Fatalf("got %d workspaces, want 2", len(list))
	}
}

// An intact registry must not be touched: rebuilding over it would drop user-set titles and
// pins that the registry owns.
func TestRebuildWorkspaceRegistrySkipsWhenPopulated(t *testing.T) {
	home := t.TempDir()
	s := New(home)
	dir := filepath.Join(home, "keep")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.EnsureWorkspaceForCwd(dir); err != nil {
		t.Fatal(err)
	}
	before, _ := s.ListWorkspaces()

	created, err := s.RebuildWorkspaceRegistryFromAgents()
	if err != nil {
		t.Fatal(err)
	}
	if created != 0 {
		t.Fatalf("rebuilt %d workspaces over an intact registry", created)
	}
	after, _ := s.ListWorkspaces()
	if len(after) != len(before) {
		t.Fatalf("count changed: %d -> %d", len(before), len(after))
	}
}
