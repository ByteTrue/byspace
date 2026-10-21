package pi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// `!command` typed by the user in the terminal is recorded by pi as its own message role.
// Without handling it the command and its output vanish from an imported session, and the
// transcript jumps from the prompt to a reply with no visible cause.
func TestHistoryImportKeepsBashExecution(t *testing.T) {
	dir := t.TempDir()
	sessionFile := filepath.Join(dir, "session.jsonl")
	lines := []string{
		`{"type":"session","id":"s1","timestamp":1700000000000}`,
		`{"type":"message","timestamp":1700000001000,"message":{"role":"user","content":[{"type":"text","text":"run the tests"}]}}`,
		`{"type":"message","timestamp":1700000002000,"message":{"role":"bashExecution","command":"npm test","output":"all green","exitCode":0}}`,
		`{"type":"message","timestamp":1700000003000,"message":{"role":"assistant","content":[{"type":"text","text":"tests pass"}]}}`,
	}
	if err := os.WriteFile(sessionFile, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	entries, err := LoadTimelineFromJSONL(sessionFile)
	if err != nil {
		t.Fatal(err)
	}
	var sawBash bool
	for _, entry := range entries {
		if entry.Item.Type == "tool_call" && entry.Item.Name == "bash" {
			sawBash = true
			if entry.Item.Status != "completed" {
				t.Fatalf("status = %q", entry.Item.Status)
			}
			if !strings.Contains(entry.Item.CallID, "pi-bash-") {
				t.Fatalf("callId = %q", entry.Item.CallID)
			}
		}
	}
	if !sawBash {
		t.Fatalf("the bash execution was dropped; entries: %+v", entries)
	}
}

// A custom message has no role a client can render; its text must not appear as a user bubble
// nobody typed.
func TestHistoryImportSkipsCustomMessages(t *testing.T) {
	dir := t.TempDir()
	sessionFile := filepath.Join(dir, "session.jsonl")
	lines := []string{
		`{"type":"session","id":"s2","timestamp":1700000000000}`,
		`{"type":"message","timestamp":1700000001000,"message":{"role":"custom","customType":"byspace","content":[{"type":"text","text":"injected system note"}]}}`,
	}
	if err := os.WriteFile(sessionFile, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	entries, err := LoadTimelineFromJSONL(sessionFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Item.Text, "injected system note") {
			t.Fatalf("a custom message leaked into the transcript: %+v", entry.Item)
		}
	}
}

// A repository that pins its own session directory did so on purpose; without reading the setting the
// daemon lists the default directory and shows no sessions to the user who moved them.
func TestResolveSessionsDirHonoursSettings(t *testing.T) {
	home := t.TempDir()
	agentDir := filepath.Join(home, ".pi", "agent")
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		t.Fatal(err)
	}
	configured := filepath.Join(home, "moved-sessions")
	if err := os.WriteFile(filepath.Join(agentDir, "settings.json"),
		[]byte(`{"sessionDir":"`+configured+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PI_CODING_AGENT_DIR", agentDir)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", "")

	if got := ResolveSessionsDir(""); got != configured {
		t.Fatalf("sessions dir = %q, want the configured one %q", got, configured)
	}

	// An explicit argument still wins over everything.
	if got := ResolveSessionsDir("/explicit"); got != "/explicit" {
		t.Fatalf("explicit = %q", got)
	}
}

// A malformed settings file falls back to the default rather than failing.
func TestReadConfiguredSessionDirToleratesJunk(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"broken.json": "{not json",
		"array.json":  `[]`,
		"no-key.json": `{"other":1}`,
		"empty.json":  `{"sessionDir":"   "}`,
		"nonstr.json": `{"sessionDir":42}`,
	} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := readConfiguredSessionDir(path); got != "" {
			t.Fatalf("%s = %q, want empty", name, got)
		}
	}
	if got := readConfiguredSessionDir(filepath.Join(dir, "missing.json")); got != "" {
		t.Fatalf("missing = %q", got)
	}
}
