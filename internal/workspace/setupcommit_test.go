package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// initRepo creates a git repo with one commit containing the given byspace.json body (or none).
func initRepo(t *testing.T, configBody string) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	if configBody != "" {
		if err := os.WriteFile(filepath.Join(dir, "byspace.json"), []byte(configBody), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	run("add", "-A")
	run("commit", "-q", "--allow-empty", "-m", "init")
	return dir
}

// A worktree is created from a COMMIT, so setup commands that exist only in the working tree do not run for it.
func TestHasUncommittedSetupChanges(t *testing.T) {
	ctx := context.Background()

	committed := `{"worktree":{"setup":["npm ci"]}}`
	dir := initRepo(t, committed)
	if HasUncommittedSetupChanges(ctx, dir) {
		t.Fatal("a clean checkout must report no changes")
	}

	// Same list, different spelling: string vs array must not count as a change.
	if err := os.WriteFile(filepath.Join(dir, "byspace.json"),
		[]byte(`{"worktree":{"setup":"npm ci"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if HasUncommittedSetupChanges(ctx, dir) {
		t.Fatal("a different spelling of the same command is not a change")
	}

	// A real change.
	if err := os.WriteFile(filepath.Join(dir, "byspace.json"),
		[]byte(`{"worktree":{"setup":["npm install"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !HasUncommittedSetupChanges(ctx, dir) {
		t.Fatal("a changed setup command must be reported")
	}
}

// Order matters: setup runs sequentially, and swapping two commands changes the result.
func TestHasUncommittedSetupChangesOrder(t *testing.T) {
	ctx := context.Background()
	dir := initRepo(t, `{"worktree":{"setup":["a","b"]}}`)
	if err := os.WriteFile(filepath.Join(dir, "byspace.json"),
		[]byte(`{"worktree":{"setup":["b","a"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !HasUncommittedSetupChanges(ctx, dir) {
		t.Fatal("a reordered list must be reported")
	}
}

// A repo with no commits: the config is uncommitted by definition, so worktrees created from any future commit
// will not see it. That is exactly the situation the warning is for.
func TestHasUncommittedSetupChangesNoHead(t *testing.T) {
	dir := t.TempDir()
	cmd := exec.Command("git", "init", "-q", "-b", "main")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	if err := os.WriteFile(filepath.Join(dir, "byspace.json"),
		[]byte(`{"worktree":{"setup":["npm ci"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !HasUncommittedSetupChanges(context.Background(), dir) {
		t.Fatal("an uncommitted config must be reported, there is nothing else it could apply to")
	}

	// With no config anywhere there is still nothing to say.
	empty := t.TempDir()
	initCmd := exec.Command("git", "init", "-q", "-b", "main")
	initCmd.Dir = empty
	if out, err := initCmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	if HasUncommittedSetupChanges(context.Background(), empty) {
		t.Fatal("no config on disk and none committed is not a change")
	}
}

// A project in a subdirectory: the config path git knows is `<prefix>byspace.json`.
func TestHasUncommittedSetupChangesSubdirectory(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "packages", "app")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(sub, "byspace.json"),
		[]byte(`{"worktree":{"setup":["npm ci"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	run("add", "-A")
	run("commit", "-q", "-m", "init")

	if HasUncommittedSetupChanges(context.Background(), sub) {
		t.Fatal("a clean subdirectory project must report no changes")
	}
}

func TestNormalizeSetupValue(t *testing.T) {
	cases := []struct {
		value any
		want  string
	}{
		{"  npm ci  ", "npm ci"},
		{[]any{"a", " b "}, "a|b"},
		{[]any{map[string]any{"command": "npm ci"}}, "npm ci"},
		{nil, ""},
		{"   ", ""},
	}
	for _, c := range cases {
		got := strings.Join(normalizeSetupValue(c.value), "|")
		if got != c.want {
			t.Fatalf("%v → %q, want %q", c.value, got, c.want)
		}
	}
}
