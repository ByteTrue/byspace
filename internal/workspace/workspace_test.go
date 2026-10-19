package workspace

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileExplorerAndOptimisticWrite(t *testing.T) {
	tmp := t.TempDir()

	// Create directory and file
	if _, err := CreateEntry(tmp, ".", "src", "directory"); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateEntry(tmp, "src", "hello.txt", "file"); err != nil {
		t.Fatal(err)
	}

	res := WriteFile(tmp, "src/hello.txt", "initial content", "", "")
	if res.Status != "written" || res.Revision == "" {
		t.Fatalf("unexpected write result: %+v", res)
	}

	fc, err := ReadFile(tmp, "src/hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	if fc.Content != "initial content" || fc.Kind != "text" {
		t.Fatalf("unexpected read content: %+v", fc)
	}

	// Optimistic lock conflict test
	conflictRes := WriteFile(tmp, "src/hello.txt", "stale update", "", "wrong-rev")
	if conflictRes.Status != "conflict" {
		t.Fatalf("expected conflict on stale revision, got %+v", conflictRes)
	}

	// Path traversal rejection
	if _, err := ReadFile(tmp, "../outside.txt"); err == nil || !strings.Contains(err.Error(), AccessOutsideWorkspaceErr) {
		t.Fatalf("expected path traversal rejection, got %v", err)
	}

	listing, err := ListDirectory(tmp, ".")
	if err != nil || len(listing.Entries) != 1 || listing.Entries[0].Name != "src" {
		t.Fatalf("unexpected root listing: %+v (%v)", listing, err)
	}
}

func TestGitCheckoutStatusAndCommits(t *testing.T) {
	tmp := t.TempDir()
	ctx := context.Background()

	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = tmp
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v (%s)", args, err, string(out))
		}
	}

	run("init", "-b", "main")
	run("config", "user.name", "Tester")
	run("config", "user.email", "tester@example.com")
	WriteFile(tmp, "README.md", "# Test\n", "", "")
	run("add", "README.md")
	run("commit", "-m", "initial commit")

	st := GetCheckoutStatus(ctx, tmp, "req_1")
	if !st.IsGit || st.CurrentBranch == nil || *st.CurrentBranch != "main" {
		t.Fatalf("unexpected git status: %+v", st)
	}
	if st.IsDirty == nil || *st.IsDirty {
		t.Fatalf("expected clean repo, got isDirty=%v", st.IsDirty)
	}

	// Make repo dirty
	WriteFile(tmp, filepath.Base("README.md"), "# Modified\n", "", "")
	st2 := GetCheckoutStatus(ctx, tmp, "req_2")
	if st2.IsDirty == nil || !*st2.IsDirty {
		t.Fatalf("expected dirty repo after modification")
	}

	_, commits, err := ListCommits(ctx, tmp, 10)
	if err != nil || len(commits) != 1 || commits[0].Subject != "initial commit" {
		t.Fatalf("unexpected commits: %+v (%v)", commits, err)
	}

	diffFiles, err := GetWorkingDiff(ctx, tmp)
	if err != nil || len(diffFiles) != 1 || diffFiles[0].Path != "README.md" {
		t.Fatalf("unexpected working diff: %+v (%v)", diffFiles, err)
	}

	if err := DiscardChanges(ctx, tmp); err != nil {
		t.Fatal(err)
	}
	stClean := GetCheckoutStatus(ctx, tmp, "req_3")
	if stClean.IsDirty == nil || *stClean.IsDirty {
		t.Fatalf("expected clean repo after DiscardChanges")
	}

	wtBase := t.TempDir()
	wtPath, branch, err := CreateWorktree(ctx, tmp, wtBase, "feat-go", "main")
	if err != nil {
		t.Fatal(err)
	}
	if branch != "feat-go" || wtPath == "" {
		t.Fatalf("unexpected worktree result: path=%s branch=%s", wtPath, branch)
	}

	wts, err := ListWorktrees(ctx, tmp)
	if err != nil || len(wts) < 2 {
		t.Fatalf("expected at least 2 worktrees, got %+v (%v)", wts, err)
	}
}
