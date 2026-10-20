package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreProjectWorkspaceAndAgentRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	st := New(tmp)

	repoDir := filepath.Join(tmp, "my-repo")
	if err := os.MkdirAll(filepath.Join(repoDir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}

	prj, ws, err := st.EnsureWorkspaceForCwd(repoDir)
	if err != nil {
		t.Fatal(err)
	}
	if prj.Kind != "git" || ws.Kind != "local_checkout" {
		t.Fatalf("unexpected kind: prj=%s ws=%s", prj.Kind, ws.Kind)
	}

	// Idempotent second call
	prj2, ws2, err := st.EnsureWorkspaceForCwd(repoDir)
	if err != nil {
		t.Fatal(err)
	}
	if prj2.ProjectID != prj.ProjectID || ws2.WorkspaceID != ws.WorkspaceID {
		t.Fatalf("expected idempotent workspace resolution")
	}

	title := "Test Pi Agent"
	rec := AgentRecord{
		ID:          "agt_1",
		Provider:    "pi",
		Cwd:         repoDir,
		WorkspaceID: ws.WorkspaceID,
		CreatedAt:   "2026-04-20T00:00:00.000Z",
		UpdatedAt:   "2026-04-20T00:00:00.000Z",
		Title:       &title,
		LastStatus:  "idle",
	}
	if err := st.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}

	agents, err := st.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != 1 || agents[0].ID != "agt_1" || agents[0].Provider != "pi" {
		t.Fatalf("unexpected agents list: %+v", agents)
	}

	if got := ProjectDirNameFromCwd("/Users/zijie/workspace/byspace"); got != "Users-zijie-workspace-byspace" {
		t.Fatalf("unexpected sanitized dir: %q", got)
	}
}

// resolve-workspace-id-for-path.ts: exact match wins, otherwise the deepest enclosing
// workspace, and the home directory must never match (it would swallow every path).
func TestResolveWorkspaceIDForPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	s := New(t.TempDir())

	mk := func(id, cwd string) {
		if err := s.UpsertWorkspace(WorkspaceRecord{
			WorkspaceID: id, ProjectID: "p", Cwd: cwd, Kind: "directory",
			DisplayName: id, CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
		}); err != nil {
			t.Fatal(err)
		}
	}
	mk("ws-outer", filepath.Join(home, "work"))
	mk("ws-inner", filepath.Join(home, "work", "repo"))
	mk("ws-home", home)

	if got := s.ResolveWorkspaceIDForPath(filepath.Join(home, "work", "repo")); got != "ws-inner" {
		t.Fatalf("exact match: got %q, want ws-inner", got)
	}
	if got := s.ResolveWorkspaceIDForPath(filepath.Join(home, "work", "repo", "src")); got != "ws-inner" {
		t.Fatalf("deepest enclosing: got %q, want ws-inner", got)
	}
	if got := s.ResolveWorkspaceIDForPath(filepath.Join(home, "work", "other")); got != "ws-outer" {
		t.Fatalf("outer enclosing: got %q, want ws-outer", got)
	}
	if got := s.ResolveWorkspaceIDForPath(filepath.Join(home, "unrelated")); got != "" {
		t.Fatalf("no enclosing workspace: got %q, want empty", got)
	}
	if got := s.ResolveWorkspaceIDForPath(home); got != "ws-home" {
		// An exact match on home is legitimate; the exclusion only applies to prefix matching.
		t.Fatalf("exact home match: got %q, want ws-home", got)
	}
	if got := s.ResolveWorkspaceIDForPath(filepath.Join(home, "elsewhere")); got != "" {
		t.Fatalf("home must not act as a prefix: got %q, want empty", got)
	}
}

// home-workspace.ts re-asserts Home presentation on every boot. A record that lost its label
// stops being recognised, so Chief is no longer pinned and gains a `+` button like an ordinary
// project. Re-badging the existing record also avoids creating a duplicate Home workspace.
func TestEnsureHomeWorkspaceRestoresLostLabel(t *testing.T) {
	s := New(t.TempDir())
	if err := s.EnsureHomeWorkspace("srv_x"); err != nil {
		t.Fatal(err)
	}
	list, _ := s.ListWorkspaces()
	if len(list) != 1 {
		t.Fatalf("expected one workspace, got %d", len(list))
	}
	homeID := list[0].WorkspaceID

	// Simulate a record whose label was dropped.
	stripped := list[0]
	stripped.Labels = nil
	if err := s.UpsertWorkspace(stripped); err != nil {
		t.Fatal(err)
	}

	if err := s.EnsureHomeWorkspace("srv_x"); err != nil {
		t.Fatal(err)
	}
	after, _ := s.ListWorkspaces()
	if len(after) != 1 {
		t.Fatalf("must re-badge the existing record, not create a duplicate: got %d", len(after))
	}
	if after[0].WorkspaceID != homeID {
		t.Fatalf("workspace id changed: %s -> %s", homeID, after[0].WorkspaceID)
	}
	hasLabel := false
	for _, lbl := range after[0].Labels {
		if lbl == HomeWorkspaceLabel {
			hasLabel = true
		}
	}
	if !hasLabel {
		t.Fatalf("label was not restored: %+v", after[0].Labels)
	}
}

// A healthy Home workspace is left alone, and a user-set title survives a boot.
func TestEnsureHomeWorkspacePreservesUserTitle(t *testing.T) {
	s := New(t.TempDir())
	if err := s.EnsureHomeWorkspace("srv_x"); err != nil {
		t.Fatal(err)
	}
	list, _ := s.ListWorkspaces()
	custom := "My Chief"
	rec := list[0]
	rec.Title = &custom
	if err := s.UpsertWorkspace(rec); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureHomeWorkspace("srv_x"); err != nil {
		t.Fatal(err)
	}
	after, _ := s.ListWorkspaces()
	if after[0].Title == nil || *after[0].Title != custom {
		t.Fatalf("user title was overwritten: %v", after[0].Title)
	}
	if len(after) != 1 {
		t.Fatalf("expected one workspace, got %d", len(after))
	}
}
