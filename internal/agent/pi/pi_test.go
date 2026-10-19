package pi

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
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
