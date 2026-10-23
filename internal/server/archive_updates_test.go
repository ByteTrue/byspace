package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// Archiving a project's last active workspace used to remove the project from the sidebar: the client deleted the
// workspace and, finding the project with no children, dropped it too.
func TestArchiveRemovePayloadCarriesEmptyProject(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	key := "k"
	prj := store.ProjectRecord{ProjectID: "prj_1", RootPath: dir, ProjectKey: &key, DisplayName: "proj"}
	if err := srv.store.UpsertProject(prj); err != nil {
		t.Fatal(err)
	}
	ws := store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: dir, DisplayName: "d", Kind: "directory", ProjectID: "prj_1",
		CreatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertWorkspace(ws); err != nil {
		t.Fatal(err)
	}

	// While the workspace is active the project is not empty, so an unrelated removal must not claim it is.
	if srv.projectHasNoActiveWorkspaces("prj_1") {
		t.Fatal("a project with an active workspace reported empty")
	}

	archivedAt := "2026-01-02T00:00:00Z"
	if _, err := srv.store.ArchiveWorkspace("ws_1", archivedAt); err != nil {
		t.Fatal(err)
	}
	if !srv.projectHasNoActiveWorkspaces("prj_1") {
		t.Fatal("a project whose only workspace is archived reported active")
	}

	payload := srv.archiveRemovePayload("ws_1", "prj_1")
	if payload["kind"] != "remove" || payload["id"] != "ws_1" {
		t.Fatalf("payload = %+v", payload)
	}
	// A `projectId` next to `kind:"remove"` makes the client take its project-removal branch, which deletes the
	// project and every workspace under it — exactly the bug this payload exists to avoid.
	for _, forbidden := range []string{"projectId", "projectRoot", "archivedAt"} {
		if _, has := payload[forbidden]; has {
			t.Fatalf("remove payload must not carry %q: %+v", forbidden, payload)
		}
	}
	empty, ok := payload["emptyProject"].(map[string]any)
	if !ok {
		t.Fatalf("emptyProject missing: %+v", payload)
	}
	if empty["projectId"] != "prj_1" {
		t.Fatalf("emptyProject = %+v", empty)
	}
}

// A project with another active workspace must not be reported empty: claiming it is would keep a stale row.
func TestArchiveRemovePayloadOmitsEmptyProjectWhenSiblingActive(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	dir := t.TempDir()
	key := "k"
	if err := srv.store.UpsertProject(store.ProjectRecord{
		ProjectID: "prj_1", RootPath: dir, ProjectKey: &key, DisplayName: "proj",
	}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"ws_1", "ws_2"} {
		if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
			WorkspaceID: id, Cwd: dir + "/" + id, DisplayName: id, Kind: "directory",
			ProjectID: "prj_1", CreatedAt: "2026-01-01T00:00:00Z",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := srv.store.ArchiveWorkspace("ws_1", "2026-01-02T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	payload := srv.archiveRemovePayload("ws_1", "prj_1")
	if _, has := payload["emptyProject"]; has {
		t.Fatalf("emptyProject claimed while a sibling is active: %+v", payload)
	}
}
