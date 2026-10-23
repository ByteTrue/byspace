package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// seedArchivedWorktree archives a BySpace-owned worktree the way the daemon does, leaving the
// record pointing at a directory that no longer exists.
func seedArchivedWorktree(t *testing.T, srv *Server) (store.WorkspaceRecord, string) {
	t.Helper()
	wtPath := createTestWorktree(t, srv)
	repoRoot := workspace.WorktreeMainRepoRoot(context.Background(), wtPath)
	if repoRoot == "" {
		t.Fatal("worktree is not attached to a repository")
	}
	branch := "feature/x"
	rec := store.WorkspaceRecord{
		WorkspaceID: "ws_restore", ProjectID: "p_restore", Cwd: wtPath, Kind: "worktree",
		DisplayName: "w", Title: ptrString("My worktree"), CreatedAt: "2026-01-01T00:00:00Z",
		Branch: &branch, WorktreeRoot: &wtPath, MainRepoRoot: &repoRoot, IsBySpaceOwnedWorktree: true,
	}
	if err := srv.store.UpsertProject(store.ProjectRecord{
		ProjectID: "p_restore", RootPath: repoRoot, Kind: "git", DisplayName: "repo",
		CreatedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertWorkspace(rec); err != nil {
		t.Fatal(err)
	}
	if message := srv.archiveWorkspaces(context.Background(), []string{rec.WorkspaceID}, "2026-02-01T00:00:00Z"); message != nil {
		t.Fatalf("directory left behind: %s", *message)
	}
	return rec, repoRoot
}

// An archived worktree whose directory was removed is recoverable, and says so with the action
// the client knows. The Go port answered `recreate_directory`, which the client's
// getSupportedRecovery does not recognise, so the recovery button never rendered.
func TestResolveWorkspaceRecoveryReportsRestoreForDeletedWorktree(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	rec, _ := seedArchivedWorktree(t, srv)

	state, refusal := srv.resolveWorkspaceRecovery(rec.WorkspaceID)
	if refusal != nil {
		t.Fatalf("unexpected refusal: %+v", refusal)
	}
	if state["action"] != "restore" || state["kind"] != "recoverable" {
		t.Fatalf("unexpected state: %+v", state)
	}
	// The title wins over the derived display name, matching resolveWorkspaceDisplayName.
	if state["workspaceName"] != "My worktree" {
		t.Fatalf("workspaceName = %v", state["workspaceName"])
	}
	if state["branch"] != "feature/x" {
		t.Fatalf("branch = %v", state["branch"])
	}
}

// A workspace whose directory is still on disk is unarchived, not recreated.
func TestResolveWorkspaceRecoveryReportsUnarchiveForPresentDirectory(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	branch := "main"
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_2", ProjectID: "p_2", Cwd: dir, Kind: "local_checkout",
		DisplayName: "checkout", CreatedAt: "2026-01-01T00:00:00Z",
		Branch: &branch, ArchivedAt: ptrString("2026-02-01T00:00:00Z"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertProject(store.ProjectRecord{
		ProjectID: "p_2", RootPath: dir, Kind: "git", DisplayName: "repo",
		CreatedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	state, refusal := srv.resolveWorkspaceRecovery("ws_2")
	if refusal != nil {
		t.Fatalf("unexpected refusal: %+v", refusal)
	}
	if state["action"] != "unarchive" {
		t.Fatalf("action = %v", state["action"])
	}
}

// A plain checkout whose directory is gone cannot be recreated, and the message says which fact
// is missing so the user can act on it.
func TestResolveWorkspaceRecoveryRefusesMissingNonWorktreeDirectory(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	branch := "main"
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_3", ProjectID: "p_3", Cwd: filepath.Join(t.TempDir(), "gone"),
		Kind: "directory", DisplayName: "gone", CreatedAt: "2026-01-01T00:00:00Z",
		Branch: &branch, ArchivedAt: ptrString("2026-02-01T00:00:00Z"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertProject(store.ProjectRecord{
		ProjectID: "p_3", RootPath: t.TempDir(), Kind: "git", DisplayName: "repo",
		CreatedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	_, refusal := srv.resolveWorkspaceRecovery("ws_3")
	if refusal == nil || refusal.Reason != "workspace_directory_missing" {
		t.Fatalf("refusal = %+v", refusal)
	}
	if refusal.Message != "The archived workspace directory no longer exists and cannot be recreated." {
		t.Fatalf("message = %q", refusal.Message)
	}
}

// Restoring a deleted worktree recreates the checkout at the path the record names and clears the
// archive flag, so the client's stored cwd keeps working.
func TestRestoreWorkspaceRecreatesDeletedWorktree(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	rec, _ := seedArchivedWorktree(t, srv)

	if err := srv.restoreWorkspace(context.Background(), rec.WorkspaceID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !isDirectory(rec.Cwd) {
		t.Fatalf("worktree was not recreated at %s", rec.Cwd)
	}
	restored, ok := srv.workspaceRecord(rec.WorkspaceID)
	if !ok {
		t.Fatal("record disappeared")
	}
	if restored.ArchivedAt != nil {
		t.Fatalf("still archived: %v", *restored.ArchivedAt)
	}
	if restored.Kind != "worktree" || !restored.IsBySpaceOwnedWorktree {
		t.Fatalf("placement not restored: %+v", restored)
	}
}

// A restore whose source repository is gone fails with the message the client shows verbatim,
// and leaves nothing behind.
func TestRestoreWorkspaceFailsWhenSourceRepositoryMissing(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	rec, repoRoot := seedArchivedWorktree(t, srv)

	if err := os.Rename(repoRoot, repoRoot+"-moved"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Rename(repoRoot+"-moved", repoRoot) })

	err := srv.restoreWorkspace(context.Background(), rec.WorkspaceID)
	if err == nil {
		t.Fatal("restore unexpectedly succeeded")
	}
	if err.Error() != "The source repository needed to restore this worktree no longer exists." {
		t.Fatalf("error = %q", err.Error())
	}
	if isDirectory(rec.Cwd) {
		t.Fatal("a failed restore left a directory behind")
	}
}

func ptrString(v string) *string { return &v }
