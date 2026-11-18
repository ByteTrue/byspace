package workspace

import "testing"

func TestWorktreeIdentityEnv(t *testing.T) {
	env := WorktreeIdentityEnv("/repo", "/repo-wt", "feature")
	want := map[string]string{
		"BYSPACE_SOURCE_CHECKOUT_PATH": "/repo",
		"BYSPACE_WORKTREE_PATH":        "/repo-wt",
		"BYSPACE_BRANCH_NAME":          "feature",
	}
	if len(env) != len(want) {
		t.Fatalf("env has %d keys, want %d", len(env), len(want))
	}
	for key, value := range want {
		if env[key] != value {
			t.Fatalf("%s = %q, want %q", key, env[key], value)
		}
	}
}

// A directory workspace has no source checkout or branch; the keys stay present so a command can
// test them uniformly instead of branching on whether the variable exists.
func TestWorktreeIdentityEnvKeepsKeysWhenEmpty(t *testing.T) {
	env := WorktreeIdentityEnv("", "/plain-dir", "")
	for _, key := range []string{"BYSPACE_SOURCE_CHECKOUT_PATH", "BYSPACE_WORKTREE_PATH", "BYSPACE_BRANCH_NAME"} {
		if _, ok := env[key]; !ok {
			t.Fatalf("missing key %s", key)
		}
	}
	if env["BYSPACE_WORKTREE_PATH"] != "/plain-dir" {
		t.Fatalf("worktree path = %q", env["BYSPACE_WORKTREE_PATH"])
	}
}
