package server

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// Node's project icon contract: descriptors always carry the revision of the icon the project renders
// with, project.icon.get serves that icon (custom or shipped), and setting an icon re-announces the
// project. The port only ever served custom icons and never recorded a revision, so the sidebar
// showed letter tiles for repositories with a favicon and kept a stale icon after a change.
func TestProjectIconRevisionsAndEffectiveIcon(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "0.20.2-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	repo := filepath.Join(tmp, "repo")
	if err := os.MkdirAll(filepath.Join(repo, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "public", "favicon.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	project, _, err := srv.store.CreateWorkspaceForDirectory(repo, "icons", "")
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_icons","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")
	send := func(message map[string]any) {
		t.Helper()
		frame, _ := json.Marshal(map[string]any{"type": "session", "message": message})
		if err := ws.Write(ctx, websocket.MessageText, frame); err != nil {
			t.Fatal(err)
		}
	}
	getIcon := func(id string) map[string]any {
		t.Helper()
		send(map[string]any{"type": "project.icon.get.request", "requestId": "get_" + id, "projectId": id})
		return readUntilSessionType(t, ctx, ws, "project.icon.get.response", "")
	}

	shipped := getIcon(project.ProjectID)
	if icon, _ := shipped["icon"].(map[string]any); icon == nil || icon["mimeType"] != "image/svg+xml" {
		t.Fatalf("the shipped favicon should be served: %+v", shipped)
	}
	if missing := getIcon("prj_missing"); missing["error"] != "Project not found" {
		t.Fatalf("unknown project: %+v", missing)
	}

	png := make([]byte, 64)
	copy(png, []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})
	binary.BigEndian.PutUint32(png[16:], 32)
	binary.BigEndian.PutUint32(png[20:], 32)
	data := base64.StdEncoding.EncodeToString(png)
	send(map[string]any{
		"type":      "project.icon.set.request",
		"requestId": "set_1",
		"projectId": project.ProjectID,
		"source":    map[string]any{"type": "upload", "data": data},
	})
	if set := readUntilSessionType(t, ctx, ws, "project.icon.set.response", ""); set["accepted"] != true {
		t.Fatalf("set response %+v", set)
	}
	update := readUntilSessionType(t, ctx, ws, "project.update", "")
	descriptor, _ := update["project"].(map[string]any)
	revision, _ := descriptor["projectIconRevision"].(string)
	if !strings.HasPrefix(revision, "custom:") || descriptor["projectCustomIconRevision"] == nil {
		t.Fatalf("the re-announced project should carry the custom revision: %+v", update)
	}
	if custom := getIcon(project.ProjectID); custom["icon"].(map[string]any)["data"] != data {
		t.Fatalf("the custom icon should be served: %+v", custom)
	}

	send(map[string]any{
		"type":      "project.icon.set.request",
		"requestId": "set_bad",
		"projectId": project.ProjectID,
		"source":    map[string]any{"type": "upload", "data": base64.StdEncoding.EncodeToString([]byte("not an image"))},
	})
	if bad := readUntilSessionType(t, ctx, ws, "project.icon.set.response", ""); bad["accepted"] != false || bad["error"] != "Unsupported or invalid icon file" {
		t.Fatalf("invalid bytes should be refused: %+v", bad)
	}

	send(map[string]any{
		"type":      "project.icon.set.request",
		"requestId": "set_auto",
		"projectId": project.ProjectID,
		"source":    map[string]any{"type": "automatic"},
	})
	_ = readUntilSessionType(t, ctx, ws, "project.icon.set.response", "")
	update = readUntilSessionType(t, ctx, ws, "project.update", "")
	descriptor, _ = update["project"].(map[string]any)
	if rev, _ := descriptor["projectIconRevision"].(string); !strings.HasPrefix(rev, "automatic:") || rev == "automatic:none:v1" || descriptor["projectCustomIconRevision"] != nil {
		t.Fatalf("automatic should go back to the shipped icon's revision: %+v", update)
	}

	// Removing the project deletes its custom icon, as in Node.
	send(map[string]any{
		"type":      "project.icon.set.request",
		"requestId": "set_2",
		"projectId": project.ProjectID,
		"source":    map[string]any{"type": "upload", "data": data},
	})
	_ = readUntilSessionType(t, ctx, ws, "project.icon.set.response", "")
	iconsDir := filepath.Join(tmp, "home", "projects", "icons")
	if entries, _ := os.ReadDir(iconsDir); len(entries) != 1 {
		t.Fatalf("expected the stored icon, got %d files", len(entries))
	}
	send(map[string]any{"type": "project.remove.request", "requestId": "remove", "projectId": project.ProjectID})
	_ = readUntilSessionType(t, ctx, ws, "project.remove.response", "")
	if entries, _ := os.ReadDir(iconsDir); len(entries) != 0 {
		t.Fatalf("the removed project's icon is still stored: %d files", len(entries))
	}
}
