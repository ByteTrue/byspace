package providers

import (
	"runtime"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestBuildSnapshotEntriesACPRuntimeCatalogOnlyForReadyProviders(t *testing.T) {
	executable := "/bin/sh"
	if runtime.GOOS == "windows" {
		executable = "cmd.exe"
	}
	probed := map[string]bool{}
	entries := BuildSnapshotEntries(func(providerID string) ProviderCatalog {
		probed[providerID] = true
		if providerID != "fake" {
			return ProviderCatalog{}
		}
		return ProviderCatalog{
			Models: []sdk.CatalogModel{{ID: "native", Label: "Native", Provider: providerID}},
			Modes:  []ModeDefinition{{ID: "native-mode", Label: "Native mode"}},
		}
	}, "", map[string]any{
		"fake":    map[string]any{"extends": "acp", "command": []any{executable}},
		"off":     map[string]any{"extends": "acp", "command": []any{executable}, "enabled": false},
		"missing": map[string]any{"extends": "acp", "command": []any{"/nonexistent/acp-provider"}},
	})
	entry := providerSnapshotEntry(t, entries, "fake")
	models := entry["models"].([]sdk.CatalogModel)
	if len(models) != 1 || models[0].ID != "native" {
		t.Fatalf("runtime models did not replace the fallback: %#v", models)
	}
	modes := entry["modes"].([]ModeDefinition)
	if len(modes) != 1 || modes[0].ID != "native-mode" {
		t.Fatalf("runtime modes did not replace the fallback: %#v", modes)
	}
	for _, id := range []string{"off", "missing"} {
		if probed[id] {
			t.Fatalf("unavailable provider %q was probed", id)
		}
	}
}

func TestBuildSnapshotEntriesACPModelOverridesMergeOnce(t *testing.T) {
	executable := "/bin/sh"
	if runtime.GOOS == "windows" {
		executable = "cmd.exe"
	}
	entries := BuildSnapshotEntries(func(providerID string) ProviderCatalog {
		if providerID != "fake" {
			return ProviderCatalog{}
		}
		return ProviderCatalog{
			Models: []sdk.CatalogModel{{ID: "native", Label: "Native"}},
			Modes:  []ModeDefinition{{ID: "native-mode", Label: "Native mode"}},
		}
	}, "", map[string]any{
		"fake": map[string]any{
			"extends": "acp", "command": []any{executable},
			"models":           []any{map[string]any{"id": "configured", "label": "Configured"}},
			"additionalModels": []any{map[string]any{"id": "additional", "label": "Additional"}},
		},
	})
	entry := providerSnapshotEntry(t, entries, "fake")
	models := entry["models"].([]sdk.CatalogModel)
	if len(models) != 2 || models[0].ID != "configured" || models[1].ID != "additional" {
		t.Fatalf("configured overrides were not applied exactly once: %#v", models)
	}
	for _, model := range models {
		if model.Provider != "fake" {
			t.Fatalf("override provider = %q, want fake", model.Provider)
		}
	}
	modes := entry["modes"].([]ModeDefinition)
	if len(modes) != 1 || modes[0].ID != "native-mode" {
		t.Fatalf("model override discarded runtime modes: %#v", modes)
	}
}

func TestBuildSnapshotEntriesACPEmptyProbeKeepsFallback(t *testing.T) {
	executable := "/bin/sh"
	if runtime.GOOS == "windows" {
		executable = "cmd.exe"
	}
	entries := BuildSnapshotEntries(func(string) ProviderCatalog { return ProviderCatalog{} }, "", map[string]any{
		"fake": map[string]any{
			"extends": "acp", "command": []any{executable},
			"models": []any{map[string]any{"id": "configured", "label": "Configured"}},
		},
	})
	entry := providerSnapshotEntry(t, entries, "fake")
	models := entry["models"].([]sdk.CatalogModel)
	if len(models) != 1 || models[0].ID != "configured" {
		t.Fatalf("empty probe discarded the configured fallback: %#v", models)
	}
}

func providerSnapshotEntry(t *testing.T, entries []map[string]any, providerID string) map[string]any {
	t.Helper()
	for _, entry := range entries {
		if entry["provider"] == providerID {
			return entry
		}
	}
	t.Fatalf("missing provider %q", providerID)
	return nil
}
