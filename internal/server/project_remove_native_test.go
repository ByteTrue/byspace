package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/coder/websocket"
)

// Removing a project must not be blocked by a provider that cannot archive natively.
//
// project.remove completes every native archive before it touches local records, so a codex
// thread the CLI cannot archive (missing binary, older version, offline) aborted the whole
// removal: the response said accepted:false and the project stayed in the sidebar with no way
// out, since the agent's thread is exactly what failed. The native step is best-effort now.
func TestProjectRemoveSurvivesNativeArchiveFailure(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "0.28.0-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	repo := filepath.Join(tmp, "repo")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	// The archive step spawns the provider CLI, so an unresolvable command is the failure.
	srv.store.SaveDaemonConfig(map[string]any{"providers": map[string]any{
		"codex": map[string]any{"command": []any{"byspace-test-missing-codex"}},
	}})

	project, workspace, err := srv.store.CreateWorkspaceForDirectory(repo, "repo", "")
	if err != nil {
		t.Fatal(err)
	}
	agent := store.AgentRecord{
		ID: "agt_native_archive", Cwd: repo, WorkspaceID: workspace.WorkspaceID, Provider: "codex",
		LastStatus: "idle", Labels: map[string]string{},
		CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
		Persistence: &store.AgentPersistenceHandle{Provider: "codex", NativeHandle: "thread_native"},
	}
	if err := srv.store.UpsertAgent(agent); err != nil {
		t.Fatal(err)
	}

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_project_remove","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")

	frame, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "project.remove.request", "requestId": "remove", "projectId": project.ProjectID,
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, frame); err != nil {
		t.Fatal(err)
	}
	response := readUntilSessionType(t, ctx, ws, "project.remove.response", "")
	if response["accepted"] != true {
		t.Fatalf("project.remove refused: %+v", response)
	}

	projects, err := srv.store.ListProjects()
	if err != nil {
		t.Fatal(err)
	}
	for _, candidate := range projects {
		if candidate.ProjectID == project.ProjectID && candidate.ArchivedAt == nil {
			t.Fatalf("project %s survived the removal", project.ProjectID)
		}
	}
	archived, err := srv.store.GetAgent(agent.ID)
	if err != nil || archived == nil {
		t.Fatalf("agent record missing: %v", err)
	}
	if archived.ArchivedAt == nil {
		t.Fatal("agent was not archived with its workspace")
	}
	_ = workspace
}
