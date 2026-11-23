package providers

import (
	"errors"
	"testing"
)

type acpCloseTrackingWriter struct{ closed bool }

func (w *acpCloseTrackingWriter) Write(p []byte) (int, error) { return len(p), nil }
func (w *acpCloseTrackingWriter) Close() error {
	w.closed = true
	return nil
}

func TestACPSeparatesAlternatingReplaySpeakers(t *testing.T) {
	var events []map[string]any
	s := newACPUpdateTestSession(&events)
	defer s.frames.Stop()
	for _, update := range []map[string]any{
		{"sessionUpdate": "user_message_chunk", "messageId": "u1", "content": map[string]any{"text": "user A"}},
		{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"text": "assistant A"}},
		{"sessionUpdate": "user_message_chunk", "messageId": "u2", "content": map[string]any{"text": "user B"}},
		{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"text": "assistant B"}},
	} {
		acpUpdate(s, update)
	}
	if len(s.timeline) != 4 {
		t.Fatalf("timeline = %#v", s.timeline)
	}
	for index, expected := range []string{"user A", "assistant A", "user B", "assistant B"} {
		if s.timeline[index].Item.Text != expected {
			t.Fatalf("row %d = %q, want %q", index, s.timeline[index].Item.Text, expected)
		}
	}
}

func TestACPPlanSnapshotsReplaceCurrentPlan(t *testing.T) {
	var events []map[string]any
	s := newACPUpdateTestSession(&events)
	defer s.frames.Stop()
	acpUpdate(s, map[string]any{"sessionUpdate": "plan", "entries": []any{map[string]any{"content": "old", "status": "in_progress"}}})
	acpUpdate(s, map[string]any{"sessionUpdate": "plan", "entries": []any{map[string]any{"content": "new", "status": "completed"}}})
	if len(s.timeline) != 1 || len(s.timeline[0].Item.Items) != 1 || s.timeline[0].Item.Items[0].Text != "new" {
		t.Fatalf("timeline = %#v", s.timeline)
	}
}

func TestACPTerminalToolSnapshotEndsOnce(t *testing.T) {
	var events []map[string]any
	s := newACPUpdateTestSession(&events)
	defer s.frames.Stop()
	update := map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed"}
	acpUpdate(s, update)
	acpUpdate(s, update)
	ends := 0
	for _, event := range events {
		if event["type"] == "tool_execution_end" {
			ends++
		}
	}
	if ends != 1 {
		t.Fatalf("terminal events = %d; events=%#v", ends, events)
	}
}

func TestACPTextAfterStructuralUpdateStartsANewRow(t *testing.T) {
	var events []map[string]any
	s := newACPUpdateTestSession(&events)
	defer s.frames.Stop()
	acpUpdate(s, map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"text": "before"}})
	acpUpdate(s, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "tool-1", "status": "running"})
	acpUpdate(s, map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"text": "after"}})
	if len(s.timeline) != 3 || s.timeline[0].Item.Text != "before" || s.timeline[2].Item.Text != "after" {
		t.Fatalf("timeline = %#v", s.timeline)
	}
}

func TestACPLatePromptCompletionCannotSettleNewTurn(t *testing.T) {
	var events []map[string]any
	s := newACPUpdateTestSession(&events)
	defer s.frames.Stop()
	s.activeTurnID = "turn-2"
	s.status = "running"
	s.finishPromptForID("turn-1", errors.New("late failure"))
	s.cancelPromptForID("turn-1", "late cancellation")
	if s.activeTurnID != "turn-2" || s.status != "running" || s.lastError != "" {
		t.Fatalf("turn=%q status=%q error=%q", s.activeTurnID, s.status, s.lastError)
	}
}

func TestACPCloseStillClosesStdinAfterReadLoopExit(t *testing.T) {
	stdin := &acpCloseTrackingWriter{}
	s := &ACPSession{closed: true, stdin: stdin}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if !stdin.closed {
		t.Fatal("Close skipped process cleanup after the read loop exited")
	}
}
