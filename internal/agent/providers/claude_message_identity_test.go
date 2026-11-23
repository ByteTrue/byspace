package providers

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/jsonl"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestClaudeTreeEntryForMessageResolvesCanonicalMessageID(t *testing.T) {
	s := &ClaudeSession{
		providerMessageIDs: map[string]string{"client-1": "native-1"},
		timeline: []sdk.TimelineEntry{{
			Item: sdk.TimelineItem{
				Type:            "user_message",
				MessageID:       "msg-1",
				ClientMessageID: "client-1",
				Text:            "hello",
			},
		}},
	}
	got, ok := s.TreeEntryForMessage("msg-1")
	if !ok || got != "native-1" {
		t.Fatalf("TreeEntryForMessage(msg-1) = %q, %v; want native-1, true", got, ok)
	}
}

func TestClaudeIgnoresEventsFromReplacedProcess(t *testing.T) {
	oldProc := &jsonl.Process{}
	currentProc := &jsonl.Process{}
	s := &ClaudeSession{proc: currentProc, status: "idle"}
	s.handleProcessEvent(oldProc, map[string]any{"type": "process_exit", "error": "old process"})
	if got := s.Status(); got != "idle" || s.LastError() != "" {
		t.Fatalf("retired process changed replacement: status=%q error=%q", got, s.LastError())
	}
}

func TestClaudeHistoryLoadsStructuredUserContentAndNativeID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.jsonl")
	line := `{"type":"user","uuid":"native-1","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
`
	if err := os.WriteFile(path, []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	entries, err := LoadClaudeTimelineFromJSONL(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Item.Text != "hello" || entries[0].Item.MessageID != "native-1" {
		t.Fatalf("unexpected history: %#v", entries)
	}
}
