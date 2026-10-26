package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// A provider toggle must not delete the other providers' saved settings.
//
// The settings switch patches `{providers: {codex: {enabled: false}}}`. Replacing the whole
// providers map with that patch dropped every other entry — a custom provider vanished from the
// picker after an unrelated toggle, and the previous model list was gone when the provider was
// switched back on. Node deep-merges its config patches; this is the same rule.
func TestSaveDaemonConfigKeepsSiblingProviderEntries(t *testing.T) {
	s := New(t.TempDir())
	s.SaveDaemonConfig(map[string]any{
		"providers": map[string]any{
			"codex":  map[string]any{"models": []any{"gpt-5"}},
			"custom": map[string]any{"command": []any{"acp-thing"}},
		},
	})

	s.SaveDaemonConfig(map[string]any{
		"providers": map[string]any{"codex": map[string]any{"enabled": false}},
	})

	providers, _ := s.LoadDaemonConfig()["providers"].(map[string]any)
	if _, ok := providers["custom"]; !ok {
		t.Fatalf("providers = %#v; the toggle dropped the other provider", providers)
	}
	codex, _ := providers["codex"].(map[string]any)
	if codex["models"] == nil {
		t.Fatalf("codex = %#v; the toggle dropped its model list", codex)
	}
	if codex["enabled"] != false {
		t.Fatalf("codex enabled = %v, want the toggle itself to apply", codex["enabled"])
	}
}

// Arrays replace rather than merge: a patch that sets a list means the whole list.
func TestSaveDaemonConfigReplacesArrays(t *testing.T) {
	s := New(t.TempDir())
	s.SaveDaemonConfig(map[string]any{"cors": map[string]any{"allowedOrigins": []any{"a", "b"}}})

	s.SaveDaemonConfig(map[string]any{"cors": map[string]any{"allowedOrigins": []any{"c"}}})

	cors, _ := s.LoadDaemonConfig()["cors"].(map[string]any)
	got, _ := cors["allowedOrigins"].([]any)
	if len(got) != 1 || got[0] != "c" {
		t.Fatalf("allowedOrigins = %#v, want just the new list", got)
	}
}

// The merged map must not alias the patch, or a caller that reuses its patch object would edit
// the stored config on its next write.
func TestSaveDaemonConfigDoesNotAliasThePatch(t *testing.T) {
	s := New(t.TempDir())
	s.SaveDaemonConfig(map[string]any{"providers": map[string]any{"codex": map[string]any{"enabled": true}}})

	patch := map[string]any{"providers": map[string]any{"codex": map[string]any{"enabled": false}}}
	saved := s.SaveDaemonConfig(patch)
	patch["providers"].(map[string]any)["codex"].(map[string]any)["enabled"] = "mutated"

	codex, _ := saved["providers"].(map[string]any)["codex"].(map[string]any)
	if codex["enabled"] != false {
		t.Fatalf("codex enabled = %v; the stored config aliases the caller's patch", codex["enabled"])
	}
}

// The settings switch must be able to turn a built-in provider off.
//
// It patches `{providers: {codex: {enabled: false}}}` and nothing else. Validation demanded a
// command/extends/baseUrl on every entry, so this patch was rejected, the daemon logged "needs one
// of command, extends or baseUrl", and the UI showed the switch snapping back — reported as "a
// provider cannot be closed".
func TestBuiltinProviderTogglePassesValidation(t *testing.T) {
	for _, id := range []string{"claude", "codex", "copilot", "opencode", "pi", "omp"} {
		patch := map[string]any{"providers": map[string]any{id: map[string]any{"enabled": false}}}
		if err := ValidateDaemonConfig(patch); err != nil {
			t.Fatalf("toggling built-in %q was rejected: %v", id, err)
		}
	}
}

// A custom provider still needs a way to be launched: the exemption above is about built-ins only.
func TestCustomProviderStillNeedsALaunchMethod(t *testing.T) {
	patch := map[string]any{"providers": map[string]any{"kiro": map[string]any{"enabled": true}}}
	if err := ValidateDaemonConfig(patch); err == nil {
		t.Fatal("a custom provider with no command, extends or baseUrl must still be rejected")
	}
}

// A scripted provider is as switchable as a built-in one.
//
// `mock` is registered only in a development build, and the settings page still renders a switch
// for it. Validation that only knew the six built-ins rejected that toggle with "providers.mock:
// needs one of command, extends or baseUrl" — a second provider the user could not turn off.
func TestServedScriptedProviderTogglePassesValidation(t *testing.T) {
	served := map[string]bool{"claude": true, "mock": true}
	patch := map[string]any{"providers": map[string]any{"mock": map[string]any{"enabled": false}}}
	if err := ValidateDaemonConfigForProviders(patch, served); err != nil {
		t.Fatalf("toggling a served scripted provider was rejected: %v", err)
	}
	// An id the daemon does not serve is still held to the launch-command rule.
	unknown := map[string]any{"providers": map[string]any{"nonesuch": map[string]any{"enabled": false}}}
	if err := ValidateDaemonConfigForProviders(unknown, served); err == nil {
		t.Fatal("an unknown provider with no launch method must still be rejected")
	}
}

// A union-valued key is replaced, never merged.
//
// `skillsSelection` is `{mode:"all"}` or `{mode:"custom", skills:[...]}` — the wire schema closes
// the first against `skills`. Deep-merging `{mode:"all"}` over a stored custom selection left
// `{mode:"all", skills:[...]}`, which no client accepts; the spec that switches from a custom
// selection to "all" failed with the stale skills array still attached, in CI and again on retry.
func TestSkillsSelectionReplacesInsteadOfMerging(t *testing.T) {
	s := New(t.TempDir())
	s.SaveDaemonConfig(map[string]any{
		"skillsSelection": map[string]any{"mode": "custom", "skills": []any{"byspace", "byspace-advisor"}},
	})

	s.SaveDaemonConfig(map[string]any{"skillsSelection": map[string]any{"mode": "all"}})

	sel, _ := s.LoadDaemonConfig()["skillsSelection"].(map[string]any)
	if sel["mode"] != "all" {
		t.Fatalf("mode = %v, want all", sel["mode"])
	}
	if _, stale := sel["skills"]; stale {
		t.Fatalf("skillsSelection = %#v; the previous custom list survived a switch to \"all\"", sel)
	}

	// The reverse has to work too: a custom selection replaces "all" outright.
	s.SaveDaemonConfig(map[string]any{
		"skillsSelection": map[string]any{"mode": "custom", "skills": []any{"byspace"}},
	})
	sel, _ = s.LoadDaemonConfig()["skillsSelection"].(map[string]any)
	got, _ := sel["skills"].([]any)
	if sel["mode"] != "custom" || len(got) != 1 || got[0] != "byspace" {
		t.Fatalf("skillsSelection = %#v, want the new custom selection", sel)
	}
}

// Targets and plugins are replaced, not merged: they are lists, and a list patch means the list.
func TestSkillTargetsAndPluginsReplace(t *testing.T) {
	s := New(t.TempDir())
	s.SaveDaemonConfig(map[string]any{
		"skillTargets": []any{"agents", "claude"},
		"plugins":      []any{"a", "b"},
	})
	s.SaveDaemonConfig(map[string]any{
		"skillTargets": []any{"claude"},
		"plugins":      []any{"c"},
	})

	cfg := s.LoadDaemonConfig()
	targets, _ := cfg["skillTargets"].([]any)
	if len(targets) != 1 || targets[0] != "claude" {
		t.Fatalf("skillTargets = %#v, want just the new list", targets)
	}
	plugins, _ := cfg["plugins"].([]any)
	if len(plugins) != 1 || plugins[0] != "c" {
		t.Fatalf("plugins = %#v, want just the new list", plugins)
	}
}

// A provider toggle must land where the persisted schema and the node daemon put it.
//
// This daemon reads a flat map, so writing `daemon.providers` worked for it and for nothing else:
// a node daemon sharing the home kept showing the other answer, and neither side saw the other's
// change. `PersistedConfigSchema` declares these under `agents`.
func TestAgentSettingsPersistUnderAgents(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	s.SaveDaemonConfig(map[string]any{
		"providers":       map[string]any{"pi": map[string]any{"enabled": false}},
		"metadataGeneration": map[string]any{"providers": []any{"pi"}},
	})

	disk := readConfigFile(t, dir)
	daemon, _ := disk["daemon"].(map[string]any)
	if _, flat := daemon["providers"]; flat {
		t.Fatalf("daemon.providers must not be written: %#v", daemon["providers"])
	}
	agents, _ := disk["agents"].(map[string]any)
	providers, _ := agents["providers"].(map[string]any)
	pi, _ := providers["pi"].(map[string]any)
	if pi["enabled"] != false {
		t.Fatalf("agents.providers = %#v, want pi disabled", providers)
	}
	if _, ok := agents["metadataGeneration"]; !ok {
		t.Fatalf("agents = %#v, want metadataGeneration nested too", agents)
	}

	// And it still reads back as the flat setting, or the settings page would not show it.
	cfg := s.LoadDaemonConfig()
	flatProviders, _ := cfg["providers"].(map[string]any)
	if flatProviders["pi"] == nil {
		t.Fatalf("providers = %#v after reload, want the nested entry lifted", cfg["providers"])
	}
}

// The skills block keeps its `{selection, targets}` shape.
func TestSkillsSelectionPersistsUnderAgentsSkills(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	s.SaveDaemonConfig(map[string]any{
		"skillsSelection": map[string]any{"mode": "all"},
		"skillTargets":    []any{"claude"},
	})

	disk := readConfigFile(t, dir)
	agents, _ := disk["agents"].(map[string]any)
	skills, _ := agents["skills"].(map[string]any)
	selection, _ := skills["selection"].(map[string]any)
	if selection["mode"] != "all" {
		t.Fatalf("agents.skills = %#v, want selection.mode=all", skills)
	}
	// A later flat write must not leave the old record shadowing it.
	s.SaveDaemonConfig(map[string]any{"skillsSelection": map[string]any{"mode": "custom", "skills": []any{"byspace"}}})
	cfg := s.LoadDaemonConfig()
	reloaded, _ := cfg["skillsSelection"].(map[string]any)
	if reloaded["mode"] != "custom" {
		t.Fatalf("skillsSelection = %#v after reload, want the new mode", reloaded)
	}
}

func readConfigFile(t *testing.T, dir string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var disk map[string]any
	if err := json.Unmarshal(b, &disk); err != nil {
		t.Fatal(err)
	}
	return disk
}

// The nested copy wins when a home carries both.
//
// A home written by a build that stored these under `daemon` keeps that flat record. Reading it as
// authoritative means the nested value the node daemon wrote afterwards stays invisible — the exact
// divergence this whole change is about, just in the other direction.
func TestNestedAgentSettingsWinOverAStaleFlatCopy(t *testing.T) {
	dir := t.TempDir()
	writeConfigFile(t, dir, `{
  "version": 1,
  "daemon": {"providers": {"pi": {"enabled": true}}},
  "agents": {"providers": {"pi": {"enabled": false}}}
}`)

	providers, _ := New(dir).LoadDaemonConfig()["providers"].(map[string]any)
	pi, _ := providers["pi"].(map[string]any)
	if pi["enabled"] != false {
		t.Fatalf("pi.enabled = %v, want the nested false to win", pi["enabled"])
	}
}

// The flat record still answers for keys the nested copy does not mention, or an upgrade would
// silently drop a provider the user had only in the old shape.
func TestFlatAgentSettingsStillFillUnmentionedKeys(t *testing.T) {
	dir := t.TempDir()
	writeConfigFile(t, dir, `{
  "version": 1,
  "daemon": {"providers": {"custom": {"enabled": true}, "pi": {"enabled": true}}},
  "agents": {"providers": {"pi": {"enabled": false}}}
}`)

	providers, _ := New(dir).LoadDaemonConfig()["providers"].(map[string]any)
	if providers["custom"] == nil {
		t.Fatalf("providers = %#v, want the flat-only entry kept", providers)
	}
	pi, _ := providers["pi"].(map[string]any)
	if pi["enabled"] != false {
		t.Fatalf("pi.enabled = %v, want the nested value to win", pi["enabled"])
	}
}

func writeConfigFile(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}
