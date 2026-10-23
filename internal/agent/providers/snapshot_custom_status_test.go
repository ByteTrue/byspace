package providers

import (
	"runtime"
	"testing"
)

// A configured provider whose executable is gone must report unavailable. Reporting only `enabled` made a provider whose
// CLI had been removed look usable until the first message failed.
func TestCustomProviderStatusProbesItsConfiguredCommand(t *testing.T) {
	entries := BuildSnapshotEntries(nil, "", map[string]any{
		"diag": map[string]any{
			"command": []any{"/nonexistent/provider-node", "/tmp/fake.mjs"},
			"enabled": true,
		},
	})
	if got := entryStatus(t, entries, "diag"); got != "unavailable" {
		t.Fatalf("missing binary reported %q", got)
	}

	// A binary that certainly exists on the host: /bin/sh is a Unix path and Windows has no /bin.
	existing := "/bin/sh"
	if runtime.GOOS == "windows" {
		existing = "cmd.exe"
	}
	present := BuildSnapshotEntries(nil, "", map[string]any{
		"diag": map[string]any{
			"command": []any{existing, "/tmp/fake.mjs"},
			"enabled": true,
		},
	})
	if got := entryStatus(t, present, "diag"); got != "ready" {
		t.Fatalf("existing binary reported %q", got)
	}

	// An explicitly disabled provider stays unavailable regardless of the binary.
	disabled := BuildSnapshotEntries(nil, "", map[string]any{
		"diag": map[string]any{"command": []any{existing}, "enabled": false},
	})
	if got := entryStatus(t, disabled, "diag"); got != "unavailable" {
		t.Fatalf("disabled provider reported %q", got)
	}
}

func entryStatus(t *testing.T, entries []map[string]any, id string) string {
	t.Helper()
	for _, entry := range entries {
		if entry["provider"] == id {
			status, _ := entry["status"].(string)
			return status
		}
	}
	t.Fatalf("provider %q not in the snapshot", id)
	return ""
}
