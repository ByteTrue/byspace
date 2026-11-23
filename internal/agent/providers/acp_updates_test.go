package providers

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func newACPUpdateTestSession(events *[]map[string]any) *ACPSession {
	s := &ACPSession{provider: "generic-acp", activeTextIdx: -1, activeThinkIdx: -1, activeUserTextIdx: -1, activeTurnID: "turn-1", toolIndexByID: map[string]int{}, eventSubscribers: map[int]func(map[string]any){}}
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	s.OnEvent(func(event map[string]any) { *events = append(*events, event) })
	return s
}

func acpUpdate(s *ACPSession, update map[string]any) {
	s.handleNotificationOrRequest("session/update", nil, map[string]any{"params": map[string]any{"update": update}})
}

func TestACPMapsUserPlanConfigAndUsageUpdates(t *testing.T) {
	var events []map[string]any
	s := newACPUpdateTestSession(&events)
	defer s.frames.Stop()
	acpUpdate(s, map[string]any{"sessionUpdate": "user_message_chunk", "messageId": "u1", "content": map[string]any{"text": "from native user"}})
	acpUpdate(s, map[string]any{"sessionUpdate": "plan", "entries": []any{map[string]any{"content": "Inspect", "status": "in_progress"}, map[string]any{"content": "Fix", "status": "pending"}}})
	acpUpdate(s, map[string]any{"sessionUpdate": "config_option_update", "configOptions": []any{
		map[string]any{"category": "model", "currentValue": "native-model"},
		map[string]any{"category": "mode", "currentValue": "native-mode"},
		map[string]any{"category": "thought_level", "currentValue": "high"},
	}})
	acpUpdate(s, map[string]any{"sessionUpdate": "usage_update", "size": float64(100000), "used": float64(2500)})
	if len(s.timeline) != 2 || s.timeline[0].Item.Type != "user_message" || s.timeline[0].Item.Text != "from native user" || s.timeline[1].Item.Type != "todo" || len(s.timeline[1].Item.Items) != 2 {
		t.Fatalf("timeline = %#v", s.timeline)
	}
	if s.model != "native-model" || s.modeID != "native-mode" || s.thinking != "high" || s.lastUsage == nil || *s.lastUsage.ContextWindowUsedTokens != 2500 {
		t.Fatalf("state = model %q mode %q thinking %q usage %#v", s.model, s.modeID, s.thinking, s.lastUsage)
	}
	seen := map[string]bool{}
	for _, event := range events {
		seen[event["type"].(string)] = true
	}
	for _, kind := range []string{"byspace_stream_timeline", "model_changed", "mode_changed", "thinking_option_changed", "usage_updated"} {
		if !seen[kind] {
			t.Errorf("missing %q in %#v", kind, events)
		}
	}
}

func TestACPToolUpdatesPreserveSnapshotsAndTerminalTransitions(t *testing.T) {
	var events []map[string]any
	s := newACPUpdateTestSession(&events)
	defer s.frames.Stop()
	acpUpdate(s, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Edit", "kind": "edit", "status": "pending", "rawInput": map[string]any{"path": "a.go"}, "locations": []any{map[string]any{"path": "a.go", "line": float64(3)}}})
	acpUpdate(s, map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "in_progress", "content": []any{map[string]any{"type": "diff", "path": "a.go"}}})
	if len(s.timeline) != 1 || s.timeline[0].Item.Status != "running" || s.timeline[0].Item.Metadata["rawInput"] == nil || s.timeline[0].Item.Metadata["content"] == nil || s.timeline[0].Item.Metadata["locations"] == nil {
		t.Fatalf("tool snapshot = %#v", s.timeline)
	}
	for _, event := range events {
		if event["type"] == "tool_execution_end" {
			t.Fatal("pending tool emitted terminal execution")
		}
	}
	acpUpdate(s, map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed", "rawOutput": map[string]any{"ok": true}})
	if s.timeline[0].Item.Status != "completed" || s.timeline[0].Item.Metadata["rawInput"] == nil || s.timeline[0].Item.Metadata["content"] == nil {
		t.Fatalf("completed snapshot = %#v", s.timeline[0].Item)
	}
}
