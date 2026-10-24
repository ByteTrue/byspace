package store

import "testing"

// Creating a workspace must not dedupe onto an existing one for the same directory.
//
// Node's workspace.create goes through createWorkspaceForDirectory, which always mints a new
// record; only open_project's findOrCreateWorkspaceForDirectory dedupes. Collapsing the two made
// a second create on one checkout return the first workspace, so the sidebar never grew a row and
// two independent workspaces on one directory became impossible.
func TestCreateWorkspaceForDirectoryAlwaysCreates(t *testing.T) {
	s := New(t.TempDir())
	dir := t.TempDir()

	firstProject, first, err := s.CreateWorkspaceForDirectory(dir, "", "")
	if err != nil {
		t.Fatal(err)
	}
	secondProject, second, err := s.CreateWorkspaceForDirectory(dir, "", "")
	if err != nil {
		t.Fatal(err)
	}

	if first.WorkspaceID == second.WorkspaceID {
		t.Fatalf("second create reused workspace %q", first.WorkspaceID)
	}
	if first.Cwd != second.Cwd {
		t.Fatalf("cwds differ: %q vs %q", first.Cwd, second.Cwd)
	}
	// Both name the same project: a workspace is not a project, and creating a second one must
	// not fork the project registry.
	if first.ProjectID != second.ProjectID {
		t.Fatalf("project forked: %q vs %q", first.ProjectID, second.ProjectID)
	}
	if firstProject.ProjectID != secondProject.ProjectID {
		t.Fatalf("returned project forked: %q vs %q", firstProject.ProjectID, secondProject.ProjectID)
	}

	list, err := s.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("persisted %d workspaces, want 2", len(list))
	}
}

// An explicit title is stored on the new record; a blank one leaves the derived name in place.
func TestCreateWorkspaceForDirectoryAppliesTitle(t *testing.T) {
	s := New(t.TempDir())
	dir := t.TempDir()

	_, titled, err := s.CreateWorkspaceForDirectory(dir, "  named by prompt  ", "")
	if err != nil {
		t.Fatal(err)
	}
	if titled.Title == nil || *titled.Title != "named by prompt" {
		t.Fatalf("title = %v", titled.Title)
	}

	_, untitled, err := s.CreateWorkspaceForDirectory(dir, "   ", "")
	if err != nil {
		t.Fatal(err)
	}
	if untitled.Title != nil {
		t.Fatalf("blank title stored as %q", *untitled.Title)
	}
	if untitled.DisplayName == "" {
		t.Fatal("derived display name is empty")
	}
}

// A named project is reused rather than re-derived from the directory.
func TestCreateWorkspaceForDirectoryHonoursProjectID(t *testing.T) {
	s := New(t.TempDir())
	dir := t.TempDir()

	project, err := s.FindOrCreateProjectForDirectory(dir)
	if err != nil {
		t.Fatal(err)
	}

	got, ws, err := s.CreateWorkspaceForDirectory(dir, "", project.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ProjectID != project.ProjectID || ws.ProjectID != project.ProjectID {
		t.Fatalf("project = %q / %q, want %q", got.ProjectID, ws.ProjectID, project.ProjectID)
	}

	if _, _, err := s.CreateWorkspaceForDirectory(dir, "", "prj_missing"); err == nil {
		t.Fatal("an unknown project id must be rejected")
	}
}
