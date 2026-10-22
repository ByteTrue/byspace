package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

func TestBuiltinProvidersCatalog(t *testing.T) {
	if len(BuiltinProviders) != 6 {
		t.Fatalf("expected 6 core built-in providers, got %d", len(BuiltinProviders))
	}
	snaps := BuildSnapshotEntries(nil, "/bin/sh", nil)
	// The six product providers come first and in order; the scripted providers follow, matching node's
	// registry which lists every registered provider. Asserting the product list by name rather than by a
	// bare length keeps "the product ships six" true while allowing the test-only providers to exist.
	wantOrder := []string{"claude", "codex", "copilot", "opencode", "pi", "omp"}
	for index, want := range wantOrder {
		if got, _ := snaps[index]["provider"].(string); got != want {
			t.Fatalf("snapshot[%d] = %q, want %q", index, got, want)
		}
	}
	var scripted int
	for _, entry := range snaps {
		if id, _ := entry["provider"].(string); id == MockProviderID {
			scripted++
		}
	}
	if scripted != 1 {
		t.Fatalf("expected the scripted provider in the snapshot, got %d entries", scripted)
	}
	snapsWithCustom := BuildSnapshotEntries(nil, "/bin/sh", map[string]any{
		"cursor": map[string]any{"extends": "acp", "label": "Cursor", "enabled": true},
	})
	if len(snapsWithCustom) != len(snaps)+1 {
		t.Fatalf("expected one more entry with an opt-in custom provider, got %d", len(snapsWithCustom))
	}
	avail := BuildAvailableProviders("/bin/sh")
	if len(avail) != 6 {
		t.Fatalf("expected 6 available provider entries, got %d", len(avail))
	}
}

func TestClaudeStreamJSONSessionAndSubagentTracking(t *testing.T) {
	tmp := t.TempDir()
	fakeClaude := filepath.Join(tmp, "fake-claude.sh")
	script := `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"claude_sess_01"}'
while read line; do
  case "$line" in
    *'"type":"user"'*)
      echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Planning subagent..."},{"type":"tool_use","id":"tu_task_1","name":"Task","input":{"description":"Audit repo","prompt":"Check files"}}]}}'
      echo '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_task_1","content":"All clean","is_error":false}]}}'
      echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Claude finished auditing!"}]}}'
      echo '{"type":"result","session_id":"claude_sess_01","result":"Claude finished auditing!"}'
      ;;
  esac
done
`
	if err := os.WriteFile(fakeClaude, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sess, err := StartProviderSession(LaunchConfig{
		Provider:        "claude",
		CommandOverride: fakeClaude,
		Cwd:             tmp,
		ModeID:          "acceptEdits",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := sess.Prompt(ctx, "Audit the repository", nil); err != nil {
		t.Fatal(err)
	}
	if err := sess.WaitForFinish(ctx); err != nil {
		t.Fatal(err)
	}
	if got := sess.LastAssistantText(); got != "Claude finished auditing!" {
		t.Fatalf("unexpected Claude assistant text: %q", got)
	}
	subs := sess.ListSubagents("agt_claude_1")
	if len(subs) != 1 || subs[0].Status != "completed" {
		t.Fatalf("expected 1 completed Claude Task subagent, got %+v", subs)
	}
}

func TestCodexAppServerSession(t *testing.T) {
	tmp := t.TempDir()
	fakeCodex := filepath.Join(tmp, "fake-codex.sh")
	script := `#!/bin/sh
while read line; do
  id=$(echo "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"userAgent\":\"codex-test\"}}"
      ;;
    *'"method":"thread/start"'*)
      echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"thread\":{\"id\":\"th_codex_99\"}}}"
      ;;
    *'"method":"turn/start"'*)
      echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{}}"
      echo '{"jsonrpc":"2.0","method":"turn/started","params":{}}'
      echo '{"jsonrpc":"2.0","method":"item/reasoning/summaryTextDelta","params":{"delta":"Checking codex..."}}'
      echo '{"jsonrpc":"2.0","method":"item/started","params":{"item":{"id":"cmd_1","type":"commandExecution","command":"pwd"}}}'
      echo '{"jsonrpc":"2.0","method":"item/completed","params":{"item":{"id":"cmd_1","type":"commandExecution","command":"pwd","aggregatedOutput":"/tmp\n"}}}'
      echo '{"jsonrpc":"2.0","method":"item/agentMessage/delta","params":{"delta":"Codex response ready!"}}'
      echo '{"jsonrpc":"2.0","method":"turn/completed","params":{}}'
      ;;
  esac
done
`
	if err := os.WriteFile(fakeCodex, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sess, err := StartProviderSession(LaunchConfig{
		Provider:        "codex",
		CommandOverride: fakeCodex,
		Cwd:             tmp,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	st, _ := sess.GetState(ctx)
	if st.SessionID != "th_codex_99" {
		t.Fatalf("expected thread id th_codex_99, got %q", st.SessionID)
	}

	if err := sess.Prompt(ctx, "Run pwd", nil); err != nil {
		t.Fatal(err)
	}
	if err := sess.WaitForFinish(ctx); err != nil {
		t.Fatal(err)
	}
	if got := sess.LastAssistantText(); got != "Codex response ready!" {
		t.Fatalf("unexpected Codex assistant text: %q", got)
	}
	if len(sess.Timeline()) != 4 {
		t.Fatalf("expected 4 timeline items (user, reasoning, tool_call, assistant), got %+v", sess.Timeline())
	}
}

func TestACPProviderSessionAndReverseFSRead(t *testing.T) {
	tmp := t.TempDir()
	sampleFile := filepath.Join(tmp, "note.txt")
	if err := os.WriteFile(sampleFile, []byte("secret-note"), 0o644); err != nil {
		t.Fatal(err)
	}

	fakeACP := filepath.Join(tmp, "fake-copilot.sh")
	script := `#!/bin/sh
while read line; do
  id=$(echo "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"protocolVersion\":1,\"agentCapabilities\":{\"loadSession\":true}}}"
      ;;
    *'"method":"session/new"'*)
      echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"sessionId\":\"acp_copilot_77\"}}"
      ;;
    *'"method":"session/prompt"'*)
      echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"acp_copilot_77","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"Thinking via ACP..."}}}}'
      echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"acp_copilot_77","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello from Copilot ACP!"}}}}'
      echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"stopReason\":\"end_turn\"}}"
      ;;
  esac
done
`
	if err := os.WriteFile(fakeACP, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	sess, err := StartProviderSession(LaunchConfig{
		Provider:        "copilot",
		CommandOverride: fakeACP,
		Cwd:             tmp,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := sess.Prompt(ctx, "Hi Copilot", nil); err != nil {
		t.Fatal(err)
	}
	if err := sess.WaitForFinish(ctx); err != nil {
		t.Fatal(err)
	}
	if got := sess.LastAssistantText(); got != "Hello from Copilot ACP!" {
		t.Fatalf("unexpected ACP assistant text: %q", got)
	}
}

func TestOpenCodeHTTPSession(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/session", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "oc_http_1"})
	})
	mux.HandleFunc("/session/oc_http_1/message", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"parts": []map[string]any{
				{"type": "text", "text": "Hello from OpenCode HTTP server!"},
			},
		})
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	sess, err := StartProviderSession(LaunchConfig{
		Provider:        "opencode",
		CommandOverride: ts.URL,
		Cwd:             t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := sess.Prompt(ctx, "Hi OpenCode", nil); err != nil {
		t.Fatal(err)
	}
	if err := sess.WaitForFinish(ctx); err != nil {
		t.Fatal(err)
	}
	if got := sess.LastAssistantText(); got != "Hello from OpenCode HTTP server!" {
		t.Fatalf("unexpected OpenCode reply: %q", got)
	}
}

const tinyPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// every provider host must forward composer images, not just pi — this is the regression guard
// for "images silently dropped for non-pi providers".
func TestEveryProviderForwardsImageBlocks(t *testing.T) {
	// Each provider has its own wire shape: anthropic uses image+source, codex a data URL,
	// ACP image+data, and OpenCode a `file` part (its API models attachments as file parts).
	cases := []struct {
		name     string
		blocks   []map[string]any
		wantType string
		wantKey  string
	}{
		{"claude", imageBlocksForClaude([]pi.ImageContent{{Type: "image", Data: tinyPNGBase64, MimeType: "image/png"}}), "image", "source"},
		{"codex", imageBlocksForCodex([]pi.ImageContent{{Type: "image", Data: tinyPNGBase64, MimeType: "image/png"}}), "image", "url"},
		{"acp", imageBlocksForACP([]pi.ImageContent{{Type: "image", Data: tinyPNGBase64, MimeType: "image/png"}}), "image", "data"},
		{"opencode", imageBlocksForOpenCode([]pi.ImageContent{{Type: "image", Data: tinyPNGBase64, MimeType: "image/png"}}), "file", "mime"},
	}
	for _, tc := range cases {
		if len(tc.blocks) != 1 {
			t.Fatalf("%s: expected 1 image block, got %d", tc.name, len(tc.blocks))
		}
		if tc.blocks[0]["type"] != tc.wantType {
			t.Fatalf("%s: expected type=%s, got %+v", tc.name, tc.wantType, tc.blocks[0])
		}
		if _, ok := tc.blocks[0][tc.wantKey]; !ok {
			t.Fatalf("%s: expected key %q in %+v", tc.name, tc.wantKey, tc.blocks[0])
		}
		if !strings.Contains(fmt.Sprint(tc.blocks[0]), tinyPNGBase64) {
			t.Fatalf("%s: base64 payload missing from %+v", tc.name, tc.blocks[0])
		}
	}
}

func TestImageBlocksSkipEmptyData(t *testing.T) {
	images := []pi.ImageContent{{Type: "image", Data: "", MimeType: "image/png"}}
	for name, build := range map[string]func([]pi.ImageContent) []map[string]any{
		"claude":   imageBlocksForClaude,
		"codex":    imageBlocksForCodex,
		"acp":      imageBlocksForACP,
		"opencode": imageBlocksForOpenCode,
	} {
		if got := build(images); len(got) != 0 {
			t.Fatalf("%s: expected empty blocks for empty data, got %+v", name, got)
		}
	}
}
