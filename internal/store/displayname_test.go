package store

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// A checkout shows its branch, because that is how a user tells two checkouts of one repository
// apart; a detached HEAD or a plain directory falls back to the directory name.
func TestDeriveWorkspaceDisplayName(t *testing.T) {
	tmp := t.TempDir()
	repo := filepath.Join(tmp, "my-project")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "f"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "feature-x")
	run("config", "user.email", "a@b")
	run("config", "user.name", "a")
	run("add", "f")
	run("commit", "-qm", "init")

	if got := DeriveWorkspaceDisplayName(repo); got != "feature-x" {
		t.Fatalf("branch should win: %q", got)
	}

	// Detached HEAD: the branch is literally "HEAD", which is not a name.
	run("checkout", "-q", "--detach")
	if got := DeriveWorkspaceDisplayName(repo); got != "my-project" {
		t.Fatalf("detached HEAD should fall back to the directory name: %q", got)
	}
}

func TestDeriveWorkspaceDisplayNameNonGit(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "plain-dir")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := DeriveWorkspaceDisplayName(dir); got != "plain-dir" {
		t.Fatalf("got %q", got)
	}
}
