package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

// The setup commands live under worktree.setup. Reading the top-level key finds nothing, and a
// project with a real setup then looks like a project with none.
func TestReadSetupCommandsReadsWorktreeKey(t *testing.T) {
	dir := t.TempDir()
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(dir, "byspace.json"), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	write(`{"worktree":{"setup":"npm ci"}}`)
	if got := ReadSetupCommands(dir); len(got) != 1 || got[0] != "npm ci" {
		t.Fatalf("string form: got %#v", got)
	}

	write(`{"worktree":{"setup":["npm ci","npm run build"]}}`)
	if got := ReadSetupCommands(dir); len(got) != 2 || got[1] != "npm run build" {
		t.Fatalf("array form: got %#v", got)
	}

	write(`{"worktree":{"setup":[{"command":"npm ci"},{"command":"  "}]}}`)
	if got := ReadSetupCommands(dir); len(got) != 1 || got[0] != "npm ci" {
		t.Fatalf("object form: got %#v", got)
	}

	// Object form without `worktree.setup` yields nothing, so callers can tell "no setup".
	write(`{"setup":"npm ci"}`)
	if got := ReadSetupCommands(dir); len(got) != 0 {
		t.Fatalf("top-level setup is not the config key: got %#v", got)
	}
}

func TestReadTeardownCommands(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "byspace.json"), []byte(`{"worktree":{"teardown":["rm -rf dist"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ReadTeardownCommands(dir); len(got) != 1 || got[0] != "rm -rf dist" {
		t.Fatalf("got %#v", got)
	}
}
