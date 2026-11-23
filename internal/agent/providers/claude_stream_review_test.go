package providers

import "testing"

func TestClaudeStreamIgnoresSidechainPartials(t *testing.T) {
	s := &ClaudeSession{}
	s.handleRawEvent(map[string]any{
		"type": "stream_event", "parent_tool_use_id": "task-1",
		"event": map[string]any{
			"type": "content_block_delta", "index": 0, "message_id": "child-message",
			"delta": map[string]any{"type": "text_delta", "text": "child partial"},
		},
	})
	if len(s.timeline) != 0 {
		t.Fatalf("sidechain partial leaked into parent timeline: %#v", s.timeline)
	}
}

func TestClaudeStreamSeparatesTextBlocksWithinOneMessage(t *testing.T) {
	s := &ClaudeSession{}
	for _, block := range []struct {
		index int
		text  string
	}{{0, "first "}, {1, "second "}} {
		s.handleRawEvent(map[string]any{"type": "stream_event", "event": map[string]any{
			"type": "content_block_delta", "index": block.index, "message_id": "message-1",
			"delta": map[string]any{"type": "text_delta", "text": block.text},
		}})
	}
	captureClaudeRawEvent(s, map[string]any{"type": "assistant", "message": map[string]any{
		"id": "message-1", "content": []any{
			map[string]any{"type": "text", "text": "first final"},
			map[string]any{"type": "text", "text": "second final"},
		},
	}})
	if len(s.timeline) != 2 {
		t.Fatalf("text blocks collapsed into %d rows: %#v", len(s.timeline), s.timeline)
	}
	if got := s.timeline[0].Item.Text; got != "first final" {
		t.Fatalf("first block = %q", got)
	}
	if got := s.timeline[1].Item.Text; got != "second final" {
		t.Fatalf("second block = %q", got)
	}
}
