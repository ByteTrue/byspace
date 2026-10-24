package store

import (
	"path/filepath"
	"testing"
)

// Every other code path treats WorkspaceID as authoritative, so a legacy record with no owner is
// invisible: it appears in no workspace and History cannot restore it.
func TestBackfillWorkspaceOwnership(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	userHomeDir = func() (string, error) { return home, nil }
	t.Cleanup(func() { userHomeDir = func() (string, error) { return "", nil } })

	store := New(filepath.Join(tmp, "byspace"))

	repo := filepath.Join(tmp, "repo")
	ws := WorkspaceRecord{
		WorkspaceID: "ws_1", ProjectID: "prj_1", Cwd: repo, Kind: "local_checkout",
		DisplayName: "main", CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := store.UpsertWorkspace(ws); err != nil {
		t.Fatal(err)
	}

	// A legacy agent inside the workspace's directory, and one in an unrelated place.
	legacy := AgentRecord{ID: "agt_1", Cwd: filepath.Join(repo, "packages", "app"), Provider: "pi",
		LastStatus: "idle", CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z"}
	stray := AgentRecord{ID: "agt_2", Cwd: filepath.Join(tmp, "elsewhere"), Provider: "pi",
		LastStatus: "idle", CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z"}
	for _, rec := range []AgentRecord{legacy, stray} {
		if err := store.UpsertAgent(rec); err != nil {
			t.Fatal(err)
		}
	}

	if got := store.BackfillWorkspaceOwnership(); got != 1 {
		t.Fatalf("backfilled %d records, want 1", got)
	}

	got, _ := store.GetAgent("agt_1")
	if got.WorkspaceID != "ws_1" {
		t.Fatalf("legacy agent owner = %q", got.WorkspaceID)
	}
	got, _ = store.GetAgent("agt_2")
	if got.WorkspaceID != "" {
		t.Fatalf("an unrelated agent must stay unowned, got %q", got.WorkspaceID)
	}

	// Idempotent: a second run changes nothing.
	if got := store.BackfillWorkspaceOwnership(); got != 0 {
		t.Fatalf("second run backfilled %d", got)
	}
}

// A prefix match without a separator would let /repo/app match /repo/application.
func TestResolveLegacyWorkspaceOwnerPrefixBoundary(t *testing.T) {
	workspaces := []WorkspaceRecord{
		{WorkspaceID: "ws_app", Cwd: "/repo/app", CreatedAt: "2026-01-01T00:00:00Z"},
	}
	if got := resolveLegacyWorkspaceOwner("/repo/application/src", workspaces, false); got != "" {
		t.Fatalf("/repo/app must not own /repo/application, got %q", got)
	}
	if got := resolveLegacyWorkspaceOwner("/repo/app/src", workspaces, false); got != "ws_app" {
		t.Fatalf("a real descendant should resolve, got %q", got)
	}
}

// The deepest enclosing workspace wins, so a nested checkout is not attributed to the repo root.
func TestResolveLegacyWorkspaceOwnerDeepest(t *testing.T) {
	workspaces := []WorkspaceRecord{
		{WorkspaceID: "ws_root", Cwd: "/repo", CreatedAt: "2026-01-01T00:00:00Z"},
		{WorkspaceID: "ws_sub", Cwd: "/repo/packages/app", CreatedAt: "2026-01-02T00:00:00Z"},
	}
	if got := resolveLegacyWorkspaceOwner("/repo/packages/app/src", workspaces, false); got != "ws_sub" {
		t.Fatalf("got %q", got)
	}
	if got := resolveLegacyWorkspaceOwner("/repo/other", workspaces, false); got != "ws_root" {
		t.Fatalf("got %q", got)
	}
}

// The home directory never owns its descendants: every unrelated agent lives somewhere under it.
func TestResolveLegacyWorkspaceOwnerRejectsHome(t *testing.T) {
	userHomeDir = func() (string, error) { return "/Users/someone", nil }
	t.Cleanup(func() { userHomeDir = func() (string, error) { return "", nil } })

	workspaces := []WorkspaceRecord{
		{WorkspaceID: "ws_home", Cwd: "/Users/someone", CreatedAt: "2026-01-01T00:00:00Z"},
	}
	if got := resolveLegacyWorkspaceOwner("/Users/someone/projects/x", workspaces, false); got != "" {
		t.Fatalf("home must not own descendants, got %q", got)
	}
}

// A live record only resolves to a live workspace; an archived record may resolve to an archived
// one so History keeps its ownership.
func TestResolveLegacyWorkspaceOwnerArchived(t *testing.T) {
	archived := "2026-02-01T00:00:00Z"
	workspaces := []WorkspaceRecord{
		{WorkspaceID: "ws_gone", Cwd: "/repo/old", CreatedAt: "2026-01-01T00:00:00Z", ArchivedAt: &archived},
	}
	if got := resolveLegacyWorkspaceOwner("/repo/old/src", workspaces, false); got != "" {
		t.Fatalf("a live agent must not resolve to an archived workspace, got %q", got)
	}
	if got := resolveLegacyWorkspaceOwner("/repo/old/src", workspaces, true); got != "ws_gone" {
		t.Fatalf("an archived agent should resolve, got %q", got)
	}
}
