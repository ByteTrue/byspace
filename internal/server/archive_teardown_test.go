package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"errors"

	"github.com/ByteTrue/byspace/internal/agent/providers"
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

	if err := srv.teardownArchivedWorkspace(context.Background(), "ws_1", "2026-02-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}

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
	if err := srv.teardownArchivedWorkspace(context.Background(), "ws_1", "2026-02-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	other, err := srv.store.GetAgent("agt_other")
	if err != nil {
		t.Fatal(err)
	}
	if other.ArchivedAt != nil {
		t.Fatal("an agent in another workspace was archived")
	}
}

type failingNativeArchiveSession struct{ providers.ManagedSession }

func (failingNativeArchiveSession) ArchiveNative(context.Context, bool) error {
	return errors.New("native archive unavailable")
}

type successfulNativeArchiveSession struct{ providers.ManagedSession }

func (successfulNativeArchiveSession) ArchiveNative(context.Context, bool) error { return nil }

func TestWorkspaceArchiveDoesNotMutateLocalRecordsAfterNativeFailure(t *testing.T) {
	srv := &Server{store: store.New(t.TempDir()), agents: make(map[string]*managedPi)}
	dir := t.TempDir()
	if err := srv.store.UpsertAgent(store.AgentRecord{
		ID: "agt_native", Provider: "mock", Cwd: dir, WorkspaceID: "ws_1", LastStatus: "idle",
	}); err != nil {
		t.Fatal(err)
	}
	srv.agents["agt_native"] = &managedPi{
		record:  store.AgentRecord{ID: "agt_native", Provider: "mock", Cwd: dir, WorkspaceID: "ws_1"},
		session: failingNativeArchiveSession{ManagedSession: providers.StartMockSession(providers.MockLaunchOptions{Cwd: dir})},
	}
	err := srv.archiveWorkspaceContents(context.Background(), "ws_1", "2026-02-01T00:00:00Z")
	if err == nil {
		t.Fatal("expected native archive failure")
	}
	rec, getErr := srv.store.GetAgent("agt_native")
	if getErr != nil {
		t.Fatal(getErr)
	}
	if rec.ArchivedAt != nil {
		t.Fatal("local record was archived despite the native failure")
	}
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{WorkspaceID: "ws_1", Cwd: dir}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := srv.archiveWorkspaces(context.Background(), []string{"ws_1"}, "2026-02-01T00:00:00Z"); err == nil {
		t.Fatal("workspace archive hid the native failure")
	}
	workspace, found := srv.workspaceRecord("ws_1")
	if !found || workspace.ArchivedAt != nil {
		t.Fatalf("workspace mutated after native failure: found=%v archivedAt=%v", found, workspace.ArchivedAt)
	}
}

func TestNativeArchiveFailureArchiveTeardown(t *testing.T) {
	setup := func(t *testing.T) *Server {
		srv := &Server{store: store.New(t.TempDir()), agents: make(map[string]*managedPi)}
		if err := srv.store.UpsertProject(store.ProjectRecord{ProjectID: "project-1", RootPath: t.TempDir()}); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			id   string
			fail bool
		}{{"ws_1", false}, {"ws_2", true}} {
			agentID := "agt_" + tc.id
			rec := store.AgentRecord{ID: agentID, Provider: "mock", Cwd: t.TempDir(), WorkspaceID: tc.id, LastStatus: "idle"}
			if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{WorkspaceID: tc.id, ProjectID: "project-1", Cwd: rec.Cwd}); err != nil {
				t.Fatal(err)
			}
			if err := srv.store.UpsertAgent(rec); err != nil {
				t.Fatal(err)
			}
			base := providers.StartMockSession(providers.MockLaunchOptions{Cwd: rec.Cwd})
			var session providers.ManagedSession = successfulNativeArchiveSession{ManagedSession: base}
			if tc.fail {
				session = failingNativeArchiveSession{ManagedSession: base}
			}
			srv.agents[agentID] = &managedPi{record: rec, session: session}
		}
		return srv
	}
	assertUntouched := func(t *testing.T, srv *Server) {
		t.Helper()
		for _, id := range []string{"ws_1", "ws_2"} {
			workspace, found := srv.workspaceRecord(id)
			if !found || workspace.ArchivedAt != nil {
				t.Fatalf("%s mutated after native failure: found=%v archivedAt=%v", id, found, workspace.ArchivedAt)
			}
			agent, err := srv.store.GetAgent("agt_" + id)
			if err != nil || agent.ArchivedAt != nil {
				t.Fatalf("%s agent mutated after native failure: err=%v archivedAt=%v", id, err, agent.ArchivedAt)
			}
		}
	}

	t.Run("workspace batch", func(t *testing.T) {
		srv := setup(t)
		if _, _, _, err := srv.archiveWorkspaces(context.Background(), []string{"ws_1", "ws_2"}, "2026-02-01T00:00:00Z"); err == nil {
			t.Fatal("expected native archive failure")
		}
		assertUntouched(t, srv)
	})

	t.Run("project removal", func(t *testing.T) {
		srv := setup(t)
		sink := &recordingSink{}
		srv.handleProjectRemove(context.Background(), sink, []byte(`{"requestId":"request-1","projectId":"project-1"}`))
		// Removal is best-effort on the native side: a provider that cannot archive must not keep
		// the project in the sidebar, because the agent's own thread is what failed.
		for _, id := range []string{"ws_1", "ws_2"} {
			workspace, found := srv.workspaceRecord(id)
			if !found || workspace.ArchivedAt == nil {
				t.Fatalf("%s survived the removal: found=%v archivedAt=%v", id, found, workspace.ArchivedAt)
			}
			agent, err := srv.store.GetAgent("agt_" + id)
			if err != nil || agent.ArchivedAt == nil {
				t.Fatalf("%s agent survived the removal: err=%v archivedAt=%v", id, err, agent.ArchivedAt)
			}
		}
		projects, err := srv.store.ListProjects()
		if err != nil || len(projects) != 1 || projects[0].ArchivedAt == nil {
			t.Fatalf("project survived the removal: err=%v projects=%#v", err, projects)
		}
	})
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
	run := &workspaceSetupRun{done: make(chan struct{})}
	close(run.done)
	srv.setupRuns = map[string]*workspaceSetupRun{"ws_1": run}
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
	stopping := run.stopping
	srv.setupRunsMu.Unlock()
	if !stopping {
		t.Fatal("the setup run was not marked as stopping")
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
	srv.setupRuns = map[string]*workspaceSetupRun{"ws_1": {done: make(chan struct{})}}
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
