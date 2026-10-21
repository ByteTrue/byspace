package store

import (
	"os"
	"path/filepath"
	"testing"
)

// Opening an archived workspace must bring it back, not create a second one. Without this the
// archive entry stays and a duplicate row appears for the same directory every time the user
// opens it.
func TestEnsureWorkspaceForCwdUnarchives(t *testing.T) {
	tmp := t.TempDir()
	store := New(filepath.Join(tmp, "byspace"))
	dir := filepath.Join(tmp, "work")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	_, first, err := store.EnsureWorkspaceForCwd(dir)
	if err != nil {
		t.Fatal(err)
	}

	archived := "2026-01-01T00:00:00Z"
	first.ArchivedAt = &archived
	if err := store.UpsertWorkspace(first); err != nil {
		t.Fatal(err)
	}

	_, second, err := store.EnsureWorkspaceForCwd(dir)
	if err != nil {
		t.Fatal(err)
	}
	if second.WorkspaceID != first.WorkspaceID {
		t.Fatalf("a second workspace was created: %q vs %q", second.WorkspaceID, first.WorkspaceID)
	}
	if second.ArchivedAt != nil {
		t.Fatal("the workspace should be unarchived")
	}

	// Exactly one workspace for this path.
	all, err := store.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, ws := range all {
		if ws.Cwd == dir {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("%d workspaces for one directory", count)
	}
}

// A workspace inside an archived project cannot be reopened without reopening the project: the
// sidebar does not render archived projects, so the workspace would be invisible.
func TestEnsureWorkspaceForCwdUnarchivesProject(t *testing.T) {
	tmp := t.TempDir()
	store := New(filepath.Join(tmp, "byspace"))
	dir := filepath.Join(tmp, "work2")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	prj, ws, err := store.EnsureWorkspaceForCwd(dir)
	if err != nil {
		t.Fatal(err)
	}

	archived := "2026-01-01T00:00:00Z"
	prj.ArchivedAt = &archived
	if err := store.UpsertProject(prj); err != nil {
		t.Fatal(err)
	}
	ws.ArchivedAt = &archived
	if err := store.UpsertWorkspace(ws); err != nil {
		t.Fatal(err)
	}

	gotProject, gotWorkspace, err := store.EnsureWorkspaceForCwd(dir)
	if err != nil {
		t.Fatal(err)
	}
	if gotWorkspace.ArchivedAt != nil {
		t.Fatal("workspace should be unarchived")
	}
	if gotProject.ArchivedAt != nil {
		t.Fatal("the project should be unarchived too, or the workspace is invisible")
	}
}
