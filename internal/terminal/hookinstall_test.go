package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Overwriting a file the user wrote would silently delete their work; the node installer checks
// the same marker for the same reason.
func TestEnsureAgentHooksRespectsUserFile(t *testing.T) {
	homeDir := t.TempDir()
	extPath := filepath.Join(homeDir, ".pi", "agent", "extensions", "byspace-terminal-activity.ts")
	if err := os.MkdirAll(filepath.Dir(extPath), 0o755); err != nil {
		t.Fatal(err)
	}
	userContent := "// my own extension\nexport default function mine(pi) {}\n"
	if err := os.WriteFile(extPath, []byte(userContent), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := EnsureAgentHooksInstalled(homeDir); err == nil {
		t.Fatal("expected a refusal for a file BySpace did not write")
	}
	body, _ := os.ReadFile(extPath)
	if string(body) != userContent {
		t.Fatal("the user's file was overwritten")
	}
}

// Our own file is refreshed, and a rerun is a no-op.
func TestEnsureAgentHooksRefreshesOwnFile(t *testing.T) {
	homeDir := t.TempDir()
	extPath := filepath.Join(homeDir, ".pi", "agent", "extensions", "byspace-terminal-activity.ts")
	if err := os.MkdirAll(filepath.Dir(extPath), 0o755); err != nil {
		t.Fatal(err)
	}
	// An older version we wrote: stale body, but our marker.
	stale := agentHookOwnedMarker + "\n// old body\n"
	if err := os.WriteFile(extPath, []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}

	path, err := EnsureAgentHooksInstalled(homeDir)
	if err != nil {
		t.Fatal(err)
	}
	if path != extPath {
		t.Fatalf("path = %q", path)
	}
	body, _ := os.ReadFile(extPath)
	if !strings.Contains(string(body), "byspaceTerminalActivity") {
		t.Fatal("the stale body was not replaced")
	}

	// A second run leaves the file alone.
	info, _ := os.Stat(extPath)
	if _, err := EnsureAgentHooksInstalled(homeDir); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(extPath)
	if !info.ModTime().Equal(after.ModTime()) {
		t.Fatal("a current file should not be rewritten")
	}
}
