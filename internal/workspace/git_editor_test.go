package workspace

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// gitEnv is the only thing standing between a daemon git call and the user's editor. Git skips the
// editor when stdin is not a TTY, so an end-to-end merge test cannot prove this on CI: assert the
// environment instead.
func TestGitEnvDisablesEveryEditor(t *testing.T) {
	env := gitEnv([]string{"PATH=/bin"})
	for _, want := range []string{"GIT_EDITOR=true", "GIT_SEQUENCE_EDITOR=true", "GIT_MERGE_AUTOEDIT=no", "GIT_TERMINAL_PROMPT=0", "GIT_PAGER=cat"} {
		if !slices.Contains(env, want) {
			t.Fatalf("git env %v is missing %q", env, want)
		}
	}
}

// A merge that creates a commit wants a commit message, and git gets it from `core.editor`. On a
// developer's machine that is an interactive GUI (`code --wait`, `vim`), so the merge blocks with a
// window on their screen until the git timeout kills it — a merge from the app that looks hung.
// The daemon has nobody to type into that editor, so it must never start one.
func TestMergeNeverOpensTheEditor(t *testing.T) {
	repo := initRepo(t, "")

	// Any editor invocation fails loudly, so the test proves the editor was never reached.
	runGitTest(t, repo, "config", "core.editor", "false")

	runGitTest(t, repo, "checkout", "-q", "-b", "feature")
	writeFile(t, filepath.Join(repo, "feature.txt"), "feature\n")
	runGitTest(t, repo, "add", "-A")
	runGitTest(t, repo, "commit", "-q", "-m", "feature")

	runGitTest(t, repo, "checkout", "-q", "main")
	writeFile(t, filepath.Join(repo, "main.txt"), "main\n")
	runGitTest(t, repo, "add", "-A")
	runGitTest(t, repo, "commit", "-q", "-m", "main")

	if err := Merge(context.Background(), repo, "feature"); err != nil {
		t.Fatalf("merge tried to open the user's editor: %v", err)
	}
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}
