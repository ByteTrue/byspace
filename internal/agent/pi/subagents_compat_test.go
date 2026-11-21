package pi

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// The tests launch the test binary itself as a stand-in pi: with the env marker set it answers
// RPC requests instead of running tests, so restore and the prompt round-trip see a live peer.
func TestSubagentReplayHelperProcess(t *testing.T) {
	if os.Getenv("BYSPACE_SUBAGENT_REPLAY_HELPER") != "1" {
		t.Skip("helper process")
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		var req struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(scanner.Bytes(), &req) != nil || req.ID == "" {
			continue
		}
		resp, _ := json.Marshal(map[string]any{"type": "response", "id": req.ID, "command": "prompt", "success": true})
		fmt.Println(string(resp))
	}
}

func TestSubagentReplayCompatibility(t *testing.T) {
	for _, notice := range []string{"subagent-notify", "subagent-exit"} {
		t.Run(notice, func(t *testing.T) {
			dir := t.TempDir()
			parent := filepath.Join(dir, "parent.jsonl")
			child := filepath.Join(dir, "timestamp_child1.jsonl")
			rows := []string{
				`{"type":"session","version":3}`,
				`{"type":"message","id":"a","parentId":null,"message":{"role":"assistant","content":[{"type":"toolCall","id":"call1","name":"subagent","arguments":{"agent":"explore","task":"Read history"}}]}}`,
				`{"type":"message","id":"b","parentId":"a","message":{"role":"toolResult","toolName":"subagent","toolCallId":"call1","details":{"id":"task1","status":"running","sessionId":"child1"}}}`,
				`{"type":"custom_message","id":"c","parentId":"b","customType":"` + notice + `","details":[{"id":"task1","status":"succeeded"}]}`,
			}
			if err := os.WriteFile(parent, []byte(strings.Join(rows, "\n")), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(child, []byte(`{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"child transcript"}]}}`), 0600); err != nil {
				t.Fatal(err)
			}
			binary, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			s, err := StartSession(LaunchOptions{Command: binary, Args: []string{"-test.run=^TestSubagentReplayHelperProcess$", "--"}, Cwd: dir, Session: parent, Env: append(os.Environ(), "BYSPACE_SUBAGENT_REPLAY_HELPER=1")})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			sub, ok := s.GetSubagent("parent", "task1")
			if !ok || sub.Status != "completed" || sub.SessionID != "child1" || sub.Title == nil || *sub.Title != "explore" || sub.CreatedAt == "" {
				t.Fatalf("replay: %+v, found=%t", sub, ok)
			}
			entries, err := LoadTimelineFromJSONL(LocateSubagentSessionFile(sub, dir))
			if err != nil || len(entries) != 1 || entries[0].Item.Text != "child transcript" {
				t.Fatalf("child timeline: %+v, err=%v", entries, err)
			}
		})
	}
}

func TestSubagentCompletionCompatibility(t *testing.T) {
	for _, notice := range []string{"subagent-notify", "subagent-exit"} {
		t.Run(notice, func(t *testing.T) {
			s := &Session{activeTextIdx: -1, activeThinkIdx: -1, subagents: make(map[string]SubagentDescriptor)}
			s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
			s.handleRawEvent(map[string]any{"type": "tool_execution_end", "toolName": "subagent", "toolCallId": "call1", "result": map[string]any{
				"details": map[string]any{"id": "task1", "status": "running", "sessionId": "child1", "asyncId": "task1", "results": []any{}},
			}})
			sub, ok := s.GetSubagent("parent", "task1")
			if !ok || sub.Status != "running" {
				t.Fatalf("launch: %+v, found=%t", sub, ok)
			}
			s.handleRawEvent(map[string]any{"type": "message_end", "message": map[string]any{"role": "custom", "customType": notice, "details": []any{
				map[string]any{"id": "task1", "status": "paused", "sessionFile": "child.jsonl"},
			}}})
			sub, ok = s.GetSubagent("parent", "task1")
			if !ok || sub.Status != "canceled" || sub.SessionID != "child1" || sub.SessionFile != "child.jsonl" {
				t.Fatalf("completion: %+v, found=%t", sub, ok)
			}
		})
	}
}

// A broken parent chain must degrade to a full linear replay (with historical timestamps kept),
// not silently restore nothing.
func TestSubagentRestoreBrokenChainReplaysLinearly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "parent.jsonl")
	rows := []string{
		`{"type":"session","version":3}`,
		`{"type":"message","id":"a","parentId":null,"timestamp":"2026-11-01T10:00:00Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call1","name":"subagent","arguments":{"agent":"explore","task":"Read history"}}]}}`,
		`{"type":"message","id":"b","parentId":"a","timestamp":"2026-11-01T10:00:01Z","message":{"role":"toolResult","toolName":"subagent","toolCallId":"call1","details":{"id":"task1","status":"running","sessionId":"child1"}}}`,
		`{"type":"message","id":"c","parentId":"missing","timestamp":"2026-11-01T10:00:02Z","message":{"role":"user","content":[{"type":"text","text":"unrelated branch"}]}}`,
	}
	if err := os.WriteFile(path, []byte(strings.Join(rows, "\n")), 0600); err != nil {
		t.Fatal(err)
	}
	s := &Session{subagents: make(map[string]SubagentDescriptor)}
	s.restoreSubagents(path)
	sub, ok := s.subagents["task1"]
	if !ok || sub.Status != "running" || sub.CreatedAt != "2026-11-01T10:00:01Z" {
		t.Fatalf("linear replay: %+v, found=%t", sub, ok)
	}
}
