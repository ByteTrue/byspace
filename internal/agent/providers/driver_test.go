package providers

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// Every built-in starts enabled; the user switch, not the CLI's presence, decides the default.
func TestBuiltinsStartEnabled(t *testing.T) {
	entries := BuildSnapshotEntries(nil, "", nil)
	byID := make(map[string]bool, len(entries))
	for _, entry := range entries {
		id, _ := entry["provider"].(string)
		enabled, _ := entry["enabled"].(bool)
		byID[id] = enabled
	}

	for _, spec := range BuiltinProviders {
		enabled, present := byID[spec.ID]
		if !present {
			t.Fatalf("%s is missing from the catalog", spec.ID)
		}
		if !enabled {
			t.Fatalf("%s starts disabled; every built-in is on by default", spec.ID)
		}
	}
}

// An explicit user switch still wins over the default.
func TestExplicitDisableOverridesTheDefault(t *testing.T) {
	overrides := map[string]any{"pi": map[string]any{"enabled": false}}
	entries := BuildSnapshotEntries(nil, "", overrides)
	for _, entry := range entries {
		if entry["provider"] != "pi" {
			continue
		}
		if entry["enabled"] != false {
			t.Fatal("turning pi off in config did not disable it")
		}
		return
	}
	t.Fatal("pi is missing from the catalog")
}

// A ready provider's runtime catalog replaces the static spec list; a disabled one is not probed
// at all, because that would spawn a CLI the user switched off.
func TestSnapshotUsesDiscoveredModelsOnlyForReadyProviders(t *testing.T) {
	probed := make(map[string]bool)
	entries := BuildSnapshotEntries(func(providerID string) ProviderCatalog {
		probed[providerID] = true
		if providerID == "pi" {
			return ProviderCatalog{Models: []sdk.CatalogModel{{ID: "probe/one", Label: "Probe One", Provider: "pi"}}}
		}
		return ProviderCatalog{}
	}, "fake-pi", map[string]any{"codex": map[string]any{"enabled": false}})

	if !probed["pi"] {
		t.Fatal("pi was not probed although its override makes it available")
	}
	if probed["codex"] {
		t.Fatal("codex was probed although the user switched it off")
	}

	for _, entry := range entries {
		if entry["provider"] != "pi" {
			continue
		}
		models, _ := entry["models"].([]sdk.CatalogModel)
		if len(models) != 1 || models[0].ID != "probe/one" {
			t.Fatalf("pi models = %+v, want the discovered catalog", models)
		}
		return
	}
	t.Fatal("pi is missing from the snapshot")
}
