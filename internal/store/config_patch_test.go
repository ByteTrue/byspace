package store

import "testing"

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
