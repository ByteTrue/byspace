package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func runGitTest(t *testing.T, cwd string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func newDiffRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGitTest(t, dir, "init", "-q", ".")
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "rename-source.ts"), []byte("export const renamed = true;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, dir, "add", "-A")
	runGitTest(t, dir, "commit", "-q", "-m", "init")
	return dir
}

// A rename is the one case where the patch body says nothing: git emits only the header, so counting
// lines from the body reports a file that changed by zero lines. The client showed that number, and
// without OldPath a revert left the source path deleted.
func TestGetWorkingDiffReportsRenamedFileContents(t *testing.T) {
	dir := newDiffRepo(t)
	runGitTest(t, dir, "mv", "src/rename-source.ts", "src/zz-renamed.ts")

	files, err := GetWorkingDiff(context.Background(), dir)
	if err != nil {
		t.Fatalf("GetWorkingDiff: %v", err)
	}

	var renamed *ParsedDiffFile
	for i := range files {
		if files[i].Path == "src/zz-renamed.ts" {
			renamed = &files[i]
		}
	}
	if renamed == nil {
		t.Fatalf("the renamed file is missing from the diff: %+v", files)
	}
	if renamed.OldPath != "src/rename-source.ts" {
		t.Fatalf("OldPath = %q, want src/rename-source.ts", renamed.OldPath)
	}
	if renamed.Additions != 1 || renamed.Deletions != 0 {
		t.Fatalf("additions/deletions = %d/%d, want 1/0", renamed.Additions, renamed.Deletions)
	}
	if len(renamed.Hunks) == 0 {
		t.Fatal("the renamed file has no hunks, so the diff pane would render an empty body")
	}
}

// Reverting a staged rename has to undo it in the index first; `git checkout -- <path>` restores
// from the index, which still holds the rename, so the old version came back as "nothing happened".
func TestDiscardPathsUndoesStagedRename(t *testing.T) {
	dir := newDiffRepo(t)
	runGitTest(t, dir, "mv", "src/rename-source.ts", "src/zz-renamed.ts")

	if err := DiscardPaths(context.Background(), dir, []string{"src/zz-renamed.ts", "src/rename-source.ts"}); err != nil {
		t.Fatalf("DiscardPaths: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "src", "rename-source.ts")); err != nil {
		t.Fatalf("the source path was not restored: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "src", "zz-renamed.ts")); !os.IsNotExist(err) {
		t.Fatalf("the renamed path still exists: %v", err)
	}
}

// Untracked paths used to be passed to `git checkout`, which fails on a path git has never seen, so
// `clean` never ran and the file survived the revert.
func TestDiscardPathsRemovesUntrackedFile(t *testing.T) {
	dir := newDiffRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "zz-untracked.txt"), []byte("remove me\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := DiscardPaths(context.Background(), dir, []string{"zz-untracked.txt"}); err != nil {
		t.Fatalf("DiscardPaths: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "zz-untracked.txt")); !os.IsNotExist(err) {
		t.Fatalf("the untracked file still exists: %v", err)
	}
}
