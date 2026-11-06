package providers

import (
	"runtime"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
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

// Only a ready provider carries a catalog, as in Node: an unavailable one (switched off, or its CLI
// not installed) lists no models or modes, and a custom provider switched off says so.
func TestUnavailableProvidersCarryNoCatalog(t *testing.T) {
	// Disable built-ins whose CLIs may be installed on the development machine or in CI.
	t.Setenv("BYSPACE_NODE_ENV", "development")
	t.Setenv("PATH", t.TempDir())
	entries := BuildSnapshotEntries(nil, "", map[string]any{
		"codex":        map[string]any{"enabled": false},
		MockProviderID: map[string]any{"enabled": false},
		"diag":         map[string]any{"command": []any{"/nonexistent/provider"}, "enabled": false},
	})
	byID := map[string]map[string]any{}
	for _, entry := range entries {
		byID[entry["provider"].(string)] = entry
	}
	for _, id := range []string{"codex", MockProviderID, "diag"} {
		entry := byID[id]
		if entry == nil || entry["status"] != "unavailable" {
			t.Fatalf("%s: %v", id, entry)
		}
		if _, ok := entry["models"]; ok {
			t.Fatalf("%s is unavailable and still lists models", id)
		}
		if _, ok := entry["modes"]; ok {
			t.Fatalf("%s is unavailable and still lists modes", id)
		}
	}
	if byID["diag"]["enabled"] != false {
		t.Fatalf("a custom provider switched off reports enabled=%v", byID["diag"]["enabled"])
	}

	ready := BuildSnapshotEntries(nil, "", nil)
	for _, entry := range ready {
		if entry["provider"] == MockProviderID {
			if models, _ := entry["models"].([]sdk.CatalogModel); entry["status"] != "ready" || len(models) == 0 || entry["modes"] == nil {
				t.Fatalf("a ready provider lost its catalog: %v", entry)
			}
		}
	}
}
