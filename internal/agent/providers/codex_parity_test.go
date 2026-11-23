package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestCodexGoalVersionGate(t *testing.T) {
	if !codexVersionAtLeast("codex-cli 0.128.0", 0, 128, 0) || codexVersionAtLeast("codex-cli 0.127.9", 0, 128, 0) || codexVersionAtLeast("unknown", 0, 128, 0) {
		t.Fatal("incorrect Codex goal version gate")
	}
}

func TestCodexNativeQuestionAnswerShape(t *testing.T) {
	pending := map[string]any{"input": map[string]any{"questions": []any{
		map[string]any{"id": "language", "multiSelect": false},
		map[string]any{"id": "features", "multiSelect": true},
	}}}
	response := map[string]any{"updatedInput": map[string]any{"answers": map[string]any{
		"language": "Go", "features": "tests, lint",
	}}}
	answers := codexNativeQuestionAnswers(response, pending)
	if answers["language"].(map[string]any)["answers"].([]string)[0] != "Go" {
		t.Fatalf("answers = %#v", answers)
	}
	features := answers["features"].(map[string]any)["answers"].([]string)
	if len(features) != 2 || features[1] != "lint" {
		t.Fatalf("multi-select answers = %#v", features)
	}
}

func TestCodexPartialOutputCompletesOnlySuffix(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.handleNotificationOrRequest("item/agentMessage/delta", nil, map[string]any{"params": map[string]any{"itemId": "message-1", "delta": "HELLO "}})
	s.handleNotificationOrRequest("item/completed", nil, map[string]any{"params": map[string]any{"item": map[string]any{"id": "message-1", "type": "agentMessage", "text": "HELLO WORLD"}}})
	if len(s.timeline) != 1 || s.timeline[0].Item.Text != "HELLO WORLD" || s.timeline[0].Item.MessageID != "message-1" {
		t.Fatalf("timeline = %#v", s.timeline)
	}
}

func TestCodexNativeItemsReconcilePromptAndFinishAssistantOnce(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.timeline = append(s.timeline, sdk.TimelineEntry{Seq: 1, Item: sdk.TimelineItem{
		Type: "user_message", Text: "hello", MessageID: "client-1", ClientMessageID: "client-1",
	}})
	s.pendingUserLocal = true
	s.pendingUserIndex = 0
	s.pendingUserText = "hello"
	nativeUser := map[string]any{"id": "native-user", "type": "userMessage", "content": []any{
		map[string]any{"type": "text", "text": "hello"},
	}}
	s.handleNotificationOrRequest("item/started", nil, codexItem("item/started", nativeUser))
	s.handleNotificationOrRequest("item/completed", nil, codexItem("item/completed", nativeUser))
	if len(s.timeline) != 1 || s.timeline[0].Item.MessageID != "native-user" || s.timeline[0].Item.ClientMessageID != "client-1" {
		t.Fatalf("reconciled user rows = %#v", s.timeline)
	}
	s.handleNotificationOrRequest("item/agentMessage/delta", nil, map[string]any{"params": map[string]any{"delta": "OK"}})
	s.handleNotificationOrRequest("item/completed", nil, codexItem("item/completed", map[string]any{
		"id": "native-assistant", "type": "agentMessage", "text": "OK",
	}))
	s.handleNotificationOrRequest("turn/completed", nil, map[string]any{"params": map[string]any{
		"turn": map[string]any{"status": "completed"},
	}})
	ends := 0
	for _, event := range events {
		if event["type"] == "message_end" {
			ends++
		}
	}
	if ends != 1 || len(s.timeline) != 2 || s.timeline[1].Item.Text != "OK" {
		t.Fatalf("message_end count=%d timeline=%#v", ends, s.timeline)
	}
}

func TestCodexHistoryCompletionIsIdempotent(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	item := map[string]any{"id": "native-assistant", "type": "agentMessage", "text": "sentinel"}
	s.completeCodexHistoryItem(item)
	s.completeCodexHistoryItem(item)
	if len(s.timeline) != 1 || s.timeline[0].Item.Text != "sentinel" {
		t.Fatalf("history replay duplicated output: %#v", s.timeline)
	}
}

func TestCodexRewindForksBeforeTargetTurn(t *testing.T) {
	reader, writer := io.Pipe()
	s := &CodexSession{
		stdin: writer, pending: map[int64]chan map[string]any{}, threadID: "old-thread",
		turnIDs: []string{"turn-1"}, activeTextIdx: -1, activeThinkIdx: -1,
		timeline: []sdk.TimelineEntry{{Seq: 1, SeqEnd: 1, Item: sdk.TimelineItem{
			Type: "user_message", Text: "first", MessageID: "native-user", ClientMessageID: "client-1",
		}}},
	}
	requests := make(chan map[string]any, 1)
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var request map[string]any
			_ = json.Unmarshal(scanner.Bytes(), &request)
			requests <- request
			id := int64(request["id"].(float64))
			s.mu.Lock()
			ch := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			if ch != nil {
				ch <- map[string]any{"result": map[string]any{"thread": map[string]any{"id": "forked-thread"}}}
			}
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.RewindConversation(ctx, "client-1"); err != nil {
		t.Fatal(err)
	}
	request := <-requests
	params, _ := request["params"].(map[string]any)
	if request["method"] != "thread/fork" || params["beforeTurnId"] != "turn-1" {
		t.Fatalf("rewind request = %#v", request)
	}
	if s.threadID != "forked-thread" || len(s.timeline) != 0 || len(s.turnIDs) != 0 {
		t.Fatalf("rewound state: thread=%q timeline=%#v turns=%#v", s.threadID, s.timeline, s.turnIDs)
	}
}

func TestCodexNativeSubagentRoutesTimeline(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.subagents = map[string]sdk.SubagentDescriptor{}
	s.subagentTimelines = map[string][]sdk.TimelineEntry{}
	s.handleNotificationOrRequest("item/started", nil, map[string]any{"params": map[string]any{"item": map[string]any{
		"id": "spawn-1", "type": "collabAgentToolCall", "tool": "spawnAgent", "receiverThreadIds": []any{"child-1"}, "prompt": "Research",
	}}})
	s.handleNotificationOrRequest("item/agentMessage/delta", nil, map[string]any{"params": map[string]any{"threadId": "child-1", "itemId": "child-message", "delta": "child output"}})
	s.handleNotificationOrRequest("item/started", nil, map[string]any{"params": map[string]any{"item": map[string]any{
		"id": "activity-1", "type": "subAgentActivity", "agentThreadId": "child-1", "agentPath": "/root/sentinel_child", "kind": "started",
	}}})
	s.handleNotificationOrRequest("turn/completed", nil, map[string]any{"params": map[string]any{"threadId": "child-1", "turn": map[string]any{"status": "completed"}}})
	entries, err := s.SubagentTimeline("", "child-1")
	if err != nil || len(entries) != 2 || entries[0].Item.Type != "user_message" || entries[0].Item.Text != "Research" || entries[1].Item.Text != "child output" {
		t.Fatalf("entries=%#v err=%v", entries, err)
	}
	descriptor, _ := s.GetSubagent("parent-1", "child-1")
	if descriptor.Status != "completed" || descriptor.ToolCallID == nil || *descriptor.ToolCallID != "spawn-1" || descriptor.ParentAgentID != "parent-1" || descriptor.Title == nil || *descriptor.Title != "Sentinel child" {
		t.Fatalf("descriptor = %#v", descriptor)
	}
}

func TestCodexPlanItemEmitsAndDismissesSyntheticApproval(t *testing.T) {
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.featureValues = map[string]any{"plan_mode": true}
	s.pendingPermissions = map[string]map[string]any{}
	s.permissionRPCIDs = map[string]any{}
	s.activeTurnID = "turn-1"
	s.completeCodexItemLocked(map[string]any{"id": "plan-1", "type": "Plan", "text": "1. Inspect\n2. Implement"})
	approvalEvents := s.emitCodexPlanApprovalLocked(s.latestPlanText)
	if len(s.pendingPermissions) != 1 || len(approvalEvents) == 0 {
		t.Fatalf("approval events=%#v pending=%#v", approvalEvents, s.pendingPermissions)
	}
	var requestID string
	for id, request := range s.pendingPermissions {
		requestID = id
		if request["kind"] != "plan" || request["name"] != "CodexPlanApproval" {
			t.Fatalf("request = %#v", request)
		}
	}
	if err := s.RespondToPermission(requestID, map[string]any{"behavior": "deny"}); err != nil {
		t.Fatal(err)
	}
	if len(s.pendingPermissions) != 0 {
		t.Fatal("dismissed plan remained pending")
	}
	index := s.toolIndexByID[requestID]
	if s.timeline[index].Item.Status != "completed" || s.timeline[index].Item.Metadata["approved"] != false {
		t.Fatalf("plan outcome = %#v", s.timeline[index].Item)
	}
}

func TestCodexSteerRejectsPendingPlanBeforeNativeSteer(t *testing.T) {
	reader, writer := io.Pipe()
	var events []map[string]any
	s := newCodexStreamTestSession(&events)
	s.stdin = writer
	s.pending = map[int64]chan map[string]any{}
	s.threadID = "thread-1"
	s.nativeTurnID = "native-1"
	s.status = "running"
	s.featureValues = map[string]any{"plan_mode": true}
	s.pendingPermissions = map[string]map[string]any{}
	s.permissionRPCIDs = map[string]any{}
	s.activeTurnID = "turn-1"
	s.completeCodexItemLocked(map[string]any{"id": "plan-1", "type": "Plan", "text": "1. Inspect"})
	s.deliverEvents(nil, s.emitCodexPlanApprovalLocked(s.latestPlanText))
	var requestID string
	for id := range s.pendingPermissions {
		requestID = id
	}
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var request map[string]any
			_ = json.Unmarshal(scanner.Bytes(), &request)
			id := int64(request["id"].(float64))
			s.mu.Lock()
			ch := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			if ch != nil {
				ch <- map[string]any{"result": map[string]any{"turnId": "native-1"}}
			}
		}
	}()
	// The plan resolves while another turn owns the session. Its update must retain turn-1.
	s.activeTurnID = "turn-2"
	if err := s.Steer(context.Background(), "Use another approach", nil); err != nil {
		t.Fatal(err)
	}
	index := s.toolIndexByID[requestID]
	if s.timeline[index].Item.Status != "completed" || s.timeline[index].Item.Metadata["approved"] != false {
		t.Fatalf("plan outcome = %#v", s.timeline[index].Item)
	}
	detail, _ := s.timeline[index].Item.Detail.(map[string]any)
	if detail["type"] != "plan" || detail["text"] != "1. Inspect" {
		t.Fatalf("plan detail = %#v", s.timeline[index].Item.Detail)
	}
	count := 0
	for _, entry := range s.timeline {
		if entry.Item.Name == "plan_approval" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("plan approval rows = %d", count)
	}
	completedUpdate := false
	for _, event := range events {
		if event["type"] != "byspace_stream_timeline" {
			continue
		}
		var callID, status string
		switch item := event["item"].(type) {
		case sdk.TimelineItem:
			callID, status = item.CallID, item.Status
		case map[string]any:
			callID, _ = item["callId"].(string)
			status, _ = item["status"].(string)
		}
		if callID == requestID && status == "completed" {
			completedUpdate = true
			if event["turnId"] != "turn-1" {
				t.Fatalf("plan update turn = %v", event["turnId"])
			}
		}
	}
	if !completedUpdate {
		t.Fatal("missing completed plan stream update")
	}
}

func TestCodexCompactUsesNativeRPC(t *testing.T) {
	reader, writer := io.Pipe()
	s := &CodexSession{stdin: writer, pending: map[int64]chan map[string]any{}, threadID: "thread-1", activeTextIdx: -1, activeThinkIdx: -1}
	requests := make(chan map[string]any, 1)
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var request map[string]any
			_ = json.Unmarshal(scanner.Bytes(), &request)
			requests <- request
			id := int64(request["id"].(float64))
			s.mu.Lock()
			ch := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			if ch != nil {
				ch <- map[string]any{"result": map[string]any{}}
			}
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Prompt(ctx, "/compact", nil); err != nil {
		t.Fatal(err)
	}
	request := <-requests
	if request["method"] != "thread/compact/start" {
		t.Fatalf("request = %#v", request)
	}
	if len(s.timeline) != 0 {
		t.Fatalf("compact created a literal user turn: %#v", s.timeline)
	}
}
