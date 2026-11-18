package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// The documented worktree contract (byspace-json.md "Worktree environment") promises setup,
// teardown, scripts, and services all receive BYSPACE_SOURCE_CHECKOUT_PATH / BYSPACE_WORKTREE_PATH
// / BYSPACE_BRANCH_NAME. Go used to inject none of them, so the canonical `cp
// "$BYSPACE_SOURCE_CHECKOUT_PATH/.env" .env` setup example silently copied from "/.env".
func TestSetupInjectsWorktreeIdentityEnv(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	source := t.TempDir()
	ws := store.WorkspaceRecord{
		WorkspaceID: "ws_env", Cwd: dir, DisplayName: "w", Kind: "worktree",
		MainRepoRoot: &source,
		CreatedAt:    "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertWorkspace(ws); err != nil {
		t.Fatal(err)
	}

	out := filepath.Join(dir, "env.txt")
	command := `printf '%s\n%s\n%s' "$BYSPACE_SOURCE_CHECKOUT_PATH" "$BYSPACE_WORKTREE_PATH" "$BYSPACE_BRANCH_NAME" > '` + out + `'`
	srv.runWorkspaceSetup("ws_env", dir, "feature-x", []string{command})

	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("setup did not run the command: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 3 {
		t.Fatalf("env output = %q", data)
	}
	if lines[0] != source {
		t.Fatalf("BYSPACE_SOURCE_CHECKOUT_PATH = %q, want %q", lines[0], source)
	}
	if lines[1] != dir {
		t.Fatalf("BYSPACE_WORKTREE_PATH = %q, want %q", lines[1], dir)
	}
	if lines[2] != "feature-x" {
		t.Fatalf("BYSPACE_BRANCH_NAME = %q, want feature-x", lines[2])
	}
}
