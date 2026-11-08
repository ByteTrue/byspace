package pi

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestBuildLaunchArgs(t *testing.T) {
	cmd, argv := BuildLaunchArgs(LaunchOptions{
		Command:          "/usr/local/bin/pi",
		Model:            "anthropic/claude-sonnet-4-5",
		ThinkingOptionID: "high",
		NoSession:        true,
		ExtensionPaths:   []string{"/tmp/ext.ts"},
	})
	if cmd != "/usr/local/bin/pi" {
		t.Fatalf("unexpected command: %s", cmd)
	}
	want := []string{
		"--mode", "rpc",
		"--model", "anthropic/claude-sonnet-4-5",
		"--thinking", "high",
		"--no-session",
		"--extension", "/tmp/ext.ts",
		"--approve",
	}
	if !slices.Equal(argv, want) {
		t.Fatalf("argv mismatch:\ngot:  %v\nwant: %v", argv, want)
	}
}

func TestPiSessionPromptStreamingToolCallsAndWaitForFinish(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	tmp := t.TempDir()
	fakePi := filepath.Join(tmp, "fake-pi.sh")
	script := `#!/bin/sh
# Read first RPC command (get_state)
read line
echo '{"type":"response","id":"req_1","command":"get_state","success":true,"data":{"sessionId":"pi_sess_01","thinkingLevel":"medium","isStreaming":false,"isCompacting":false,"messageCount":0,"pendingMessageCount":0}}'

# Read second RPC command (prompt)
read line
echo '{"type":"response","id":"req_2","command":"prompt","success":true,"data":{"agentInvoked":true}}'
echo '{"type":"agent_start"}'
echo '{"type":"turn_start"}'
echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"Analyzing request..."}}'
echo '{"type":"tool_execution_start","toolCallId":"call_1","toolName":"bash","args":{"command":"ls"}}'
echo '{"type":"tool_execution_end","toolCallId":"call_1","toolName":"bash","result":"main.go","isError":false}'
echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello from "}}'
echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Go Pi Host!"}}'
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello from Go Pi Host!"}]}}'
echo '{"type":"agent_end","willRetry":false}'
echo '{"type":"agent_settled"}'
sleep 1
`
	if err := os.WriteFile(fakePi, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sess, err := StartSession(LaunchOptions{
		Command: fakePi,
		Cwd:     tmp,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	st, err := sess.GetState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.SessionID != "pi_sess_01" || st.ThinkingLevel != "medium" {
		t.Fatalf("unexpected state: %+v", st)
	}

	if err := sess.Prompt(ctx, "Run ls and greet me", nil); err != nil {
		t.Fatal(err)
	}

	if err := sess.WaitForFinish(ctx); err != nil {
		t.Fatal(err)
	}

	if sess.Status() != "idle" {
		t.Fatalf("expected idle status after settle, got %s", sess.Status())
	}

	if got := sess.LastAssistantText(); got != "Hello from Go Pi Host!" {
		t.Fatalf("unexpected assistant text: %q", got)
	}

	tl := sess.Timeline()
	if len(tl) != 4 {
		t.Fatalf("expected 4 timeline entries (user, reasoning, tool_call, assistant), got %d: %+v", len(tl), tl)
	}
	if tl[0].Item.Type != "user_message" || tl[0].Item.Text != "Run ls and greet me" {
		t.Fatalf("unexpected entry 0: %+v", tl[0])
	}
	if tl[1].Item.Type != "reasoning" || tl[1].Item.Text != "Analyzing request..." {
		t.Fatalf("unexpected entry 1: %+v", tl[1])
	}
	if tl[2].Item.Type != "tool_call" || tl[2].Item.Name != "bash" || tl[2].Item.Status != "completed" {
		t.Fatalf("unexpected entry 2: %+v", tl[2])
	}
	if tl[3].Item.Type != "assistant_message" || tl[3].Item.Text != "Hello from Go Pi Host!" {
		t.Fatalf("unexpected entry 3: %+v", tl[3])
	}
}

func TestListImportableSessionsAndLoadTimelineFromJSONL(t *testing.T) {
	tmp := t.TempDir()
	workCwd := filepath.Join(tmp, "repo")
	if err := os.MkdirAll(workCwd, 0o755); err != nil {
		t.Fatal(err)
	}
	sessFile := filepath.Join(tmp, "session-1.jsonl")
	// Marshalled rather than concatenated: a Windows path is full of backslashes, which are JSON escapes.
	encodedCwd, err := json.Marshal(workCwd)
	if err != nil {
		t.Fatal(err)
	}
	jsonlContent := strings.Join([]string{
		`{"type":"session","id":"sess_abc","cwd":` + string(encodedCwd) + `,"timestamp":"2026-04-20T01:00:00.000Z"}`,
		`{"type":"session_info","name":"Refactor Go Session"}`,
		`{"type":"model_change","provider":"anthropic","modelId":"claude-sonnet-4-5"}`,
		`{"type":"thinking_level_change","thinkingLevel":"high"}`,
		`{"type":"message","timestamp":"2026-04-20T01:01:00.000Z","message":{"role":"user","content":"Check main.go"}}`,
		`{"type":"message","timestamp":"2026-04-20T01:01:02.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Reading main.go"},{"type":"toolCall","id":"tc_1","name":"read","arguments":{"path":"main.go"}},{"type":"text","text":"main.go looks clean."}]}}`,
		`{"type":"message","timestamp":"2026-04-20T01:01:03.000Z","message":{"role":"toolResult","toolCallId":"tc_1","toolName":"read","content":"package main","isError":false}}`,
	}, "\n") + "\n"

	if err := os.WriteFile(sessFile, []byte(jsonlContent), 0o600); err != nil {
		t.Fatal(err)
	}

	sessions, err := ListImportableSessions(HistoryOptions{
		SessionDir: tmp,
		Cwd:        workCwd,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 importable session, got %d", len(sessions))
	}
	s0 := sessions[0]
	if s0.Title == nil || *s0.Title != "Refactor Go Session" {
		t.Fatalf("unexpected title: %+v", s0.Title)
	}
	if s0.Model == nil || *s0.Model != "anthropic/claude-sonnet-4-5" {
		t.Fatalf("unexpected model: %+v", s0.Model)
	}
	if s0.ThinkingOptionID == nil || *s0.ThinkingOptionID != "high" {
		t.Fatalf("unexpected thinkingOptionId: %+v", s0.ThinkingOptionID)
	}

	entries, err := LoadTimelineFromJSONL(sessFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 4 {
		t.Fatalf("expected 4 timeline entries from JSONL, got %d: %+v", len(entries), entries)
	}
	if entries[0].Item.Type != "user_message" || entries[0].Item.Text != "Check main.go" {
		t.Fatalf("unexpected entry 0: %+v", entries[0])
	}
	if entries[2].Item.Type != "tool_call" || entries[2].Item.Name != "read" || entries[2].Item.Status != "completed" {
		t.Fatalf("unexpected entry 2: %+v", entries[2])
	}
	if entries[3].Item.Type != "assistant_message" || entries[3].Item.Text != "main.go looks clean." {
		t.Fatalf("unexpected entry 3: %+v", entries[3])
	}
}

func TestStructuredToolDetailsPermissionsAndSubagents(t *testing.T) {
	bashDetail := BuildToolCallDetail("bash", map[string]any{"command": "go test ./..."}, "ok\n")
	if bashDetail["type"] != "shell" || bashDetail["command"] != "go test ./..." || bashDetail["output"] != "ok\n" {
		t.Fatalf("unexpected bash detail: %+v", bashDetail)
	}

	editDetail := BuildToolCallDetail("edit", map[string]any{
		"path":    "main.go",
		"oldText": "v1",
		"newText": "v2",
	}, nil)
	if editDetail["type"] != "edit" || editDetail["filePath"] != "main.go" || editDetail["oldString"] != "v1" || editDetail["newString"] != "v2" {
		t.Fatalf("unexpected edit detail: %+v", editDetail)
	}

	perm := MapExtensionUIRequestToPermission(map[string]any{
		"type":    "extension_ui_request",
		"id":      "ui_1",
		"method":  "select",
		"title":   "Pick a branch",
		"options": []any{"main", "refactor/go"},
	})
	if perm == nil || perm["id"] != "ui_1" || perm["kind"] != "question" {
		t.Fatalf("unexpected mapped permission: %+v", perm)
	}

	uiResp := BuildExtensionUIResponse("ui_1", perm, map[string]any{
		"behavior": "allow",
		"updatedInput": map[string]any{
			"answers": map[string]any{"Answer": "refactor/go"},
		},
	})
	if uiResp["value"] != "refactor/go" {
		t.Fatalf("unexpected extension_ui_response: %+v", uiResp)
	}

	subs := ParseSubagentDetails("tc_sub_1", map[string]any{"agent": "reviewer", "task": "Review diff"}, map[string]any{
		"id":          "sub_01",
		"status":      "completed",
		"sessionId":   "sess_child_01",
		"sessionFile": "/tmp/child.jsonl",
	})
	if len(subs) != 1 || subs[0].ID != "sub_01" || subs[0].Status != "completed" || subs[0].SessionFile != "/tmp/child.jsonl" {
		t.Fatalf("unexpected parsed subagents: %+v", subs)
	}
}

func TestPromptForwardsImageBlocksToPi(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	tmp := t.TempDir()
	fakePi := filepath.Join(tmp, "fake-pi-echo-images.sh")
	// Echo back the raw prompt command line so the test can assert image blocks survived.
	script := `#!/bin/sh
while read line; do
  case "$line" in
    *'"type":"prompt"'*)
      echo "{\"type\":\"response\",\"id\":\"r1\",\"command\":\"prompt\",\"success\":true,\"data\":{\"agentInvoked\":true}}"
      echo '{"type":"agent_start"}'
      echo '{"type":"turn_start"}'
      echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
      printf '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ECHO:%s"}}\n' "$(printf '%s' "$line" | sed 's/"/\\"/g')"
      echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}'
      echo '{"type":"agent_end","willRetry":false}'
      echo '{"type":"agent_settled"}'
      ;;
  esac
done
`
	if err := os.WriteFile(fakePi, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sess, err := StartSession(LaunchOptions{Command: fakePi, Cwd: tmp})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	if err := sess.Prompt(context.Background(), "what colour", []ImageContent{
		{Type: "image", Data: b64, MimeType: "image/png"},
	}); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(3 * time.Second)
	var text string
	for time.Now().Before(deadline) {
		text = sess.LastAssistantText()
		if strings.Contains(text, "ECHO:") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !strings.Contains(text, `"type":"image"`) || !strings.Contains(text, b64) || !strings.Contains(text, `"mimeType":"image/png"`) {
		t.Fatalf("image block was not forwarded to pi prompt: %s", text)
	}
}

// newEventSession is a Session with no child process, for tests that feed pi's runtime events
// straight into handleRawEvent.
func newEventSession(t *testing.T) (*Session, *[]map[string]any) {
	t.Helper()
	s := &Session{
		status:             "idle",
		activeTextIdx:      -1,
		activeThinkIdx:     -1,
		toolIndexByID:      map[string]int{},
		toolArgsByID:       map[string]any{},
		pendingPermissions: map[string]map[string]any{},
		subagents:          map[string]SubagentDescriptor{},
		commandWaiters:     map[string]chan commandResult{},
		eventSubscribers:   map[int]func(map[string]any){},
	}
	s.frames = sdk.NewStreamFrames(func() {})
	var got []map[string]any
	s.OnEvent(func(ev map[string]any) { got = append(got, ev) })
	return s, &got
}

func eventTypes(got []map[string]any) []string {
	out := make([]string, 0, len(got))
	for _, ev := range got {
		if typ, _ := ev["type"].(string); strings.HasPrefix(typ, "byspace_turn") {
			out = append(out, typ)
		}
	}
	return out
}

// A failed model call arrives as stopReason "error" plus errorMessage, never as an error of its
// own; the turn must not read as completed.
func TestModelFailureEndsTurnAsFailed(t *testing.T) {
	s, got := newEventSession(t)
	for _, ev := range []map[string]any{
		{"type": "agent_start"},
		{"type": "turn_start"},
		{"type": "message_end", "message": map[string]any{
			"role":         "assistant",
			"content":      []any{},
			"stopReason":   "error",
			"errorMessage": "OpenCode Zen Free: Free usage limit reached (429: you can retry your request)",
		}},
		{"type": "agent_end", "willRetry": false},
	} {
		s.handleRawEvent(ev)
	}

	if want := []string{"byspace_turn_failed"}; !slices.Equal(eventTypes(*got), want) {
		t.Fatalf("turn events = %v, want %v", eventTypes(*got), want)
	}
	for _, ev := range *got {
		if ev["type"] == "byspace_turn_failed" && ev["error"] != "OpenCode Zen Free: Free usage limit reached (429: you can retry your request)" {
			t.Fatalf("failed turn carries no provider message: %+v", ev)
		}
	}
	if s.Status() != "idle" {
		t.Fatalf("session must settle idle, got %s", s.Status())
	}
	if token, _ := (*got)[0]["turnToken"].(string); token != s.TurnToken() {
		t.Fatalf("failed turn carries turnToken %q, want %q", token, s.TurnToken())
	}
}

// A retried call that finally answers is a completed turn: the last assistant message decides.
func TestRetryThatSettlesCompletesTurn(t *testing.T) {
	s, got := newEventSession(t)
	for _, ev := range []map[string]any{
		{"type": "agent_start"},
		{"type": "message_end", "message": map[string]any{
			"role": "assistant", "content": []any{}, "stopReason": "error", "errorMessage": "429",
		}},
		{"type": "agent_end", "willRetry": true},
		{"type": "message_end", "message": map[string]any{
			"role":    "assistant",
			"content": []any{map[string]any{"type": "text", "text": "here you go"}},
		}},
		{"type": "agent_end", "willRetry": false},
	} {
		s.handleRawEvent(ev)
	}

	if want := []string{"byspace_turn_completed"}; !slices.Equal(eventTypes(*got), want) {
		t.Fatalf("turn events = %v, want %v", eventTypes(*got), want)
	}
}

// A stop mid-request arrives as stopReason "aborted" with errorMessage "Operation aborted"; it is
// a cancellation, not a failure, so no system-error row.
func TestAbortedTurnStillCompletes(t *testing.T) {
	s, got := newEventSession(t)
	for _, ev := range []map[string]any{
		{"type": "agent_start"},
		{"type": "message_end", "message": map[string]any{
			"role": "assistant", "content": []any{}, "stopReason": "aborted", "errorMessage": "Operation aborted",
		}},
		{"type": "agent_end", "willRetry": false},
	} {
		s.handleRawEvent(ev)
	}

	if want := []string{"byspace_turn_completed"}; !slices.Equal(eventTypes(*got), want) {
		t.Fatalf("turn events = %v, want %v", eventTypes(*got), want)
	}
}

// omp shares pi's JSONL RPC transport but not its flags: it has no --extension and no --approve,
// and rejects unknown flags outright, so reusing pi's argument list made it exit immediately.
// A prompt the runtime refuses never reaches a model message, so no other path can report it: the
// turn has to fail here, or the record stays running and the transcript gets no row explaining why.
func TestRefusedPromptFailsTurn(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	tmp := t.TempDir()
	fakePi := filepath.Join(tmp, "fake-pi-refuse.sh")
	script := `#!/bin/sh
read line
echo '{"type":"response","id":"req_1","command":"get_state","success":true,"data":{"sessionId":"pi_refuse","thinkingLevel":"medium","isStreaming":false,"isCompacting":false,"messageCount":0,"pendingMessageCount":0}}'
read line
echo '{"type":"response","id":"req_2","command":"prompt","success":false,"error":"model router refused the prompt"}'
sleep 1
`
	if err := os.WriteFile(fakePi, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sess, err := StartSession(LaunchOptions{Command: fakePi, Cwd: tmp})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	failures := make(chan map[string]any, 4)
	sess.OnEvent(func(ev map[string]any) {
		if ev["type"] == "byspace_turn_failed" {
			failures <- ev
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := sess.GetState(ctx); err != nil {
		t.Fatal(err)
	}
	if err := sess.Prompt(ctx, "hello", nil); err != nil {
		t.Fatal(err)
	}
	if err := sess.WaitForFinish(ctx); err == nil || !strings.Contains(err.Error(), "model router refused the prompt") {
		t.Fatalf("WaitForFinish = %v, want the refusal", err)
	}
	if sess.Status() != "idle" {
		t.Fatalf("refused prompt must settle idle, got %s", sess.Status())
	}

	select {
	case failure := <-failures:
		if failure["error"] != "model router refused the prompt" {
			t.Fatalf("failed turn carries no runtime message: %+v", failure)
		}
		if id, _ := failure["turnId"].(string); id == "" {
			t.Fatalf("failed turn carries no turnId: %+v", failure)
		}
		if token, _ := failure["turnToken"].(string); token == "" {
			t.Fatalf("failed turn carries no turnToken: %+v", failure)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a refused prompt emitted no failed-turn event")
	}
}

// A stop during the retry backoff is a cancellation too, and it reaches the provider with no new
// assistant message: only agent_settled{aborted:true}, while the previous attempt's error is still
// the last one it saw. Reading that error as the turn's outcome would blame the model for a stop.
func TestAbortDuringRetryBackoffCompletes(t *testing.T) {
	s, got := newEventSession(t)
	for _, ev := range []map[string]any{
		{"type": "agent_start"},
		{"type": "message_end", "message": map[string]any{
			"role": "assistant", "content": []any{}, "stopReason": "error", "errorMessage": "429",
		}},
		{"type": "agent_end", "willRetry": true},
		{"type": "agent_settled", "aborted": true},
	} {
		s.handleRawEvent(ev)
	}

	if want := []string{"byspace_turn_completed"}; !slices.Equal(eventTypes(*got), want) {
		t.Fatalf("turn events = %v, want %v", eventTypes(*got), want)
	}
	if s.Status() != "idle" {
		t.Fatalf("aborted turn must settle idle, got %s", s.Status())
	}
}

func TestBuildLaunchArgsSuppressesPiOnlyFlags(t *testing.T) {
	_, argv := BuildLaunchArgs(LaunchOptions{
		Command:            "omp",
		ProtocolMode:       "rpc",
		AppendSystemPrompt: "be brief",
		NoApprove:          true,
	})
	joined := strings.Join(argv, " ")
	for _, banned := range []string{"--extension", "--approve"} {
		if strings.Contains(joined, banned) {
			t.Fatalf("%s must not reach a provider without it: %s", banned, joined)
		}
	}
	if !strings.Contains(joined, "--append-system-prompt") {
		t.Fatalf("the system prompt must be passed as a flag: %s", joined)
	}

	// pi still gets both.
	_, piArgs := BuildLaunchArgs(LaunchOptions{
		Command:        "pi",
		ProtocolMode:   "rpc",
		ExtensionPaths: []string{"/tmp/ext.mjs"},
	})
	piJoined := strings.Join(piArgs, " ")
	if !strings.Contains(piJoined, "--extension") || !strings.Contains(piJoined, "--approve") {
		t.Fatalf("pi needs both flags: %s", piJoined)
	}
}
