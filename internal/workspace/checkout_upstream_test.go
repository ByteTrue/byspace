package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

// TestGetCheckoutStatusReportsConfiguredRemoteURL covers a repository that redirects a hosted forge
// to a local mirror: `remote get-url` answers with the mirror path, but everything that names the
// host (the client's pasted-URL matching, forge detection) needs the configured URL.
func TestGetCheckoutStatusReportsConfiguredRemoteURL(t *testing.T) {
	dir := t.TempDir()
	runGitTest(t, dir, "init", "-q", "-b", "main")
	const hosted = "https://github.com/byspace-e2e/local-fixture.git"
	mirror := filepath.Join(t.TempDir(), "mirror.git")
	runGitTest(t, dir, "remote", "add", "origin", hosted)
	runGitTest(t, dir, "config", "url."+mirror+".insteadOf", hosted)
	if got := strings.TrimSpace(gitOutput(t, dir, "remote", "get-url", "origin")); got != mirror {
		t.Fatalf("precondition: get-url = %q, want %q", got, mirror)
	}

	status := GetCheckoutStatus(context.Background(), dir, "req")
	if status.RemoteURL == nil || *status.RemoteURL != hosted {
		t.Fatalf("remoteUrl = %v, want %q", status.RemoteURL, hosted)
	}
}

func gitOutput(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return string(out)
}
