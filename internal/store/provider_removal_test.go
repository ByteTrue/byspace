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

// Providers are persisted under `agents.providers`. A removal that only edited the flat copy
// left the provider on disk: the save returned a config without it, but every later load (the
// next catalog rebuild, a restart) brought it back.
func TestSaveDaemonConfigPersistsProviderRemoval(t *testing.T) {
	st := New(t.TempDir())
	st.SaveDaemonConfig(map[string]any{
		"providers": map[string]any{
			"junie":  map[string]any{"extends": "acp", "command": []any{"junie", "--acp", "true"}},
			"claude": map[string]any{"enabled": false},
		},
	})
	if providers, _ := st.LoadDaemonConfig()["providers"].(map[string]any); providers["junie"] == nil {
		t.Fatal("setup: junie was not saved")
	}

	returned := st.SaveDaemonConfig(map[string]any{"removeProviders": []any{"junie"}})
	if providers, _ := returned["providers"].(map[string]any); providers["junie"] != nil {
		t.Fatal("the save returned a config that still has junie")
	}
	loaded := st.LoadDaemonConfig()
	providers, _ := loaded["providers"].(map[string]any)
	if providers["junie"] != nil {
		t.Fatal("junie came back on the next load: the removal never reached disk")
	}
	if providers["claude"] == nil {
		t.Fatal("claude was removed too; only the named provider may go")
	}
	if _, ok := loaded["removeProviders"]; ok {
		t.Fatal("removeProviders was persisted; it would replay against a provider re-added later")
	}
}
