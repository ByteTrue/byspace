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

// TestProcessExitFailsTurnAndReleasesRuntime pins the Node-aligned recovery path:
// when the provider dies mid-turn the daemon must (a) end the turn as `turn_failed`
// so the client stops waiting, and (b) drop the dead runtime so the next send
// rebuilds it from persistence instead of writing into a closed pipe.
func TestProcessExitFailsTurnAndReleasesRuntime(t *testing.T) {
	tmp := t.TempDir()
	dying := filepath.Join(tmp, "dying-pi.sh")
	// First prompt accepted, then the process exits without any turn events.
	script := `#!/bin/sh
read -r line || exit 0
case "$line" in
  *'"type":"prompt"'*) exit 1 ;;
esac
`
	if err := os.WriteFile(dying, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "0.20.2-test", PiCommand: dying})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"exit","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "create_agent_request", "requestId": "ex1",
			"initialPrompt": "will kill the provider",
			"config":        map[string]any{"provider": "pi", "cwd": workDir},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}

	var agentID string
	var sawTurnFailed, sawTurnCompleted bool
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
			switch event["type"] {
			case "turn_failed":
				sawTurnFailed = true
			case "turn_completed":
				sawTurnCompleted = true
			}
		}
		if sawTurnFailed {
			break
		}
	}

	if agentID == "" {
		t.Fatal("agent was never created")
	}
	if sawTurnCompleted {
		t.Fatal("provider died mid-turn but the turn reported success")
	}
	if !sawTurnFailed {
		t.Fatal("provider died mid-turn but no turn_failed was emitted; the client would wait forever")
	}

	// The dead runtime must be gone, otherwise the next prompt writes into a closed pipe.
	srv.mu.Lock()
	_, stillRegistered := srv.agents[agentID]
	srv.mu.Unlock()
	if stillRegistered {
		t.Fatal("dead provider runtime is still registered; the next send would fail silently")
	}
}

// TestSecondMessageAfterTurnCompleted covers the reported bug "新会话永远发不出第二条消息".
//
// The app's default sendBehavior is "steer", so every send carries
// activeTurnBehavior:"steer" — even when the previous turn already finished. Node's
// steerOrReplaceActiveTurn returns {status:"inactive"} in that case and the caller starts a
// normal turn; steering unconditionally sends `steer` to a provider with no live turn, which
// pi accepts as a queued message that never becomes a turn, so the prompt vanishes.
func TestSecondMessageAfterTurnCompleted(t *testing.T) {
	tmp := t.TempDir()
	// Echo provider: replies to every prompt with a message_end, using the real pi event order.
	echoPi := filepath.Join(tmp, "echo-pi.sh")
	script := `#!/bin/sh
while read line; do
  case "$line" in
    *'"type":"steer"'*)
      # A steer with no live turn must never be the path taken; make it observable.
      echo '{"type":"response","id":"s","command":"steer","success":true,"data":{}}'
      ;;
    *'"type":"prompt"'*)
      echo '{"type":"response","id":"p","command":"prompt","success":true,"data":{"agentInvoked":true}}'
      echo '{"type":"agent_start"}'
      echo '{"type":"turn_start"}'
      echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ok"}}'
      echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}'
      echo '{"type":"turn_end","message":{"role":"assistant"}}'
      echo '{"type":"agent_end","willRetry":false}'
      echo '{"type":"agent_settled"}'
      ;;
  esac
done
`
	if err := os.WriteFile(echoPi, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "0.20.2-test", PiCommand: echoPi})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"second","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "create_agent_request", "requestId": "s1", "clientMessageId": "m1",
			"initialPrompt": "first", "config": map[string]any{"provider": "pi", "cwd": workDir},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}

	waitTurnCompleted := func(label string) string {
		t.Helper()
		deadline := time.Now().Add(6 * time.Second)
		for time.Now().Before(deadline) {
			rctx, rc := context.WithTimeout(ctx, 2*time.Second)
			_, data, readErr := ws.Read(rctx)
			rc()
			if readErr != nil {
				t.Fatalf("%s: read failed: %v", label, readErr)
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
			if env.Message.Type != "agent_stream" {
				continue
			}
			event, _ := env.Message.Payload["event"].(map[string]any)
			switch event["type"] {
			case "turn_completed":
				id, _ := env.Message.Payload["agentId"].(string)
				return id
			case "turn_failed":
				t.Fatalf("%s: turn failed: %v", label, event["error"])
			}
		}
		t.Fatalf("%s: timed out waiting for turn_completed", label)
		return ""
	}

	agentID := waitTurnCompleted("first turn")

	// The app always sends activeTurnBehavior:"steer" (default sendBehavior), including when
	// no turn is live. This must start a fresh turn instead of a no-op steer.
	secondReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "send_agent_message_request", "requestId": "s2", "agentId": agentID,
			"text": "second", "messageId": "m2", "activeTurnBehavior": "steer",
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, secondReq); err != nil {
		t.Fatal(err)
	}
	waitTurnCompleted("second turn")
}

// TestPairingQRHasFinderPatterns guards against rendering a decorative pattern instead of a
// real QR code. Node uses the `qrcode` package; a matrix that merely hashes the URL looks
// plausible in a terminal but no phone can decode it.
//
// A QR symbol always carries three 7x7 finder patterns (dark border, light ring, 3x3 dark
// core) at the top-left, top-right and bottom-left corners of the data region, separated from
// the edge by a quiet zone. A hash-derived matrix does not reproduce that geometry.
func TestPairingQRHasFinderPatterns(t *testing.T) {
	art, err := RenderASCIIQRCode("https://app.byspace.cc.cd/#offer=eyJ2IjoyfQ")
	if err != nil {
		t.Fatalf("QR render failed: %v", err)
	}

	lines := strings.Split(strings.TrimRight(art, "\n"), "\n")
	if len(lines) < 24 {
		t.Fatalf("QR art has %d lines; a version-1 symbol needs >= 21 modules plus a quiet zone", len(lines))
	}

	// Reconstruct the module grid: each character encodes two vertically adjacent modules.
	dark := map[rune][2]bool{
		'█': {true, true},
		'▀': {true, false},
		'▄': {false, true},
		' ': {false, false},
	}
	width := len([]rune(lines[0]))
	grid := make([][]bool, 0, len(lines)*2)
	for _, line := range lines {
		top := make([]bool, width)
		bottom := make([]bool, width)
		for i, r := range []rune(line) {
			px, ok := dark[r]
			if !ok {
				t.Fatalf("unexpected QR glyph %q", r)
			}
			top[i] = px[0]
			bottom[i] = px[1]
		}
		grid = append(grid, top, bottom)
	}

	// Locate the first dark module: everything before it is the quiet zone.
	top0, left0 := -1, -1
	for r := 0; r < len(grid); r++ {
		for c := 0; c < len(grid[r]); c++ {
			if grid[r][c] {
				top0, left0 = r, c
				break
			}
		}
		if top0 >= 0 {
			break
		}
	}
	if top0 < 0 {
		t.Fatal("QR art contains no dark modules")
	}
	if top0 == 0 || left0 == 0 {
		t.Fatal("QR art has no quiet zone around the symbol")
	}

	// Finder pattern at the origin: dark 7x7 border, light ring, solid 3x3 core.
	expect := func(r, c int, want bool, label string) {
		if top0+r >= len(grid) || left0+c >= width {
			t.Fatalf("finder pattern %s runs past the symbol edge", label)
		}
		if grid[top0+r][left0+c] != want {
			t.Fatalf("finder pattern %s: module (%d,%d) = %v, want %v", label, r, c, grid[top0+r][left0+c], want)
		}
	}
	for i := 0; i < 7; i++ {
		expect(0, i, true, "top border")
		expect(6, i, true, "bottom border")
		expect(i, 0, true, "left border")
		expect(i, 6, true, "right border")
	}
	for i := 1; i < 6; i++ {
		expect(1, i, false, "light ring")
		expect(5, i, false, "light ring")
		expect(i, 1, false, "light ring")
		expect(i, 5, false, "light ring")
	}
	for r := 2; r <= 4; r++ {
		for c := 2; c <= 4; c++ {
			expect(r, c, true, "dark core")
		}
	}

	// The same 7x7 block must be mirrored at the top-right corner of the data region.
	// Trim the trailing quiet zone to find the data region's right edge.
	rightEdge := -1
	for c := width - 1; c >= 0; c-- {
		found := false
		for r := 0; r < len(grid); r++ {
			if grid[r][c] {
				found = true
				break
			}
		}
		if found {
			rightEdge = c
			break
		}
	}
	if rightEdge < 0 {
		t.Fatal("could not locate the right edge of the symbol")
	}
	for i := 0; i < 7; i++ {
		if !grid[top0][rightEdge-6+i] {
			t.Fatalf("top-right finder border missing at column %d", rightEdge-6+i)
		}
	}
}

// TestWorkspaceCreateRunsSetup pins the bootstrap behaviour ported from
// runAsyncWorktreeBootstrap: a workspace whose byspace.json declares setup commands must run
// them, and report why when there are none.
//
// Without this a freshly created worktree looks ready but has no node_modules, so the first
// command the user runs fails.
func TestWorkspaceCreateRunsSetup(t *testing.T) {
	tmp := t.TempDir()
	fakePi := writeFaithfulFakePi(t)
	workDir := filepath.Join(tmp, "project")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(workDir, "setup-ran.txt")
	manifest := `{"setup":"echo ready > setup-ran.txt"}`
	if err := os.WriteFile(filepath.Join(workDir, "byspace.json"), []byte(manifest), 0o644); err != nil {
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
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"setup","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "workspace.create.request",
			"requestId": "wc1",
			"source":    map[string]any{"kind": "directory", "path": workDir},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}

	// The response must say setup is running (not "no setup commands configured").
	var skipped any
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
		if env.Message.Type == "workspace.create.response" {
			skipped = env.Message.Payload["setupSkippedReason"]
			break
		}
	}
	if skipped != nil {
		t.Fatalf("expected setup to start, got setupSkippedReason=%v", skipped)
	}

	// And it must actually run.
	runDeadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(runDeadline) {
		if _, statErr := os.Stat(marker); statErr == nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("setup command never ran: setup-ran.txt was not created")
}

// A workspace whose manifest has no setup block must say so instead of silently doing nothing.
func TestWorkspaceCreateReportsSkippedSetup(t *testing.T) {
	tmp := t.TempDir()
	fakePi := writeFaithfulFakePi(t)
	workDir := filepath.Join(tmp, "plain")
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"nosetup","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	createReq, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "workspace.create.request", "requestId": "wc2",
			"source": map[string]any{"kind": "directory", "path": workDir},
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, createReq); err != nil {
		t.Fatal(err)
	}
	for {
		rctx, rc := context.WithTimeout(ctx, 3*time.Second)
		_, data, readErr := ws.Read(rctx)
		rc()
		if readErr != nil {
			t.Fatalf("no workspace.create.response: %v", readErr)
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
		if env.Message.Type != "workspace.create.response" {
			continue
		}
		if env.Message.Payload["setupSkippedReason"] != "no setup commands configured" {
			t.Fatalf("expected an explicit skip reason, got %v", env.Message.Payload["setupSkippedReason"])
		}
		return
	}
}

// TestArchiveWorkspaceStopsItsAgents pins archiveWorkspaceContents from
// workspace-archive-service.ts: archiving a workspace must stop its agents and archive their
// records, not just flip a flag on the workspace.
//
// Leaving them running means an agent keeps consuming tokens against a workspace the user
// just removed from the sidebar, and its PTYs stay open.
func TestArchiveWorkspaceStopsItsAgents(t *testing.T) {
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
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"arch","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	readUntilSessionType(t, ctx, ws, "status", "server_info")

	send := func(msg map[string]any) {
		b, _ := json.Marshal(map[string]any{"type": "session", "message": msg})
		if err := ws.Write(ctx, websocket.MessageText, b); err != nil {
			t.Fatal(err)
		}
	}
	send(map[string]any{
		"type": "workspace.create.request", "requestId": "wc",
		"source": map[string]any{"kind": "directory", "path": workDir},
	})

	var workspaceID string
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) && workspaceID == "" {
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
		if env.Message.Type == "workspace.create.response" {
			if wsObj, ok := env.Message.Payload["workspace"].(map[string]any); ok {
				workspaceID, _ = wsObj["id"].(string)
			}
		}
	}
	if workspaceID == "" {
		t.Fatal("workspace was never created")
	}

	send(map[string]any{
		"type": "create_agent_request", "requestId": "ac",
		"config": map[string]any{"provider": "pi", "cwd": workDir, "workspaceId": workspaceID},
	})
	var agentID string
	deadline = time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) && agentID == "" {
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
		if env.Message.Type == "status" && env.Message.Payload["status"] == "agent_created" {
			agentID, _ = env.Message.Payload["agentId"].(string)
		}
	}
	if agentID == "" {
		t.Fatal("agent was never created")
	}

	send(map[string]any{
		"type": "archive_workspace_request", "requestId": "ar", "workspaceId": workspaceID,
	})

	// The agent must be archived and its runtime released.
	archiveDeadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(archiveDeadline) {
		rec, getErr := srv.store.GetAgent(agentID)
		stillRunning := false
		srv.mu.Lock()
		if _, ok := srv.agents[agentID]; ok {
			stillRunning = true
		}
		srv.mu.Unlock()
		if getErr == nil && rec != nil && rec.ArchivedAt != nil && !stillRunning {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	rec, _ := srv.store.GetAgent(agentID)
	t.Fatalf("agent was not torn down by workspace archive: record=%+v", rec)
}
