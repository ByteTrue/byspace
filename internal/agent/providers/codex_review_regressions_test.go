package providers

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestCodexRepeatedNativeUserMessagesRemainDistinct(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	for _, id := range []string{"native-1", "native-2"} {
		s.startCodexItemLocked(map[string]any{"type": "UserMessage", "id": id, "text": "repeat"})
	}
	if len(s.timeline) != 2 || s.timeline[0].Item.MessageID != "native-1" || s.timeline[1].Item.MessageID != "native-2" {
		t.Fatalf("repeated native users collapsed: %+v", s.timeline)
	}
}

func TestCodexNativeUserReconcilesOnlyPendingLocalRow(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.timeline = []sdk.TimelineEntry{{Item: sdk.TimelineItem{Type: "user_message", Text: "repeat", MessageID: "older", ClientMessageID: "older"}}}
	s.pendingUserLocal = false
	s.startCodexItemLocked(map[string]any{"type": "userMessage", "id": "native-older", "text": "repeat"})
	if len(s.timeline) != 2 {
		t.Fatalf("native item reconciled onto an older equal-text row: %+v", s.timeline)
	}
	s.pendingUserLocal = true
	s.pendingUserIndex = 1
	s.pendingUserText = "repeat"
	s.startCodexItemLocked(map[string]any{"type": "userMessage", "id": "native-current", "text": "repeat"})
	if len(s.timeline) != 2 || s.timeline[1].Item.MessageID != "native-current" {
		t.Fatalf("pending local row was not reconciled: %+v", s.timeline)
	}
}

func TestCodexFinalOutputReplacesDivergentOrLongerStream(t *testing.T) {
	for _, test := range []struct{ streamed, final string }{{"wrong", "canonical"}, {"too long", "too"}} {
		var events []map[string]any
		s := newCodexStreamTestSession(&events)
		s.activeTextIdx = s.appendItemLocked(sdk.TimelineItem{Type: "assistant_message", Text: test.streamed, MessageID: "message-1"})
		emitted := s.completeCodexOutputLocked("agentMessage", "message-1", test.final)
		if len(s.timeline) != 1 || s.timeline[0].Item.Text != test.final {
			t.Fatalf("final output = %+v, want %q", s.timeline, test.final)
		}
		replaced := false
		for _, event := range emitted {
			if event["replace"] == true {
				item, _ := event["item"].(sdk.TimelineItem)
				replaced = item.Text == test.final
			}
		}
		if !replaced {
			t.Fatalf("canonical correction was not emitted: %#v", emitted)
		}
	}
}

func TestCodexChildFinalOutputReconcilesDeltaRow(t *testing.T) {
	s := &CodexSession{
		threadID: "root", subagents: map[string]sdk.SubagentDescriptor{"child": {ID: "child"}},
		subagentTimelines: map[string][]sdk.TimelineEntry{}, subagentOutputIdx: map[string]int{},
	}
	for _, delta := range []string{"HELLO ", "WORLD"} {
		if !s.routeCodexSubagentLocked("item/agentMessage/delta", map[string]any{"threadId": "child", "itemId": "message-1", "delta": delta}) {
			t.Fatal("child delta was not routed")
		}
	}
	s.routeCodexSubagentLocked("item/completed", map[string]any{"threadId": "child", "item": map[string]any{
		"type": "AgentMessage", "id": "message-1", "text": "HELLO WORLD",
	}})
	rows := s.subagentTimelines["child"]
	if len(rows) != 1 || rows[0].Item.Text != "HELLO WORLD" || rows[0].Item.MessageID != "message-1" {
		t.Fatalf("child rows = %+v", rows)
	}
}

func TestCodexChildDeltasDoNotMergeDifferentNativeItems(t *testing.T) {
	s := &CodexSession{
		threadID: "root", subagents: map[string]sdk.SubagentDescriptor{"child": {ID: "child"}},
		subagentTimelines: map[string][]sdk.TimelineEntry{}, subagentOutputIdx: map[string]int{},
	}
	for _, itemID := range []string{"message-1", "message-2"} {
		s.routeCodexSubagentLocked("item/agentMessage/delta", map[string]any{"threadId": "child", "itemId": itemID, "delta": itemID})
	}
	rows := s.subagentTimelines["child"]
	if len(rows) != 2 || rows[0].Item.Text != "message-1" || rows[1].Item.Text != "message-2" {
		t.Fatalf("child rows = %+v", rows)
	}
}

func TestCodexCancellationUsesNativeResponseShapes(t *testing.T) {
	if _, ok := codexPermissionCancellationResult(map[string]any{"kind": "plan"}); ok {
		t.Fatal("synthetic plan received a native response")
	}
	mcp, ok := codexPermissionCancellationResult(map[string]any{"name": "mcp_elicitation"})
	if !ok || mcp["action"] != "decline" || mcp["content"] != nil {
		t.Fatalf("MCP cancellation = %+v, %v", mcp, ok)
	}
	if _, present := mcp["_meta"]; !present {
		t.Fatal("MCP cancellation omitted _meta")
	}
	question, _ := codexPermissionCancellationResult(map[string]any{"kind": "question"})
	if _, present := question["answers"]; !present {
		t.Fatalf("question cancellation = %+v", question)
	}
}
