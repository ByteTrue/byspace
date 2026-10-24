package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// diffStatRepo builds a repository with an origin, a main branch, and a feature branch so the
// shortstat has a base to compare against.
func diffStatRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	origin := filepath.Join(dir, "origin.git")
	gitOutput(t, dir, "init", "--bare", "-b", "main", origin)
	repo := filepath.Join(dir, "repo")
	gitOutput(t, dir, "init", "-b", "main", repo)
	gitOutput(t, repo, "config", "user.email", "test@example.com")
	gitOutput(t, repo, "config", "user.name", "Test")
	gitOutput(t, repo, "remote", "add", "origin", origin)
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitOutput(t, repo, "add", ".")
	gitOutput(t, repo, "commit", "-m", "base")
	gitOutput(t, repo, "push", "-u", "origin", "main")
	gitOutput(t, repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	return repo
}

func TestGetCheckoutDiffStatCountsTrackedEdits(t *testing.T) {
	repo := diffStatRepo(t)
	gitOutput(t, repo, "checkout", "-b", "feature")
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("base\none\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitOutput(t, repo, "commit", "-am", "two lines")

	stat := GetCheckoutDiffStat(context.Background(), repo)
	if stat == nil {
		t.Fatal("expected a diff stat for a branch ahead of its base")
	}
	if stat.Additions != 2 || stat.Deletions != 0 {
		t.Fatalf("stat = %+v, want 2 additions and 0 deletions", stat)
	}
}

// The composer pill also has to appear for work that was never committed: a clean-on-paper tree
// with one new file is the most common case, and `git diff --shortstat` does not see it.
func TestGetCheckoutDiffStatCountsUntrackedFiles(t *testing.T) {
	repo := diffStatRepo(t)
	if err := os.WriteFile(filepath.Join(repo, "new.ts"), []byte("export const one = 1;\nexport const two = 2;\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	stat := GetCheckoutDiffStat(context.Background(), repo)
	if stat == nil {
		t.Fatal("expected a diff stat for a checkout with an untracked file")
	}
	if stat.Additions != 2 || stat.Deletions != 0 {
		t.Fatalf("stat = %+v, want 2 additions and 0 deletions", stat)
	}
}

// A file without a trailing newline must not lose its last line to a naive split.
func TestGetCheckoutDiffStatCountsUnterminatedLastLine(t *testing.T) {
	repo := diffStatRepo(t)
	if err := os.WriteFile(filepath.Join(repo, "bare.ts"), []byte("line one\nline two"), 0o644); err != nil {
		t.Fatal(err)
	}

	stat := GetCheckoutDiffStat(context.Background(), repo)
	if stat == nil {
		t.Fatal("expected a diff stat")
	}
	if stat.Additions != 2 {
		t.Fatalf("stat = %+v, want 2 additions", stat)
	}
}

func TestGetCheckoutDiffStatReportsNothingForCleanCheckout(t *testing.T) {
	repo := diffStatRepo(t)
	if stat := GetCheckoutDiffStat(context.Background(), repo); stat != nil {
		t.Fatalf("stat = %+v, want nil for an unchanged checkout", stat)
	}
}

func TestGetCheckoutDiffStatIgnoresNonGitDirectory(t *testing.T) {
	dir := t.TempDir()
	if stat := GetCheckoutDiffStat(context.Background(), dir); stat != nil {
		t.Fatalf("stat = %+v, want nil outside a repository", stat)
	}
}
