package store

import "testing"

// removeProviders is an instruction, not state: Node applies it to the providers map and drops
// it. Persisting it would replay the removal against a provider the user later re-adds.
func TestDropRemovedProvidersDropsTheEntryAndTheInstruction(t *testing.T) {
	patch := map[string]any{
		"removeProviders": []any{"junie"},
		"providers": map[string]any{
			"junie":  map[string]any{"command": "/opt/junie"},
			"claude": map[string]any{"command": "/opt/claude"},
		},
	}
	out := dropRemovedProviders(patch)

	if _, ok := out["removeProviders"]; ok {
		t.Fatal("removeProviders survived; it would be persisted and replay later")
	}
	providers, _ := out["providers"].(map[string]any)
	if _, ok := providers["junie"]; ok {
		t.Fatal("junie was not removed")
	}
	if _, ok := providers["claude"]; !ok {
		t.Fatal("claude was removed too; only the named provider may go")
	}
}

func TestDropRemovedProvidersKeepsPatchesWithoutRemovals(t *testing.T) {
	patch := map[string]any{"providers": map[string]any{"junie": map[string]any{"command": "x"}}}
	out := dropRemovedProviders(patch)

	providers, _ := out["providers"].(map[string]any)
	if _, ok := providers["junie"]; !ok {
		t.Fatal("a patch without removeProviders must not drop providers")
	}
}
