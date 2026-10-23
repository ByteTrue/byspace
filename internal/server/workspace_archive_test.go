package server

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// createTestWorktree makes a repository plus a worktree under the server's worktrees base, the
// layout the daemon creates. Returns the worktree path.
func createTestWorktree(t *testing.T, srv *Server) string {
	t.Helper()
	repo := t.TempDir()
	gitInit(t, repo)
	base := srv.worktreesBaseDir()
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "worktree", "add", "-q", "-b", "feature/x", filepath.Join(base, filepath.Base(repo), "feature-x"))
	cmd.Dir = repo
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@e", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@e")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git worktree add: %v\n%s", err, out)
	}
	return filepath.Join(base, filepath.Base(repo), "feature-x")
}

// A BySpace-owned worktree is deleted once its last workspace is archived. The Node daemon derived
// this from the scope plus the records on disk; the Go port only deleted when the client sent
// deleteWorktreeFromDisk, which no client ever does, so worktrees accumulated forever.
func TestArchiveWorkspacesDeletesUnreferencedWorktree(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	wtPath := createTestWorktree(t, srv)
	repoRoot := workspace.WorktreeMainRepoRoot(context.Background(), wtPath)
	if repoRoot == "" {
		t.Fatal("worktree is not attached to a repository")
	}

	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_1", ProjectID: "p", Cwd: wtPath, Kind: "worktree",
		DisplayName: "w", CreatedAt: "2026-01-01T00:00:00Z",
		WorktreeRoot: &wtPath, MainRepoRoot: &repoRoot, IsBySpaceOwnedWorktree: true,
	}); err != nil {
		t.Fatal(err)
	}

	if message := srv.archiveWorkspaces(context.Background(), []string{"ws_1"}, "2026-02-01T00:00:00Z"); message != nil {
		t.Fatalf("directory left behind: %s", *message)
	}
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatalf("worktree still on disk: %v", err)
	}
}

// A second workspace on the same checkout keeps the directory alive. This is the Model B flow the
// sidebar offers, and deleting on the first archive destroys an open working tree.
func TestArchiveWorkspacesKeepsWorktreeWithSiblingWorkspace(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	wtPath := createTestWorktree(t, srv)
	repoRoot := workspace.WorktreeMainRepoRoot(context.Background(), wtPath)
	if repoRoot == "" {
		t.Fatal("worktree is not attached to a repository")
	}

	for _, id := range []string{"ws_1", "ws_2"} {
		if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
			WorkspaceID: id, ProjectID: "p", Cwd: wtPath, Kind: "worktree",
			DisplayName: "w", CreatedAt: "2026-01-01T00:00:00Z",
			WorktreeRoot: &wtPath, MainRepoRoot: &repoRoot, IsBySpaceOwnedWorktree: true,
		}); err != nil {
			t.Fatal(err)
		}
	}

	if message := srv.archiveWorkspaces(context.Background(), []string{"ws_1"}, "2026-02-01T00:00:00Z"); message != nil {
		t.Fatalf("no delete was expected, got: %s", *message)
	}
	if _, err := os.Stat(wtPath); err != nil {
		t.Fatalf("worktree of a live sibling workspace was deleted: %v", err)
	}

	// The last reference is gone now, so the directory is garbage.
	if message := srv.archiveWorkspaces(context.Background(), []string{"ws_2"}, "2026-02-02T00:00:00Z"); message != nil {
		t.Fatalf("directory left behind: %s", *message)
	}
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatalf("worktree still on disk: %v", err)
	}
}

// A checkout the user made by hand is not BySpace's to delete, however it is anchored.
func TestArchiveWorkspacesKeepsForeignCheckout(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	gitInit(t, dir)

	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_1", ProjectID: "p", Cwd: dir, Kind: "local_checkout",
		DisplayName: "w", CreatedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	if message := srv.archiveWorkspaces(context.Background(), []string{"ws_1"}, "2026-02-01T00:00:00Z"); message != nil {
		t.Fatalf("no delete was expected, got: %s", *message)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("user-owned checkout was deleted: %v", err)
	}
}

// worktreeArchiveTargets decides what a byspace_worktree_archive_request covers. scope "worktree"
// takes every workspace on the directory; the default takes exactly one, preferring the record that
// calls itself a worktree.
func TestWorktreeArchiveTargetsScope(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()

	for _, rec := range []store.WorkspaceRecord{
		{WorkspaceID: "ws_dir", Cwd: dir, Kind: "directory", DisplayName: "d", CreatedAt: "2026-01-01T00:00:00Z"},
		{WorkspaceID: "ws_wt", Cwd: dir, Kind: "worktree", DisplayName: "w", CreatedAt: "2026-01-01T00:00:00Z"},
	} {
		if err := srv.store.UpsertWorkspace(rec); err != nil {
			t.Fatal(err)
		}
	}

	one := srv.worktreeArchiveTargets(dir, "", "", "", "")
	if len(one) != 1 || one[0] != "ws_wt" {
		t.Fatalf("default scope = %v, want [ws_wt]", one)
	}
	all := srv.worktreeArchiveTargets(dir, "", "", "", "worktree")
	if len(all) != 2 {
		t.Fatalf("worktree scope = %v, want both records", all)
	}
	named := srv.worktreeArchiveTargets(dir, "", "", "ws_dir", "worktree")
	if len(named) != 1 || named[0] != "ws_dir" {
		t.Fatalf("explicit workspaceId = %v, want [ws_dir]", named)
	}
}
