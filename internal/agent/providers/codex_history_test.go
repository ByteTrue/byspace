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

func TestCodexLoadNativeHistoryUsesLegacyThreadItems(t *testing.T) {
	reader, writer := io.Pipe()
	s := &CodexSession{stdin: writer, pending: map[int64]chan map[string]any{}, threadID: "thread-1", activeTextIdx: -1, activeThinkIdx: -1, eventSubscribers: map[int]func(map[string]any){}}
	s.frames = sdk.NewStreamFrames(func() {})
	defer s.frames.Stop()
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var request map[string]any
			_ = json.Unmarshal(scanner.Bytes(), &request)
			if request["method"] != "thread/read" {
				t.Errorf("method = %v", request["method"])
				continue
			}
			id := int64(request["id"].(float64))
			s.mu.Lock()
			ch := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			ch <- map[string]any{"result": map[string]any{"thread": map[string]any{"turns": []any{map[string]any{"id": "turn-native-1", "items": []any{
				map[string]any{"id": "user-1", "type": "userMessage", "text": "First"},
				map[string]any{"id": "agent-1", "type": "agentMessage", "text": "Answer"},
			}}}}}}
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.LoadNativeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	if len(s.timeline) != 2 || s.timeline[0].Item.Type != "user_message" || s.timeline[0].Item.Text != "First" || s.timeline[1].Item.Text != "Answer" {
		t.Fatalf("timeline = %#v", s.timeline)
	}
	if len(s.turnIDs) != 1 || s.turnIDs[0] != "turn-native-1" {
		t.Fatalf("native turn IDs = %#v", s.turnIDs)
	}
}

func TestCodexSubagentTimelineReadsNativeChildWhenUserNotificationIsMissing(t *testing.T) {
	reader, writer := io.Pipe()
	s := &CodexSession{
		stdin: writer, pending: map[int64]chan map[string]any{}, threadID: "parent",
		subagents:         map[string]sdk.SubagentDescriptor{"child": {ID: "child", Provider: "codex"}},
		subagentTimelines: map[string][]sdk.TimelineEntry{}, eventSubscribers: map[int]func(map[string]any){},
	}
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var request map[string]any
			_ = json.Unmarshal(scanner.Bytes(), &request)
			id := int64(request["id"].(float64))
			params, _ := request["params"].(map[string]any)
			if request["method"] != "thread/read" || params["threadId"] != "child" {
				t.Errorf("request = %#v", request)
				continue
			}
			s.mu.Lock()
			ch := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			ch <- map[string]any{"result": map[string]any{"thread": map[string]any{"turns": []any{map[string]any{"items": []any{
				map[string]any{"id": "user-1", "type": "UserMessage", "text": "Child prompt"},
				map[string]any{"id": "agent-1", "type": "AgentMessage", "text": "Child answer"},
			}}}}}}
		}
	}()
	entries, err := s.SubagentTimeline("parent", "child")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Item.Type != "user_message" || entries[0].Item.Text != "Child prompt" || entries[1].Item.Text != "Child answer" {
		t.Fatalf("entries = %#v", entries)
	}
}
