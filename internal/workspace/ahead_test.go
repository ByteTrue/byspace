package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// "Merged and clean" is not enough: commits made after the PR was opened are not in it, and
// archiving would delete them.
func TestCountAheadOfOrigin(t *testing.T) {
	tmp := t.TempDir()
	repo := filepath.Join(tmp, "repo")
	clone := filepath.Join(tmp, "clone")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	sh := func(dir string, args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	sh(repo, "init", "-q", "-b", "main")
	sh(repo, "config", "user.email", "a@b")
	sh(repo, "config", "user.name", "a")
	if err := os.WriteFile(filepath.Join(repo, "f"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	sh(repo, "add", "f")
	sh(repo, "commit", "-qm", "init")
	sh(tmp, "clone", "-q", repo, clone)
	sh(clone, "config", "user.email", "a@b")
	sh(clone, "config", "user.name", "a")

	count, err := CountAheadOfOrigin(context.Background(), clone)
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("a fresh clone is not ahead: %d", count)
	}

	// One local commit that is not pushed.
	if err := os.WriteFile(filepath.Join(clone, "g"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	sh(clone, "add", "g")
	sh(clone, "commit", "-qm", "local")
	count, err = CountAheadOfOrigin(context.Background(), clone)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("one unpushed commit should report 1, got %d", count)
	}
}
