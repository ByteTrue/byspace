package server

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// `owner/repo` has no scheme; without the protocol it cannot become a URL, and the shorthand
// used to be passed to git verbatim (which cannot clone it).
func TestNormalizeCloneRepository(t *testing.T) {
	https, err := normalizeCloneRepository("ByteTrue/BySpace", "https")
	if err != nil || https != (cloneRepository{Name: "BySpace", DisplayName: "ByteTrue/BySpace", CloneURL: "https://github.com/ByteTrue/BySpace.git"}) {
		t.Fatalf("https: %+v %v", https, err)
	}
	ssh, err := normalizeCloneRepository("ByteTrue/BySpace.git", "ssh")
	if err != nil || ssh.CloneURL != "git@github.com:ByteTrue/BySpace.git" || ssh.Name != "BySpace" {
		t.Fatalf("ssh: %+v %v", ssh, err)
	}
	// A complete remote is cloned as given, whatever the protocol, and named after its last segment.
	full, err := normalizeCloneRepository("https://gitlab.com/team/sub/repo.git", "ssh")
	if err != nil || full != (cloneRepository{Name: "repo", DisplayName: "team/sub/repo", CloneURL: "https://gitlab.com/team/sub/repo.git"}) {
		t.Fatalf("full url: %+v %v", full, err)
	}
	scp, err := normalizeCloneRepository("git@github.com:cli/cli.git", "")
	if err != nil || scp.Name != "cli" || scp.DisplayName != "cli/cli" {
		t.Fatalf("scp remote: %+v %v", scp, err)
	}
}

// The value becomes a directory name and is interpolated into a URL handed to git, so the
// segments are validated.
func TestNormalizeCloneRepositoryRejectsBadInput(t *testing.T) {
	bad := []struct{ repo, protocol string }{
		{"", "https"},
		{"owner", "https"},
		{"a/b/c", "https"},
		{"ow ner/repo", "https"},
		{"owner/re po", "https"},
		{"owner/repo", ""}, // shorthand without a protocol is ambiguous
		{"https://github.com/owner/re%20po", "https"},
	}
	for _, tc := range bad {
		if _, err := normalizeCloneRepository(tc.repo, tc.protocol); err == nil {
			t.Fatalf("normalizeCloneRepository(%q, %q) should have failed", tc.repo, tc.protocol)
		}
	}
}

// targetDirectory is the parent the user picked: the clone lands in <parent>/<name>, an existing
// checkout is refused, and a failed clone leaves no directory behind. Cloning into the parent itself
// failed for every non-empty directory.
func TestCloneGitHubProjectIntoTheChosenParent(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	tmp := t.TempDir()
	source := filepath.Join(tmp, "source", "hello")
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"init", "-q"},
		{"-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"},
	} {
		if out, err := exec.Command("git", append([]string{"-C", source}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	parent := filepath.Join(tmp, "parent")
	if err := os.MkdirAll(filepath.Join(parent, "unrelated"), 0o755); err != nil {
		t.Fatal(err)
	}
	// The request names a hosted remote (file:// is not a remote Node or the port accepts); git's
	// insteadOf points it at the local repository.
	remote := "https://example.test/owner/hello.git"
	t.Setenv("GIT_CONFIG_COUNT", "2")
	t.Setenv("GIT_CONFIG_KEY_0", "url.file://"+filepath.ToSlash(source)+".insteadOf")
	t.Setenv("GIT_CONFIG_VALUE_0", remote)
	t.Setenv("GIT_CONFIG_KEY_1", "url.file://"+filepath.ToSlash(filepath.Join(tmp, "source", "missing"))+".insteadOf")
	t.Setenv("GIT_CONFIG_VALUE_1", "https://example.test/owner/missing.git")

	repo, checkoutPath, err := cloneGitHubProject(context.Background(), remote, "https", parent)
	if err != nil {
		t.Fatalf("clone: %v", err)
	}
	if repo.Name != "hello" || checkoutPath != filepath.Join(parent, "hello") {
		t.Fatalf("clone landed at %q (%+v)", checkoutPath, repo)
	}
	if _, err := os.Stat(filepath.Join(checkoutPath, ".git")); err != nil {
		t.Fatalf("no checkout at %s: %v", checkoutPath, err)
	}

	if _, _, err := cloneGitHubProject(context.Background(), remote, "https", parent); err == nil ||
		!strings.Contains(err.Error(), "Checkout path already exists") {
		t.Fatalf("a second clone should be refused, got %v", err)
	}

	missing := "https://example.test/owner/missing.git"
	if _, _, err := cloneGitHubProject(context.Background(), missing, "https", parent); err == nil ||
		!strings.Contains(err.Error(), "Git command failed: git clone") {
		t.Fatalf("a failing clone should report git's error, got %v", err)
	}
	entries, _ := os.ReadDir(parent)
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	if strings.Join(names, ",") != "hello,unrelated" {
		t.Fatalf("a failed clone left something behind: %v", names)
	}
}
