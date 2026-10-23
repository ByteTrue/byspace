package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// newUpstreamRepo builds a repo whose local main tracks a remote branch, with one unpushed commit on
// top. That is the shape where composing the upstream ref from "origin/" + branch goes wrong.
func newUpstreamRepo(t *testing.T) (dir string, remoteRoot string) {
	t.Helper()
	remoteRoot = t.TempDir()
	bare := filepath.Join(remoteRoot, "origin.git")
	runGitTest(t, remoteRoot, "init", "-q", "--bare", bare)

	dir = t.TempDir()
	runGitTest(t, dir, "init", "-q", "-b", "main", ".")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, dir, "add", "-A")
	runGitTest(t, dir, "commit", "-q", "-m", "one")
	runGitTest(t, dir, "remote", "add", "origin", bare)
	runGitTest(t, dir, "push", "-q", "-u", "origin", "main")

	// A local-only commit: the worktree must not inherit it when the picker is untouched.
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, dir, "add", "-A")
	runGitTest(t, dir, "commit", "-q", "-m", "two")
	return dir, remoteRoot
}

// The new-workspace picker starts from upstreamRef when the user has not picked a ref. When the field
// was missing it fell back to refs/heads/<branch>, so a fresh worktree silently carried the user's
// unpushed commits.
func TestGetCheckoutStatusReportsUpstreamRef(t *testing.T) {
	dir, _ := newUpstreamRepo(t)
	status := GetCheckoutStatus(context.Background(), dir, "req")
	if status.CurrentBranch == nil || *status.CurrentBranch != "main" {
		t.Fatalf("currentBranch = %v, want main", status.CurrentBranch)
	}
	if status.UpstreamRef == nil {
		t.Fatalf("upstreamRef is missing; the picker would fall back to the local ref")
	}
	if got := *status.UpstreamRef; got != "refs/remotes/origin/main" {
		t.Fatalf("upstreamRef = %q, want refs/remotes/origin/main", got)
	}
}

// A branch with no upstream must report null rather than a composed guess.
func TestGetCheckoutStatusOmitsUpstreamRefWithoutUpstream(t *testing.T) {
	dir := newDiffRepo(t)
	runGitTest(t, dir, "checkout", "-q", "-b", "local-only")
	status := GetCheckoutStatus(context.Background(), dir, "req")
	if status.UpstreamRef != nil {
		t.Fatalf("upstreamRef = %q, want nil for a branch with no upstream", *status.UpstreamRef)
	}
}

// A fork's remote is named "upstream", not "origin": composing the ref from "origin/" would name a
// remote that does not exist.
func TestGetCheckoutStatusReportsForkUpstreamRef(t *testing.T) {
	dir, _ := newUpstreamRepo(t)
	upstreamRoot := t.TempDir()
	upstreamBare := filepath.Join(upstreamRoot, "upstream.git")
	runGitTest(t, upstreamRoot, "init", "-q", "--bare", upstreamBare)
	runGitTest(t, dir, "remote", "add", "upstream", upstreamBare)
	runGitTest(t, dir, "push", "-q", "upstream", "main")
	runGitTest(t, dir, "branch", "--set-upstream-to=upstream/main", "main")

	status := GetCheckoutStatus(context.Background(), dir, "req")
	if status.UpstreamRef == nil {
		t.Fatalf("upstreamRef is missing for a fork")
	}
	if got := *status.UpstreamRef; got != "refs/remotes/upstream/main" {
		t.Fatalf("upstreamRef = %q, want refs/remotes/upstream/main", got)
	}
}
