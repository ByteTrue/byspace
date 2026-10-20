package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// faithfulFakePi replays the exact event order the real `pi --mode rpc` emits for a
// multi-step turn (captured from pi 0.99 against bytetrueapi/deepseek-flash):
//
//	extension_ui_request x3, response(prompt), agent_start, turn_start,
//	message_start/end(system), message_start/end(user),
//	message_start(assistant), thinking_delta x N, toolcall_*,
//	message_end(assistant), tool_execution_start/update/end,
//	message_start/end(toolResult), turn_end,           <-- mid-turn! not the end
//	turn_start, message_start(assistant), thinking, text_delta x N, message_end,
//	turn_end, agent_end, agent_settled
//
// The mid-turn `turn_end` is the shape that made a 19-second turn report "idle" after
// two seconds. Any regression that keys turn completion off `turn_end` fails here.
const faithfulFakePiScript = `#!/bin/sh
while read line; do
  case "$line" in
    *'"type":"prompt"'*)
      echo '{"type":"response","id":"req_1","command":"prompt","success":true,"data":{"agentInvoked":true}}'
      echo '{"type":"agent_start"}'
      echo '{"type":"turn_start"}'
      echo '{"type":"message_start","message":{"role":"system","content":[]}}'
      echo '{"type":"message_end","message":{"role":"system","content":[]}}'
      echo '{"type":"message_start","message":{"role":"user","content":[]}}'
      echo '{"type":"message_end","message":{"role":"user","content":[]}}'
      echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"Need "}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"the "}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"date."}}'
      echo '{"type":"message_end","message":{"role":"assistant","content":[]}}'
      echo '{"type":"tool_execution_start","toolCallId":"tc_1","toolName":"bash","args":{"command":"date"}}'
      echo '{"type":"tool_execution_update","toolCallId":"tc_1","toolName":"bash","partialResult":{"content":[{"type":"text","text":"partial"}]}}'
      echo '{"type":"tool_execution_end","toolCallId":"tc_1","toolName":"bash","result":{"content":[{"type":"text","text":"2026-10-20"}]},"isError":false}'
      echo '{"type":"message_start","message":{"role":"toolResult","content":[]}}'
      echo '{"type":"message_end","message":{"role":"toolResult","content":[]}}'
      echo '{"type":"turn_end","message":{"role":"assistant"}}'
      echo '{"type":"turn_start"}'
      echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"Now answer."}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Today "}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"is "}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"2026-10-20."}}'
      echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Today is 2026-10-20."}]}}'
      echo '{"type":"turn_end","message":{"role":"assistant"}}'
      echo '{"type":"agent_end","willRetry":false}'
      echo '{"type":"agent_settled"}'
      ;;
  esac
done
`

func writeFaithfulFakePi(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "faithful-pi.sh")
	if err := os.WriteFile(path, []byte(faithfulFakePiScript), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestStreamConformanceMultiStepTurn locks in the invariants the browser relies on but that
// no schema validation can catch: token-level streaming, single turn completion, monotonic
// sequence numbers, one user bubble per prompt, and idle only at the real end of the turn.
func TestStreamConformanceMultiStepTurn(t *testing.T) {
	tmp := t.TempDir()
	fakePi := writeFaithfulFakePi(t)
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "0.20.2-test", PiCommand: fakePi})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()

	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"conformance","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":            "create_agent_request",
			"requestId":       "cc_create",
			"clientMessageId": "client-msg-1",
			"initialPrompt":   "what is today's date?",
			"config":          map[string]any{"provider": "pi", "cwd": workDir},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}

	type streamEvent struct {
		seq     int
		kind    string
		item    map[string]any
		agentID string
	}
	var (
		events        []streamEvent
		turnCompleted int
		userMessages  int
		userClientID  string
		textDeltas    []string
		sawReasoning  bool
		sawToolCall   bool
		statuses      []string
		idleAfterDone bool
	)

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		readCtx, readCancel := context.WithTimeout(ctx, 3*time.Second)
		_, data, err := ws.Read(readCtx)
		readCancel()
		if err != nil {
			break
		}
		var envelope struct {
			Type    string `json:"type"`
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if json.Unmarshal(data, &envelope) != nil {
			continue
		}
		if envelope.Type != "session" {
			continue
		}
		payload := envelope.Message.Payload

		switch envelope.Message.Type {
		case "agent_stream":
			event, _ := payload["event"].(map[string]any)
			if event == nil {
				continue
			}
			kind, _ := event["type"].(string)
			item, _ := event["item"].(map[string]any)
			seq := 0
			if raw, ok := payload["seq"].(float64); ok {
				seq = int(raw)
			}
			events = append(events, streamEvent{seq: seq, kind: kind, item: item})
			switch kind {
			case "turn_completed":
				turnCompleted++
			case "timeline":
				itemType, _ := item["type"].(string)
				switch itemType {
				case "user_message":
					userMessages++
					if cid, ok := item["clientMessageId"].(string); ok {
						userClientID = cid
					}
				case "reasoning":
					sawReasoning = true
				case "tool_call":
					sawToolCall = true
				case "assistant_message":
					if text, ok := item["text"].(string); ok && text != "" {
						textDeltas = append(textDeltas, text)
					}
				}
			}
		case "agent_update":
			agent, _ := payload["agent"].(map[string]any)
			if status, ok := agent["status"].(string); ok {
				statuses = append(statuses, status)
				if status == "idle" && turnCompleted > 0 {
					// The terminal snapshot must land after turn_completed and carry no
					// activeTurn — otherwise the client re-arms the running spinner.
					if agent["activeTurn"] != nil {
						t.Fatalf("idle snapshot still carries activeTurn: %+v", agent["activeTurn"])
					}
					idleAfterDone = true
				}
			}
		}

		// Keep draining after turn_completed: the terminal snapshot arrives behind it.
		if idleAfterDone {
			break
		}
	}

	if turnCompleted != 1 {
		t.Fatalf("expected exactly one turn_completed despite the mid-turn pi turn_end, got %d (events=%d)", turnCompleted, len(events))
	}
	if userMessages != 1 {
		t.Fatalf("expected the prompt rendered once, got %d user_message items", userMessages)
	}
	if userClientID != "client-msg-1" {
		t.Fatalf("expected user_message to echo clientMessageId for optimistic-bubble reconciliation, got %q", userClientID)
	}
	if !sawReasoning {
		t.Fatal("expected a reasoning timeline item (thinking stream), got none")
	}
	if !sawToolCall {
		t.Fatal("expected a tool_call timeline item, got none")
	}
	if len(textDeltas) < 2 {
		t.Fatalf("expected token-level streaming (>=2 assistant deltas), got %d: %v", len(textDeltas), textDeltas)
	}
	joined := strings.Join(textDeltas, "")
	if !strings.Contains(joined, "Today is 2026-10-20") {
		t.Fatalf("expected assembled assistant text, got %q", joined)
	}

	// Sequence numbers must be strictly increasing so the client's gap detection never
	// drops a delta as a duplicate.
	lastSeq := 0
	for _, ev := range events {
		if ev.seq == 0 {
			continue
		}
		if ev.seq <= lastSeq {
			t.Fatalf("stream seq must strictly increase, got %d after %d (kind=%s)", ev.seq, lastSeq, ev.kind)
		}
		lastSeq = ev.seq
	}

	// The turn must end idle, and must have been running before that.
	if len(statuses) == 0 {
		t.Fatal("expected agent_update status frames, got none")
	}
	if !idleAfterDone {
		t.Fatalf("expected an idle agent_update after turn_completed, got statuses=%v", statuses)
	}
	if statuses[len(statuses)-1] != "idle" {
		t.Fatalf("expected the last agent_update to be idle, got %q (all=%v)", statuses[len(statuses)-1], statuses)
	}
	sawRunning := false
	for _, st := range statuses {
		if st == "running" {
			sawRunning = true
		}
	}
	if !sawRunning {
		t.Fatalf("expected a running agent_update during the turn, got only %v", statuses)
	}
}

// TestPromptSurvivesProviderDeath is the regression guard for:
// "我第二句消息发完之后迟迟没有结果，刷新之后发送的记录直接没了".
//
// Two failures happened together there:
//  1. pi had died, so the prompt never got a turn — but nothing told the client, so the
//     spinner stayed forever.
//  2. the user message only existed in pi's own .jsonl, which pi never wrote — so a reload
//     erased what the user had said.
func TestPromptSurvivesProviderDeath(t *testing.T) {
	tmp := t.TempDir()
	// A provider that accepts the prompt then exits without emitting any events.
	exitAfterPrompt := filepath.Join(tmp, "dying-pi.sh")
	script := `#!/bin/sh
read -r line || exit 0
case "$line" in
  *'"type":"prompt"'*) exit 1 ;;
esac
`
	if err := os.WriteFile(exitAfterPrompt, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	homeDir := filepath.Join(tmp, "home")
	srv, err := New(Options{HomeDir: homeDir, Version: "0.20.2-test", PiCommand: exitAfterPrompt})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"death","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "create_agent_request", "requestId": "dc1",
			"initialPrompt": "this prompt must not disappear",
			"config":        map[string]any{"provider": "pi", "cwd": workDir},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}

	var agentID, userText string
	var sawTurnCompleted bool
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		rctx, rc := context.WithTimeout(ctx, 2*time.Second)
		_, data, readErr := ws.Read(rctx)
		rc()
		if readErr != nil {
			break
		}
		var env struct {
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		p := env.Message.Payload
		if env.Message.Type == "status" && p["status"] == "agent_created" {
			agentID, _ = p["agentId"].(string)
		}
		if env.Message.Type == "agent_stream" {
			event, _ := p["event"].(map[string]any)
			kind, _ := event["type"].(string)
			if kind == "turn_completed" {
				sawTurnCompleted = true
			}
			if kind == "timeline" {
				item, _ := event["item"].(map[string]any)
				if item["type"] == "user_message" {
					userText, _ = item["text"].(string)
				}
			}
		}
		if sawTurnCompleted && userText != "" {
			break
		}
	}
	ws.CloseNow()
	_ = srv.Close()
	ts.Close()

	if agentID == "" {
		t.Fatal("agent was never created")
	}
	if userText != "this prompt must not disappear" {
		t.Fatalf("expected the prompt echoed back on the stream, got %q", userText)
	}
	if !sawTurnCompleted {
		t.Fatal("provider died mid-turn but no turn_completed was emitted; the client would spin forever")
	}

	// A reload must still show the message even though pi never wrote its session file.
	reopened, err := New(Options{HomeDir: homeDir, Version: "0.20.2-test", PiCommand: exitAfterPrompt})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	rows, ok := reopened.store.LoadAgentTimeline(agentID)
	if !ok || len(rows) == 0 {
		t.Fatalf("expected a persisted timeline snapshot for %s, got ok=%v rows=%d", agentID, ok, len(rows))
	}
	found := false
	for _, row := range rows {
		item, _ := row["item"].(map[string]any)
		if item["type"] == "user_message" && item["text"] == "this prompt must not disappear" {
			found = true
		}
	}
	if !found {
		t.Fatalf("persisted timeline lost the user message: %+v", rows)
	}
}
