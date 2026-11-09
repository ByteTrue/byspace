package pi

import "testing"

// A launched subagent is tracked by the id the tool result carries; the completion that arrives
// later only knows the child session. Without joining on sessionId the descriptor stayed "running"
// forever, which is what a finished subagent looked like in the app.
func TestSubagentExitUpdatesJoinBySession(t *testing.T) {
	launched := []SubagentDescriptor{
		{ID: "sub_1", Provider: "pi", Status: "running", SessionID: "sess_a", Title: strPtr("reviewer"), CreatedAt: "2026-11-09T10:00:00Z"},
		{ID: "sub_2", Provider: "pi", Status: "running", SessionID: "sess_b"},
	}

	updates := SubagentExitUpdates(launched, map[string]any{
		"status":      "succeeded",
		"sessionId":   "sess_a",
		"description": "Review the diff",
		"cwd":         "/repo",
		"sessionFile": "/tmp/sess_a.jsonl",
	})
	if len(updates) != 1 {
		t.Fatalf("updates = %+v", updates)
	}
	got := updates[0]
	if got.ID != "sub_1" || got.Status != "completed" {
		t.Fatalf("update = %+v", got)
	}
	if got.CreatedAt != "2026-11-09T10:00:00Z" {
		t.Fatalf("the launch time must survive the completion: %+v", got)
	}
	if got.Description == nil || *got.Description != "Review the diff" {
		t.Fatalf("description = %v", got.Description)
	}
	if got.SessionFile != "/tmp/sess_a.jsonl" || got.Cwd == nil || *got.Cwd != "/repo" {
		t.Fatalf("update = %+v", got)
	}
}

// A failed child is reported as failed, not left running; an unknown session is ignored rather
// than invented as a new descriptor.
func TestSubagentExitUpdatesStatusesAndUnknownSessions(t *testing.T) {
	launched := []SubagentDescriptor{{ID: "sub_1", Status: "running", SessionID: "sess_a"}}
	updates := SubagentExitUpdates(launched, []any{
		map[string]any{"status": "failed", "sessionId": "sess_a"},
		map[string]any{"status": "succeeded", "sessionId": "sess_unknown"},
	})
	if len(updates) != 1 || updates[0].Status != "failed" {
		t.Fatalf("updates = %+v", updates)
	}
}

func strPtr(value string) *string { return &value }
