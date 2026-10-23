package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
)

// Archiving used to write ArchivedAt and nothing else, leaving agents spending tokens and terminals
// holding a pty for a workspace the user just archived.
func TestTeardownArchivedWorkspaceArchivesAgents(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()

	ws := store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: dir, DisplayName: "w", Kind: "directory",
		CreatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertWorkspace(ws); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertAgent(store.AgentRecord{
		ID: "agt_1", Provider: "pi", Cwd: dir, WorkspaceID: "ws_1", LastStatus: "idle",
	}); err != nil {
		t.Fatal(err)
	}

	srv.teardownArchivedWorkspace("ws_1", "2026-02-01T00:00:00Z")

	record, err := srv.store.GetAgent("agt_1")
	if err != nil {
		t.Fatal(err)
	}
	if record.ArchivedAt == nil {
		t.Fatal("the agent was left running in an archived workspace")
	}
	// Only this workspace's agents: another one must be untouched.
	if err := srv.store.UpsertAgent(store.AgentRecord{
		ID: "agt_other", Provider: "pi", Cwd: filepath.Join(dir, "x"), WorkspaceID: "ws_2", LastStatus: "idle",
	}); err != nil {
		t.Fatal(err)
	}
	srv.teardownArchivedWorkspace("ws_1", "2026-02-01T00:00:00Z")
	other, err := srv.store.GetAgent("agt_other")
	if err != nil {
		t.Fatal(err)
	}
	if other.ArchivedAt != nil {
		t.Fatal("an agent in another workspace was archived")
	}
}

// A setup run still writing into a worktree outlives the archive unless it is stopped.

// The status must stay inside the wire enum (running/completed/failed/blocked). "stopped" is not
// on the wire, and a client that receives it drops the whole progress message — the setup tab then
// claims it is still running forever.
func TestStopWorkspaceSetupMarksFailed(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	snap := &setupSnapshot{WorkspaceID: "ws_1", Status: "running"}
	srv.mu.Lock()
	srv.setupSnapshots["ws_1"] = snap
	srv.mu.Unlock()

	srv.setupRunsMu.Lock()
	srv.setupRuns = map[string]bool{"ws_1": true}
	srv.setupRunsMu.Unlock()

	srv.stopWorkspaceSetup("ws_1")

	snap.mu.Lock()
	status := snap.Status
	errText := snap.Error
	snap.mu.Unlock()
	if status != "failed" {
		t.Fatalf("status = %q", status)
	}
	if errText == nil || *errText != "workspace archived" {
		t.Fatalf("error = %v", errText)
	}
	srv.setupRunsMu.Lock()
	stillRunning := srv.setupRuns["ws_1"]
	srv.setupRunsMu.Unlock()
	if stillRunning {
		t.Fatal("the setup guard still blocks a future run")
	}
}

// One run per workspace: two concurrent setups race on the same node_modules and lockfiles.
func TestSetupRunsAreDeduplicated(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	ws := store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: dir, DisplayName: "w", Kind: "directory",
		CreatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertWorkspace(ws); err != nil {
		t.Fatal(err)
	}

	// Hold the guard as an in-flight run would, then confirm a second call returns immediately
	// without launching anything.
	srv.setupRunsMu.Lock()
	srv.setupRuns = map[string]bool{"ws_1": true}
	srv.setupRunsMu.Unlock()

	done := make(chan struct{})
	go func() {
		srv.runWorkspaceSetup("ws_1", dir, "main", []string{"touch should-not-exist"})
		close(done)
	}()
	// The guard makes the call return immediately instead of running the command.
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a duplicate setup did not return immediately")
	}
	if _, err := os.Stat(filepath.Join(dir, "should-not-exist")); err == nil {
		t.Fatal("the duplicate run executed its command")
	}
}
