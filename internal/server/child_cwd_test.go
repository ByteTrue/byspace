package server

import (
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// An agent working in a worktree that spawns a helper with cwd "packages/app" means that path inside
// the worktree, not inside the daemon's own directory.
func TestResolveChildCwd(t *testing.T) {
	parent := "/repo/worktrees/feat"

	if got := resolveChildCwd(parent, ""); got != parent {
		t.Fatalf("empty request = %q, want the parent", got)
	}
	if got := resolveChildCwd(parent, "packages/app"); got != filepath.Join(parent, "packages/app") {
		t.Fatalf("relative = %q", got)
	}
	// An absolute path is left alone: filepath.Join would clean away the leading slash.
	if got := resolveChildCwd(parent, "/tmp/scratch"); got != "/tmp/scratch" {
		t.Fatalf("absolute = %q", got)
	}
	// ".." resolves inside the parent rather than escaping to the daemon's cwd.
	if got := resolveChildCwd(parent, "../other"); got != "/repo/worktrees/other" {
		t.Fatalf("parent-relative = %q", got)
	}
}

// An explicit workspace wins over the one inferred from cwd; naming a workspace that does not exist
// is refused rather than silently placed somewhere else.
func TestCreateAgentHonoursExplicitWorkspace(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	other := store.WorkspaceRecord{
		WorkspaceID: "ws_named", Cwd: dir, DisplayName: "named", Kind: "directory",
		CreatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertWorkspace(other); err != nil {
		t.Fatal(err)
	}

	raw := []byte(`{"requestId":"r1","initialPrompt":"hi","workspaceId":"` + other.WorkspaceID +
		`","config":{"provider":"pi"}}`)
	srv.handleCreateAgent(t.Context(), &recordingSink{}, raw)

	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	var created *store.AgentRecord
	for i := range agents {
		if agents[i].Labels[ParentAgentIDLabel] == "" {
			created = &agents[i]
			break
		}
	}
	if created == nil || created.WorkspaceID != other.WorkspaceID {
		t.Fatalf("workspace = %v, want %q", created, other.WorkspaceID)
	}
}
