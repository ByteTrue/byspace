package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenCodeBackgroundTasksUseNativeShellRoster(t *testing.T) {
	var deleted string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("directory") != "/work" {
			t.Errorf("directory = %q", r.URL.Query().Get("directory"))
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /api/shell":
			if deleted != "" {
				_ = json.NewEncoder(w).Encode([]map[string]any{})
				return
			}
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"id": "shell-1", "status": "running", "command": "npm run dev", "metadata": map[string]any{"sessionID": "ses_1", "description": "Dev server"}, "time": map[string]any{"created": 1700000000123}},
				{"id": "other", "status": "running", "command": "other", "metadata": map[string]any{"sessionID": "ses_other"}},
				{"id": "done", "status": "exited", "command": "done", "metadata": map[string]any{"sessionID": "ses_1"}},
			})
		case "DELETE /api/shell/shell-1":
			deleted = r.URL.Path
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	session := &OpenCodeSession{baseURL: server.URL, version: 2, httpClient: server.Client(), sessionID: "ses_1", cwd: "/work"}
	tasks, err := session.ManageBackgroundTerminal(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].ID != "shell-1" || tasks[0].Description == nil || *tasks[0].Description != "Dev server" || !tasks[0].CanStop || tasks[0].StartedAt == nil {
		t.Fatalf("unexpected tasks: %#v", tasks)
	}
	if _, err := session.ManageBackgroundTerminal(context.Background(), "shell-1"); err != nil {
		t.Fatal(err)
	}
	if deleted != "/api/shell/shell-1" {
		t.Fatalf("deleted %q", deleted)
	}
}

func TestOpenCodeBackgroundTasksNeverDeleteAnotherSessionsShell(t *testing.T) {
	deleted := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deleted = true
		}
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "foreign", "status": "running", "metadata": map[string]any{"sessionID": "ses_other"}}})
	}))
	defer server.Close()
	session := &OpenCodeSession{baseURL: server.URL, version: 2, httpClient: server.Client(), sessionID: "ses_1", cwd: "/work"}
	if _, err := session.ManageBackgroundTerminal(context.Background(), "foreign"); err == nil {
		t.Fatal("expected foreign shell stop to fail")
	}
	if deleted {
		t.Fatal("foreign shell received a DELETE request")
	}
}

func TestOpenCodeV1BackgroundTasksAreUnsupported(t *testing.T) {
	session := &OpenCodeSession{version: 1}
	tasks, err := session.ManageBackgroundTerminal(context.Background(), "")
	if err != nil || tasks != nil {
		t.Fatalf("tasks = %#v, err = %v", tasks, err)
	}
}
