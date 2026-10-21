package terminal

import (
	"os"
	"path/filepath"
	"testing"
)

// A shell process cannot be brought back, but the tabs can — so the user reopens the app to the
// terminal they were using instead of an empty panel.
func TestPersistedTerminalsRoundTrip(t *testing.T) {
	homeDir := t.TempDir()
	sessions := []PersistedTerminalSession{
		{ID: "term_1", Cwd: "/repo", WorkspaceID: "ws_1", Name: "dev server"},
		{ID: "term_2", Cwd: "/repo", WorkspaceID: "ws_1", Name: "shell"},
	}
	if err := SavePersistedTerminals(homeDir, sessions); err != nil {
		t.Fatal(err)
	}
	got := LoadPersistedTerminals(homeDir)
	if len(got) != 2 {
		t.Fatalf("got %d sessions", len(got))
	}
	if got[0].ID != "term_1" || got[0].Name != "dev server" || got[0].WorkspaceID != "ws_1" {
		t.Fatalf("lost fields: %+v", got[0])
	}
}

// A broken side file must not stop the daemon from starting.
func TestLoadPersistedTerminalsCorrupt(t *testing.T) {
	homeDir := t.TempDir()
	if err := os.WriteFile(TerminalSessionsFile(homeDir), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := LoadPersistedTerminals(homeDir); got != nil {
		t.Fatalf("corrupt file should read as none, got %+v", got)
	}
}

// An entry without an id or cwd cannot be recreated and would waste a tab slot.
func TestLoadPersistedTerminalsSkipsUnusable(t *testing.T) {
	homeDir := t.TempDir()
	if err := os.WriteFile(TerminalSessionsFile(homeDir),
		[]byte(`[{"id":"a","cwd":"/x"},{"id":"","cwd":"/y"},{"id":"b","cwd":""}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	got := LoadPersistedTerminals(homeDir)
	if len(got) != 1 || got[0].ID != "a" {
		t.Fatalf("got %+v", got)
	}
}

// Saving an empty list must write an array, not null, so a reader does not have to special-case it.
func TestSavePersistedTerminalsEmpty(t *testing.T) {
	homeDir := t.TempDir()
	if err := SavePersistedTerminals(homeDir, nil); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(homeDir, "terminal-sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "null\n" || string(raw) == "null" {
		t.Fatalf("expected an empty array, got %q", raw)
	}
}
