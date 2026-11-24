package workspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDeleteOwnedWorktreeRetriesTransientDirectoryFailure(t *testing.T) {
	target := filepath.Join(t.TempDir(), "worktree")
	if err := os.Mkdir(target, 0o755); err != nil {
		t.Fatal(err)
	}
	attempts := 0
	err := deleteOwnedWorktree(context.Background(), "", target, func(path string) error {
		attempts++
		if attempts == 1 {
			return errors.New("locked")
		}
		return os.RemoveAll(path)
	}, []time.Duration{0, 0, 0})
	if err != nil {
		t.Fatalf("DeleteOwnedWorktree() error = %v", err)
	}
	if attempts != 2 {
		t.Fatalf("remove attempts = %d, want 2", attempts)
	}
	if !pathAbsent(target) {
		t.Fatal("worktree still exists after a successful retry")
	}
}

func TestDeleteOwnedWorktreeRejectsNoErrorWithResidue(t *testing.T) {
	target := t.TempDir()
	attempts := 0
	err := deleteOwnedWorktree(context.Background(), "", target, func(string) error {
		attempts++
		return nil
	}, []time.Duration{0, 0, 0})
	if err == nil || !strings.Contains(err.Error(), "after 3 attempts") {
		t.Fatalf("DeleteOwnedWorktree() error = %v, want exhausted retries", err)
	}
	if attempts != 3 {
		t.Fatalf("remove attempts = %d, want 3", attempts)
	}
}

func TestDeleteOwnedWorktreePrunesAlreadyAbsentPath(t *testing.T) {
	repo, linked := testLinkedWorktree(t)
	if err := os.RemoveAll(linked); err != nil {
		t.Fatal(err)
	}
	if err := DeleteOwnedWorktree(context.Background(), repo, linked); err != nil {
		t.Fatalf("DeleteOwnedWorktree() error = %v", err)
	}
	assertWorktreePruned(t, repo, linked)
}

func TestDeleteOwnedWorktreePrunesAfterDirectoryFallback(t *testing.T) {
	repo, linked := testLinkedWorktree(t)
	// Without the worktree's .git file, Git cannot remove it normally. Directory removal
	// must still clear the registration from the main repository.
	if err := os.Remove(filepath.Join(linked, ".git")); err != nil {
		t.Fatal(err)
	}
	if err := DeleteOwnedWorktree(context.Background(), repo, linked); err != nil {
		t.Fatalf("DeleteOwnedWorktree() error = %v", err)
	}
	assertWorktreePruned(t, repo, linked)
}

func testLinkedWorktree(t *testing.T) (string, string) {
	t.Helper()
	repo := t.TempDir()
	runGitTest(t, repo, "init", "-q", ".")
	runGitTest(t, repo, "commit", "--allow-empty", "-qm", "init")
	linked := filepath.Join(t.TempDir(), "linked")
	runGitTest(t, repo, "worktree", "add", "-q", "-b", "feature", linked)
	return repo, linked
}

func assertWorktreePruned(t *testing.T, repo, linked string) {
	t.Helper()
	if !pathAbsent(linked) {
		t.Fatalf("worktree %s still exists", linked)
	}
	if list := gitOutput(t, repo, "worktree", "list", "--porcelain"); strings.Contains(list, linked) {
		t.Fatalf("worktree registration remains after prune:\n%s", list)
	}
}
