package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A main worktree keeps everything in .git, so both answers are the same directory.
func TestResolveGitDirsForMainWorktree(t *testing.T) {
	dir := t.TempDir()
	runGitTest(t, dir, "init", "-q", ".")
	runGitTest(t, dir, "commit", "--allow-empty", "-qm", "init")

	worktree, common, err := ResolveGitDirs(context.Background(), dir)
	if err != nil {
		t.Fatalf("ResolveGitDirs() error = %v", err)
	}
	want := filepath.Join(dir, ".git")
	if worktree != want || common != want {
		t.Fatalf("ResolveGitDirs() = (%q, %q), want (%q, %q)", worktree, common, want, want)
	}
}

// A linked worktree keeps index and HEAD under .git/worktrees/<name> while refs stay in the
// repository's .git. A watcher that only knew one of them would miss half the metadata.
func TestResolveGitDirsSeparatesLinkedWorktree(t *testing.T) {
	repo := t.TempDir()
	runGitTest(t, repo, "init", "-q", ".")
	runGitTest(t, repo, "commit", "--allow-empty", "-qm", "init")
	linked := filepath.Join(t.TempDir(), "linked")
	runGitTest(t, repo, "worktree", "add", "-q", "-b", "feature", linked)

	worktree, common, err := ResolveGitDirs(context.Background(), linked)
	if err != nil {
		t.Fatalf("ResolveGitDirs() error = %v", err)
	}
	wantCommon := filepath.Join(repo, ".git")
	if common != wantCommon {
		t.Fatalf("common = %q, want %q", common, wantCommon)
	}
	if worktree == common || !strings.HasPrefix(worktree, filepath.Join(wantCommon, "worktrees")) {
		t.Fatalf("worktree = %q, want a directory under %q", worktree, filepath.Join(wantCommon, "worktrees"))
	}
	if _, err := os.Stat(worktree); err != nil {
		t.Fatalf("worktree directory missing: %v", err)
	}
}

func TestResolveGitDirsRejectsPlainDirectory(t *testing.T) {
	if _, _, err := ResolveGitDirs(context.Background(), t.TempDir()); err == nil {
		t.Fatal("ResolveGitDirs() on a directory outside a repository returned no error")
	}
}
