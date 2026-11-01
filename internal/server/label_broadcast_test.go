package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A label rename or delete rewrites the label on every workspace that carries it. Node published
// each rewritten workspace; the Go port only advanced the catalog, so every client kept the stale
// chip (and then lost it, once the catalog frame dropped the old name) until it reloaded.
func TestLabelRenameAndDeleteBroadcastTheWorkspaces(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "0.20.2-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	_, workspace, err := srv.store.CreateWorkspaceForDirectory(t.TempDir(), "labelled", "")
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
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_labels","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")

	send := func(message map[string]any) {
		t.Helper()
		frame, _ := json.Marshal(map[string]any{"type": "session", "message": message})
		if err := ws.Write(ctx, websocket.MessageText, frame); err != nil {
			t.Fatal(err)
		}
	}
	labelsInUpdate := func() []string {
		t.Helper()
		update := readUntilSessionType(t, ctx, ws, "workspace_update", "")
		descriptor, _ := update["workspace"].(map[string]any)
		if descriptor["id"] != workspace.WorkspaceID {
			t.Fatalf("update for another workspace: %+v", update)
		}
		var labels []string
		raw, _ := descriptor["labels"].([]any)
		for _, label := range raw {
			labels = append(labels, label.(string))
		}
		return labels
	}

	for _, name := range []string{"Urgent", "Frontend"} {
		send(map[string]any{
			"type":        "workspace.label.assignment.set.request",
			"requestId":   "assign_" + name,
			"workspaceId": workspace.WorkspaceID,
			"label":       map[string]any{"name": name, "color": "red"},
			"assigned":    true,
		})
		_ = labelsInUpdate()
		_ = readUntilSessionType(t, ctx, ws, "workspace.label.assignment.set.response", "")
	}

	send(map[string]any{"type": "workspace.label.update.request", "requestId": "rename", "name": "urgent", "newName": "Blocked"})
	if labels := labelsInUpdate(); !slices.Equal(labels, []string{"Blocked", "Frontend"}) {
		t.Fatalf("rename broadcast %v", labels)
	}
	renamed := readUntilSessionType(t, ctx, ws, "workspace.label.update.response", "")
	if renamed["affectedWorkspaceCount"] != float64(1) {
		t.Fatalf("rename response %+v", renamed)
	}

	// Renaming onto another label is refused with the code the client shows a message for.
	send(map[string]any{"type": "workspace.label.update.request", "requestId": "collide", "name": "Blocked", "newName": "frontend"})
	refused := readUntilSessionType(t, ctx, ws, "rpc_error", "")
	if refused["requestId"] != "collide" || refused["code"] != "label_name_taken" {
		t.Fatalf("collision should be refused with label_name_taken: %+v", refused)
	}

	send(map[string]any{"type": "workspace.label.delete.request", "requestId": "delete", "name": "BLOCKED"})
	if labels := labelsInUpdate(); !slices.Equal(labels, []string{"Frontend"}) {
		t.Fatalf("delete broadcast %v", labels)
	}
	deleted := readUntilSessionType(t, ctx, ws, "workspace.label.delete.response", "")
	if deleted["affectedWorkspaceCount"] != float64(1) {
		t.Fatalf("delete response %+v", deleted)
	}
}
