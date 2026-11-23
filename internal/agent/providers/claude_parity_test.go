package providers

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func captureClaudeRawEvent(s *ClaudeSession, event map[string]any) []map[string]any {
	var events []map[string]any
	if s.eventSubscribers == nil {
		s.eventSubscribers = make(map[int]func(map[string]any))
	}
	first := true
	s.eventSubscribers[999] = func(event map[string]any) {
		if first {
			first = false
			return
		}
		events = append(events, event)
	}
	s.handleRawEvent(event)
	delete(s.eventSubscribers, 999)
	return events
}

func TestClaudePromptStreamsSubmittedUserMessage(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	sess, err := StartProviderSession(LaunchConfig{
		Provider: "claude", CommandOverride: exe, Cwd: t.TempDir(),
		Env: append(os.Environ(), "BYSPACE_PROVIDER_HELPER=claude-prompt"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	var mu sync.Mutex
	var events []map[string]any
	sess.OnEvent(func(event map[string]any) {
		mu.Lock()
		events = append(events, event)
		mu.Unlock()
	})
	sess.SetNextClientMessageID("client-msg-1")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sess.Prompt(ctx, "hello", nil); err != nil {
		t.Fatal(err)
	}
	if err := sess.WaitForFinish(ctx); err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	defer mu.Unlock()
	userEvents := 0
	for _, event := range events {
		if event["type"] != "byspace_stream_timeline" {
			continue
		}
		item, ok := event["item"].(sdk.TimelineItem)
		if !ok || item.Type != "user_message" {
			continue
		}
		userEvents++
		if item.ClientMessageID != "client-msg-1" || item.Text != "hello" {
			t.Fatalf("submitted user event = %#v", item)
		}
	}
	if userEvents != 1 {
		t.Fatalf("streamed user events = %d, want exactly one; events=%#v", userEvents, events)
	}
}

func TestClaudePartialMessagesReconcileFinalContent(t *testing.T) {
	s := &ClaudeSession{}
	s.handleRawEvent(map[string]any{"type": "stream_event", "event": map[string]any{
		"type": "content_block_start", "index": 0,
		"content_block": map[string]any{"type": "text", "text": ""},
		"message":       map[string]any{"id": "message-1"},
	}})
	s.handleRawEvent(map[string]any{"type": "stream_event", "event": map[string]any{
		"type": "content_block_delta", "index": 0, "message_id": "message-1",
		"delta": map[string]any{"type": "text_delta", "text": "HELLO "},
	}})
	s.handleRawEvent(map[string]any{"type": "stream_event", "event": map[string]any{
		"type": "content_block_start", "index": 1,
		"content_block": map[string]any{"type": "tool_use", "id": "tool-1", "name": "Bash"},
	}})
	s.handleRawEvent(map[string]any{"type": "stream_event", "event": map[string]any{
		"type": "content_block_delta", "index": 1,
		"delta": map[string]any{"type": "input_json_delta", "partial_json": "{\"command\":\"echo "},
	}})
	s.handleRawEvent(map[string]any{"type": "stream_event", "event": map[string]any{
		"type": "content_block_delta", "index": 1,
		"delta": map[string]any{"type": "input_json_delta", "partial_json": "delta\"}"},
	}})
	events := captureClaudeRawEvent(s, map[string]any{"type": "assistant", "message": map[string]any{
		"id": "message-1", "content": []any{
			map[string]any{"type": "text", "text": "HELLO WORLD"},
			map[string]any{"type": "tool_use", "id": "tool-1", "name": "Bash", "input": map[string]any{"command": "echo delta"}},
		},
	}})
	if len(s.timeline) != 2 {
		t.Fatalf("expected one assistant row and one tool row, got %#v", s.timeline)
	}
	if got := s.timeline[0].Item.Text; got != "HELLO WORLD" {
		t.Fatalf("assistant text = %q", got)
	}
	if got := s.toolArgsByID["tool-1"].(map[string]any)["command"]; got != "echo delta" {
		t.Fatalf("tool input = %#v", got)
	}
	var streamed string
	var lastSeq int
	for _, event := range events {
		if event["type"] != "byspace_stream_timeline" {
			continue
		}
		item := event["item"].(sdk.TimelineItem)
		if item.Type == "assistant_message" {
			streamed += item.Text
		}
		seq := event["seq"].(int)
		if seq <= lastSeq {
			t.Fatalf("stream sequence went backwards: %d after %d", seq, lastSeq)
		}
		lastSeq = seq
	}
	if streamed != "HELLO WORLD" {
		t.Fatalf("streamed assistant text was missing or duplicated: %q", streamed)
	}
}

func TestClaudeNativeTasksAndCompaction(t *testing.T) {
	s := &ClaudeSession{subagents: make(map[string]sdk.SubagentDescriptor), toolArgsByID: map[string]any{}}
	s.handleRawEvent(map[string]any{
		"type": "system", "subtype": "task_started", "task_id": "task-1", "tool_use_id": "tool-1",
		"description": "Explore provider behavior", "subagent_type": "general-purpose", "task_type": "local_agent",
		"prompt": "Reply with exactly CLAUDE_CHILD_SENTINEL",
	})
	s.toolArgsByID["tool-1"] = map[string]any{"name": "sentinel_child"}
	progress := captureClaudeRawEvent(s, map[string]any{
		"type": "system", "subtype": "task_progress", "task_id": "task-1",
		"usage": map[string]any{"total_tokens": 12345},
	})
	if len(progress) != 1 || progress[0]["type"] != "byspace_provider_subagents" {
		t.Fatalf("native task progress events = %#v", progress)
	}
	s.handleRawEvent(map[string]any{
		"type": "assistant", "parent_tool_use_id": "tool-1", "message": map[string]any{
			"content": []any{map[string]any{"type": "text", "text": "CLAUDE_CHILD_SENTINEL"}},
		},
	})
	s.handleRawEvent(map[string]any{
		"type": "system", "subtype": "task_updated", "task_id": "task-1",
		"patch": map[string]any{"status": "completed"},
	})
	children := s.ListSubagents("parent")
	if len(children) != 1 || children[0].Status != "completed" || children[0].Title == nil || *children[0].Title != "sentinel_child" || children[0].TotalTokens == nil || *children[0].TotalTokens != 12345 {
		t.Fatalf("native task descriptor = %#v", children)
	}
	childTimeline, err := s.SubagentTimeline("parent", "tool-1")
	if err != nil || len(childTimeline) != 2 || childTimeline[0].Item.Type != "user_message" || childTimeline[1].Item.Text != "CLAUDE_CHILD_SENTINEL" {
		t.Fatalf("native child timeline = %#v, err=%v", childTimeline, err)
	}
	s.activeTurnID = "turn-1"
	s.status = "running"
	events := captureClaudeRawEvent(s, map[string]any{"type": "system", "subtype": "status", "status": "compacting"})
	if len(events) != 1 {
		t.Fatalf("compaction start events = %#v", events)
	}
	events = captureClaudeRawEvent(s, map[string]any{"type": "system", "subtype": "compact_boundary", "compact_metadata": map[string]any{
		"trigger": "manual", "pre_tokens": 14990,
	}})
	item := events[0]["item"].(sdk.TimelineItem)
	if item.Type != "compaction" || item.Status != "completed" || item.Trigger != "manual" || item.PreTokens != 14990 {
		t.Fatalf("compaction boundary = %#v", item)
	}
}

func TestClaudeControlResponseCorrelation(t *testing.T) {
	s := &ClaudeSession{pendingControls: make(map[string]chan claudeControlResult)}
	result := make(chan claudeControlResult, 1)
	s.pendingControls["request-1"] = result
	s.handleRawEvent(map[string]any{"type": "control_response", "response": map[string]any{
		"subtype": "success", "request_id": "request-1", "response": map[string]any{"canRewind": true},
	}})
	select {
	case got := <-result:
		if got.err != nil || got.response["canRewind"] != true {
			t.Fatalf("control result = %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("control response was not correlated")
	}
	if _, exists := s.pendingControls["request-1"]; exists {
		t.Fatal("resolved control remained pending")
	}
}

func TestClaudeAutonomousIdleDoesNotCloseForegroundTurn(t *testing.T) {
	s := &ClaudeSession{activeTurnID: "foreground", status: "running", taskState: nil}
	events := captureClaudeRawEvent(s, map[string]any{"type": "system", "subtype": "session_state_changed", "state": "idle"})
	if len(events) != 0 || s.activeTurnID != "foreground" {
		t.Fatalf("foreground turn was closed by autonomous idle: %#v", events)
	}
	s.activeTurnID = ""
	s.status = "idle"
	events = captureClaudeRawEvent(s, map[string]any{"type": "system", "subtype": "init", "session_id": "session-1"})
	if len(events) == 0 || events[0]["type"] != "turn_start" {
		t.Fatalf("autonomous init did not open a turn: %#v", events)
	}
	events = captureClaudeRawEvent(s, map[string]any{"type": "system", "subtype": "session_state_changed", "state": "idle"})
	foundEnd := false
	for _, event := range events {
		foundEnd = foundEnd || event["type"] == "agent_end"
	}
	if !foundEnd {
		t.Fatalf("autonomous idle did not close its turn: %#v", events)
	}
}

func TestClaudeControlContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := &ClaudeSession{pendingControls: make(map[string]chan claudeControlResult)}
	if _, err := s.control(ctx, "interrupt", nil); err == nil {
		t.Fatal("expected canceled control request")
	}
}
