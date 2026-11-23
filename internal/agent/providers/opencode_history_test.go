package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenCodeV2NativeHistoryAndSessionListing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/session":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{
				map[string]any{"id": "child", "parentID": "parent", "location": map[string]any{"directory": "/workspace/a"}},
				map[string]any{"id": "archived", "location": map[string]any{"directory": "/workspace/a"}, "time": map[string]any{"archived": "2026-01-01T00:00:00Z"}},
				map[string]any{"id": "ses_new", "title": "Selected session", "location": map[string]any{"directory": "/workspace/a"}, "time": map[string]any{"updated": "2026-01-02T00:00:00Z"}},
			}, "cursor": map[string]any{"next": nil}})
		case "/api/session/ses_new/message":
			_ = json.NewEncoder(w).Encode([]any{
				map[string]any{"id": "user-1", "type": "user", "text": "hello", "time": map[string]any{"created": 1}},
				map[string]any{"id": "assistant-1", "type": "assistant", "content": []any{map[string]any{"type": "text", "text": "hi"}}, "time": map[string]any{"created": 2, "completed": 3}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("OPENCODE_SERVER_URL", server.URL)
	listed, err := ListOpenCodeSessions(context.Background(), LaunchConfig{Provider: "opencode"}, "", "/workspace/a", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ProviderHandleID != "ses_new" || listed[0].Title != "Selected session" {
		t.Fatalf("listed = %#v", listed)
	}
	s := &OpenCodeSession{baseURL: server.URL, version: 2, httpClient: server.Client(), sessionID: "ses_new", cwd: "/workspace/a", partTypes: map[string]string{}, messageRoles: map[string]string{}, materializedText: map[string]string{}, closedParts: map[string]bool{}, toolIndexByID: map[string]int{}, eventSubscribers: map[int]func(map[string]any){}, eventTimelineIndex: -1}
	if err := s.LoadNativeHistory(context.Background()); err != nil {
		t.Fatal(err)
	}
	timeline := s.Timeline()
	if len(timeline) != 2 || timeline[0].Item.Type != "user_message" || timeline[0].Item.Text != "hello" || timeline[1].Item.Type != "assistant_message" || timeline[1].Item.Text != "hi" {
		t.Fatalf("timeline = %#v", timeline)
	}
}

func TestOpenCodeV1HistoryImportsUserAndAssistant(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]any{
			map[string]any{"info": map[string]any{"id": "u1", "sessionID": "s1", "role": "user"}, "parts": []any{map[string]any{"id": "up", "sessionID": "s1", "messageID": "u1", "type": "text", "text": "import only this session"}}},
			map[string]any{"info": map[string]any{"id": "a1", "sessionID": "s1", "role": "assistant", "time": map[string]any{"completed": 1}}, "parts": []any{map[string]any{"id": "ap", "sessionID": "s1", "messageID": "a1", "type": "text", "text": "done", "time": map[string]any{"end": 1}}}},
		})
	}))
	defer server.Close()
	s := &OpenCodeSession{baseURL: server.URL, version: 1, httpClient: server.Client(), sessionID: "s1", partTypes: map[string]string{}, messageRoles: map[string]string{}, materializedText: map[string]string{}, closedParts: map[string]bool{}, toolIndexByID: map[string]int{}, eventSubscribers: map[int]func(map[string]any){}, eventTimelineIndex: -1}
	if err := s.LoadNativeHistory(context.Background()); err != nil {
		t.Fatal(err)
	}
	entries := s.Timeline()
	if len(entries) != 2 || entries[0].Item.Type != "user_message" || entries[1].Item.Text != "done" {
		t.Fatalf("entries = %#v", entries)
	}
}

func TestOpenCodeV2SubagentsUseFlatSessionParentID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/session/child/message" {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{
				"type": "assistant", "agent": "explore", "model": map[string]any{"id": "big-pickle", "variant": "default"},
				"tokens": map[string]any{"input": 1000, "output": 20, "reasoning": 5},
			}}})
			return
		}
		if r.URL.Path != "/api/session" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{
			map[string]any{"id": "child", "parentID": "parent", "title": "Child", "directory": "/workspace"},
			map[string]any{"id": "other", "parentID": "other-parent", "title": "Other"},
		}})
	}))
	defer server.Close()
	s := &OpenCodeSession{baseURL: server.URL, version: 2, httpClient: server.Client(), sessionID: "parent", cwd: "/workspace"}
	subagents := s.ListSubagents("agent")
	if len(subagents) != 1 || subagents[0].ID != "child" || subagents[0].ParentAgentID != "agent" {
		t.Fatalf("subagents = %#v", subagents)
	}
	if subagents[0].Subtitle == nil || *subagents[0].Subtitle != "explore · big-pickle · 1k tok" {
		t.Fatalf("subtitle = %#v", subagents[0].Subtitle)
	}
}
