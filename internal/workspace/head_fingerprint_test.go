package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func runGitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.email=a@b", "-c", "user.name=a"}, args...)...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
}

// The fingerprint moves on every change of what HEAD points at, in a repository and in a worktree,
// and stays put otherwise.
func TestHeadFingerprint(t *testing.T) {
	repo := t.TempDir()
	runGitIn(t, repo, "init", "-q", "-b", "main")
	runGitIn(t, repo, "commit", "-q", "--allow-empty", "-m", "one")
	sub := filepath.Join(repo, "src")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	first := HeadFingerprint(repo)
	if first == "" || HeadFingerprint(sub) != first {
		t.Fatalf("fingerprint %q, from a subdirectory %q", first, HeadFingerprint(sub))
	}
	if again := HeadFingerprint(repo); again != first {
		t.Fatalf("an unchanged checkout moved: %q → %q", first, again)
	}

	runGitIn(t, repo, "commit", "-q", "--allow-empty", "-m", "two")
	committed := HeadFingerprint(repo)
	if committed == first {
		t.Fatal("a commit did not move the fingerprint")
	}
	runGitIn(t, repo, "checkout", "-q", "-b", "feature")
	switched := HeadFingerprint(repo)
	if switched == committed {
		t.Fatal("a branch switch did not move the fingerprint")
	}
	runGitIn(t, repo, "pack-refs", "--all")
	runGitIn(t, repo, "commit", "-q", "--allow-empty", "-m", "three")
	if HeadFingerprint(repo) == switched {
		t.Fatal("a commit after packing refs did not move the fingerprint")
	}
	runGitIn(t, repo, "checkout", "-q", "--detach")
	if detached := HeadFingerprint(repo); detached == "" || detached[:4] == "ref:" {
		t.Fatalf("detached HEAD fingerprint = %q", detached)
	}

	worktree := filepath.Join(t.TempDir(), "wt")
	runGitIn(t, repo, "worktree", "add", "-q", "-b", "wt-branch", worktree)
	before := HeadFingerprint(worktree)
	if before == "" {
		t.Fatal("no fingerprint for a worktree")
	}
	runGitIn(t, worktree, "commit", "-q", "--allow-empty", "-m", "in the worktree")
	if HeadFingerprint(worktree) == before {
		t.Fatal("a commit in a worktree did not move its fingerprint")
	}

	if got := HeadFingerprint(t.TempDir()); got != "" {
		t.Fatalf("a plain directory has fingerprint %q", got)
	}
}
