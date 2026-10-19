package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreProjectWorkspaceAndAgentRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	st := New(tmp)

	repoDir := filepath.Join(tmp, "my-repo")
	if err := os.MkdirAll(filepath.Join(repoDir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}

	prj, ws, err := st.EnsureWorkspaceForCwd(repoDir)
	if err != nil {
		t.Fatal(err)
	}
	if prj.Kind != "git" || ws.Kind != "local_checkout" {
		t.Fatalf("unexpected kind: prj=%s ws=%s", prj.Kind, ws.Kind)
	}

	// Idempotent second call
	prj2, ws2, err := st.EnsureWorkspaceForCwd(repoDir)
	if err != nil {
		t.Fatal(err)
	}
	if prj2.ProjectID != prj.ProjectID || ws2.WorkspaceID != ws.WorkspaceID {
		t.Fatalf("expected idempotent workspace resolution")
	}

	title := "Test Pi Agent"
	rec := AgentRecord{
		ID:          "agt_1",
		Provider:    "pi",
		Cwd:         repoDir,
		WorkspaceID: ws.WorkspaceID,
		CreatedAt:   "2026-04-20T00:00:00.000Z",
		UpdatedAt:   "2026-04-20T00:00:00.000Z",
		Title:       &title,
		LastStatus:  "idle",
	}
	if err := st.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}

	agents, err := st.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != 1 || agents[0].ID != "agt_1" || agents[0].Provider != "pi" {
		t.Fatalf("unexpected agents list: %+v", agents)
	}

	if got := ProjectDirNameFromCwd("/Users/zijie/workspace/byspace"); got != "Users-zijie-workspace-byspace" {
		t.Fatalf("unexpected sanitized dir: %q", got)
	}
}
