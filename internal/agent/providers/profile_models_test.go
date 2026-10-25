package providers

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func modelIDs(models []sdk.CatalogModel) []string {
	out := make([]string, 0, len(models))
	for _, model := range models {
		out = append(out, model.ID)
	}
	return out
}

func TestMergeProviderModelsReplacesCatalog(t *testing.T) {
	cfg := map[string]any{
		"models": []any{
			map[string]any{"id": "profile-model", "label": "Profile model", "isDefault": true},
		},
	}
	runtimeModels := []sdk.CatalogModel{{ID: "probed", Label: "Probed", Provider: "pi"}}

	merged := MergeProviderModels("diagnostic", cfg, runtimeModels)

	// A non-empty `models` list replaces the catalog outright, as provider-registry.ts does. It has to:
	// the point of the list is a provider whose models the user fixed, often before its CLI exists.
	if len(merged) != 1 || merged[0].ID != "profile-model" {
		t.Fatalf("merged models = %v, want only the profile model", modelIDs(merged))
	}
	if merged[0].Provider != "diagnostic" {
		t.Fatalf("provider = %q, want the override id", merged[0].Provider)
	}
	if !merged[0].IsDefault {
		t.Fatalf("profile model lost its default flag: %+v", merged[0])
	}
}

func TestMergeProviderModelsKeepsRuntimeCatalogWithoutProfileModels(t *testing.T) {
	cfg := map[string]any{
		"additionalModels": []any{map[string]any{"id": "extra", "label": "Extra"}},
	}
	runtimeModels := []sdk.CatalogModel{{ID: "probed", Label: "Probed", Provider: "pi", IsDefault: true}}

	merged := MergeProviderModels("pi-custom", cfg, runtimeModels)

	if got := modelIDs(merged); len(got) != 2 || got[0] != "probed" || got[1] != "extra" {
		t.Fatalf("merged models = %v, want [probed extra]", got)
	}
	// An addition that is not marked default must not unset the catalog's default; unsetting it left the
	// picker with no default row and the composer with no model to prefill.
	if !merged[0].IsDefault {
		t.Fatalf("runtime default was dropped: %+v", merged[0])
	}
}

func TestMergeProviderModelsDemotesOtherDefaults(t *testing.T) {
	cfg := map[string]any{
		"additionalModels": []any{map[string]any{"id": "extra", "label": "Extra", "isDefault": true}},
	}
	runtimeModels := []sdk.CatalogModel{{ID: "probed", Label: "Probed", IsDefault: true}}

	merged := MergeProviderModels("pi", cfg, runtimeModels)

	if len(merged) != 2 {
		t.Fatalf("merged = %v", modelIDs(merged))
	}
	// Two models claiming to be the default is not a state the picker can render.
	if merged[0].IsDefault {
		t.Fatalf("runtime default was not demoted: %+v", merged[0])
	}
	if !merged[1].IsDefault {
		t.Fatalf("declared default was not applied: %+v", merged[1])
	}
}

func TestMergeProviderModelsReenablesHiddenModel(t *testing.T) {
	cfg := map[string]any{
		"additionalModels": []any{map[string]any{"id": "hidden", "label": "Hidden again"}},
	}
	runtimeModels := []sdk.CatalogModel{{ID: "hidden", Label: "Hidden", IsSelectable: false}}

	merged := MergeProviderModels("pi", cfg, runtimeModels)

	// Naming a model in `additionalModels` is how a compatibility entry that was hidden becomes
	// selectable again; the addition carries no isSelectable of its own.
	if len(merged) != 1 || !merged[0].IsSelectable {
		t.Fatalf("hidden model was not re-enabled: %+v", merged)
	}
}

func TestResolveProviderSpecWithConfigInheritsExtends(t *testing.T) {
	cfg := map[string]any{"extends": "pi", "label": "Diagnostic", "command": []any{"node", "/tmp/fake-pi.mjs"}}

	spec := ResolveProviderSpecWithConfig("diagnostic", cfg)

	// Inheriting the base runtime is what makes a pi profile speak pi's RPC; the generic ACP fallback
	// launched the wrong protocol, so the profile's models existed but no agent could start.
	if spec.Protocol != "pi-rpc" {
		t.Fatalf("protocol = %q, want pi-rpc", spec.Protocol)
	}
	if spec.Label != "Diagnostic" {
		t.Fatalf("label = %q", spec.Label)
	}
	if spec.Binary != "node" {
		t.Fatalf("binary = %q, want the configured interpreter", spec.Binary)
	}
}

func TestResolveProviderSpecWithConfigACPKeepsGenericTransport(t *testing.T) {
	cfg := map[string]any{"extends": "acp", "command": []any{"my-agent", "--acp"}}

	spec := ResolveProviderSpecWithConfig("my-agent", cfg)

	if spec.Protocol != "acp" {
		t.Fatalf("protocol = %q, want acp", spec.Protocol)
	}
}

func TestProviderSpecForLaunchKeepsCommandTail(t *testing.T) {
	cfg := map[string]any{"extends": "pi", "command": []any{"node", "/tmp/fake-pi.mjs"}}

	_, argv := ProviderSpecForLaunch("diagnostic", cfg)

	// Only the interpreter was kept before, so the provider started `node` with pi's flags and exited.
	if len(argv) != 2 || argv[1] != "/tmp/fake-pi.mjs" {
		t.Fatalf("argv = %v, want the interpreter plus the script", argv)
	}
}

func TestIsConfiguredProvider(t *testing.T) {
	cfg := map[string]any{"providers": map[string]any{"diagnostic": map[string]any{"extends": "pi"}}}

	if !IsConfiguredProvider(cfg, "diagnostic") {
		t.Fatal("configured provider was not reported")
	}
	if IsConfiguredProvider(cfg, "pi") {
		t.Fatal("built-in provider reported as configured")
	}
	if IsConfiguredProvider(nil, "diagnostic") {
		t.Fatal("nil config reported a provider")
	}
}
