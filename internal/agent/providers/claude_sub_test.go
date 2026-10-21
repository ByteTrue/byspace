package providers

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// Claude's stream-json marks every message produced inside a subagent with the id of the Task
// call that spawned it. Without routing those, a delegated task looks like the parent agent
// doing unrelated work.
func TestClaudeSubagentMessagesStayOutOfMainTimeline(t *testing.T) {
	sess := &ClaudeSession{
		status:             "running",
		timeline:           nil,
		toolIndexByID:      map[string]int{},
		toolArgsByID:       map[string]any{},
		pendingPermissions: map[string]map[string]any{},
		subagents:          map[string]sdk.SubagentDescriptor{},
		eventSubscribers:   map[int]func(map[string]any){},
	}

	// The parent starts a Task.
	sess.handleRawEvent(map[string]any{
		"type": "assistant",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "tool_use", "id": "task_1", "name": "Task",
				"input": map[string]any{"description": "check the logs", "prompt": "look"}},
		}},
	})
	before := len(sess.Timeline())

	// A message from inside the subagent.
	sess.handleRawEvent(map[string]any{
		"type":               "assistant",
		"parent_tool_use_id": "task_1",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "text", "text": "internal subagent chatter"},
		}},
	})
	if got := len(sess.Timeline()); got != before {
		t.Fatalf("a subagent message added %d items to the main timeline", got-before)
	}

	// But the subagent is recorded as active so the Subagents panel shows progress.
	sess.mu.Lock()
	sub, ok := sess.subagents["task_1"]
	sess.mu.Unlock()
	if !ok {
		t.Fatal("the subagent was not tracked")
	}
	if sub.Status != "running" {
		t.Fatalf("subagent status = %q", sub.Status)
	}

	// A parent message is still added.
	sess.handleRawEvent(map[string]any{
		"type": "assistant",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "text", "text": "parent output"},
		}},
	})
	if got := len(sess.Timeline()); got <= before {
		t.Fatal("a parent message must still reach the timeline")
	}
}

func TestParentToolUseID(t *testing.T) {
	if got := parentToolUseID(map[string]any{"parent_tool_use_id": "x"}); got != "x" {
		t.Fatalf("top-level field: %q", got)
	}
	if got := parentToolUseID(map[string]any{"message": map[string]any{"parent_tool_use_id": "y"}}); got != "y" {
		t.Fatalf("nested field: %q", got)
	}
	if got := parentToolUseID(map[string]any{"parent_tool_use_id": nil}); got != "" {
		t.Fatalf("null should be empty, got %q", got)
	}
	if got := parentToolUseID(map[string]any{}); got != "" {
		t.Fatalf("absent should be empty, got %q", got)
	}
}

// A provider image arrives inline as base64; the conversation renders an image by path, so
// without writing it out the model's image output is received and never displayed.
func TestClaudeImageBlockIsMaterialized(t *testing.T) {
	home := t.TempDir()
	sess := &ClaudeSession{
		status:             "running",
		toolIndexByID:      map[string]int{},
		toolArgsByID:       map[string]any{},
		pendingPermissions: map[string]map[string]any{},
		subagents:          map[string]sdk.SubagentDescriptor{},
		eventSubscribers:   map[int]func(map[string]any){},
		homeDir:            home,
	}

	payload := base64.StdEncoding.EncodeToString([]byte("fake-png-bytes"))
	sess.handleRawEvent(map[string]any{
		"type": "user",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "image", "source": map[string]any{
				"type": "base64", "media_type": "image/png", "data": payload,
			}},
		}},
	})

	timeline := sess.Timeline()
	if len(timeline) != 1 || timeline[0].Item.Type != "assistant_message" {
		t.Fatalf("expected one markdown item, got %+v", timeline)
	}
	text := timeline[0].Item.Text
	if !strings.HasPrefix(text, "![") || !strings.Contains(text, "](") {
		t.Fatalf("not markdown image syntax: %q", text)
	}
	start := strings.Index(text, "](") + 2
	path := text[start : len(text)-1]
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("image was not written to %q: %v", path, err)
	}
	body, _ := os.ReadFile(path)
	if string(body) != "fake-png-bytes" {
		t.Fatalf("bytes differ: %q", body)
	}
}

// A block with no data, or no home directory, must be skipped rather than producing a broken
// image reference.
func TestClaudeImageBlockSkipsUnusable(t *testing.T) {
	sess := &ClaudeSession{
		toolIndexByID:      map[string]int{},
		toolArgsByID:       map[string]any{},
		pendingPermissions: map[string]map[string]any{},
		subagents:          map[string]sdk.SubagentDescriptor{},
		eventSubscribers:   map[int]func(map[string]any){},
	}

	// No data.
	sess.handleRawEvent(map[string]any{
		"type": "user",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "image", "source": map[string]any{"media_type": "image/png"}},
		}},
	})
	if len(sess.Timeline()) != 0 {
		t.Fatal("a data-less image must not produce an item")
	}

	// No home directory.
	sess.handleRawEvent(map[string]any{
		"type": "user",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "image", "source": map[string]any{
				"media_type": "image/png",
				"data":       base64.StdEncoding.EncodeToString([]byte("x")),
			}},
		}},
	})
	if len(sess.Timeline()) != 0 {
		t.Fatal("without a home directory the image must be skipped")
	}
}
