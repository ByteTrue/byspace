package workspace

import (
	"slices"
	"testing"
)

// gitEnv is the only thing standing between a daemon git call and the user's editor.
//
// An end-to-end merge cannot prove this: git skips the editor when stdin is not a TTY, which is
// exactly why the bug only shows up in a pty (an agent's terminal). Assert the environment.
func TestGitEnvDisablesEveryEditor(t *testing.T) {
	env := gitEnv([]string{"PATH=/bin"})
	for _, want := range []string{"GIT_EDITOR=true", "GIT_SEQUENCE_EDITOR=true", "GIT_MERGE_AUTOEDIT=no", "GIT_TERMINAL_PROMPT=0", "GIT_PAGER=cat"} {
		if !slices.Contains(env, want) {
			t.Fatalf("git env %v is missing %q", env, want)
		}
	}
}
