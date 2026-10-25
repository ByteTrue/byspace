package server

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func gitInit(t *testing.T, dir string) {
	t.Helper()
	cmd := exec.Command("git", "init", "-q", dir)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@e", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@e")
	if err := cmd.Run(); err != nil {
		t.Fatalf("git init: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "f.txt"}, {"commit", "-qm", "init"}} {
		c := exec.Command("git", args...)
		c.Dir = dir
		c.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@e", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@e")
		if err := c.Run(); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
}

// A directory that becomes a repository must stop being classified as a plain directory, and a
// branch switched outside the app must show up in the record.
func TestReconcileWorkspacePlacementPicksUpGitFacts(t *testing.T) {
	dir := t.TempDir()
	rec := store.WorkspaceRecord{
		WorkspaceID: "wks_1", ProjectID: "p", Cwd: dir, Kind: "directory",
		DisplayName: "d", CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}

	// Not a repository yet: nothing to reconcile.
	if _, changed := reconcileWorkspacePlacement(context.Background(), rec); changed {
		t.Fatal("a plain directory has no git facts to change")
	}

	gitInit(t, dir)
	next, changed := reconcileWorkspacePlacement(context.Background(), rec)
	if !changed {
		t.Fatal("making the directory a repository must be recorded")
	}
	if next.Kind != "local_checkout" {
		t.Fatalf("kind = %q, want local_checkout", next.Kind)
	}
	if next.Branch == nil {
		t.Fatal("branch should be recorded once the directory is a repository")
	}

	// Switching branches on disk is picked up on the next reconciliation.
	co := exec.Command("git", "checkout", "-qb", "feature/x")
	co.Dir = dir
	if err := co.Run(); err != nil {
		t.Fatalf("checkout: %v", err)
	}
	after, changed := reconcileWorkspacePlacement(context.Background(), next)
	if !changed {
		t.Fatal("a branch switch outside the app must be reconciled")
	}
	if after.Branch == nil || *after.Branch != "feature/x" {
		t.Fatalf("branch = %v, want feature/x", after.Branch)
	}
}

// An already-correct record must not be rewritten every tick: that would churn updatedAt and
// broadcast a workspace_update for every workspace on every rescan.
func TestReconcileWorkspacePlacementIdempotent(t *testing.T) {
	dir := t.TempDir()
	gitInit(t, dir)
	rec := store.WorkspaceRecord{
		WorkspaceID: "wks_1", ProjectID: "p", Cwd: dir, Kind: "local_checkout",
		DisplayName: "d", CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	first, changed := reconcileWorkspacePlacement(context.Background(), rec)
	if !changed {
		t.Fatal("first pass should fill in branch/worktreeRoot")
	}
	if _, again := reconcileWorkspacePlacement(context.Background(), first); again {
		t.Fatal("a settled record must not report changes")
	}
}
