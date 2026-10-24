package providers

import (
	"strings"
	"testing"
)

// Three models on one side and sixteen plus aliases on the other meant the picker offered a fraction of
// what the provider has, missing every long-context variant.
func TestClaudeManifestModelsCoverage(t *testing.T) {
	models := ClaudeManifestModels()
	// 14 manifest entries plus one alias (`claude-fable-5[1m]`).
	if len(models) != 15 {
		t.Fatalf("models = %d, want the full manifest (14 entries + 1 alias)", len(models))
	}

	ids := make(map[string]bool, len(models))
	for _, model := range models {
		ids[model.ID] = true
		if model.Provider != "claude" {
			t.Fatalf("%s has provider %q", model.ID, model.Provider)
		}
	}
	// Every long-context variant is present: that is the whole reason a user picks one.
	for _, want := range []string{
		"claude-opus-4-8[1m]", "claude-sonnet-5[1m]", "claude-opus-4-7[1m]",
		"claude-opus-4-6[1m]", "claude-sonnet-4-6[1m]",
		// An alias resolves to its base model but is offered under its own id.
		"claude-fable-5[1m]",
	} {
		if !ids[want] {
			t.Fatalf("missing %q", want)
		}
	}
}

// The default is chosen by defaultPriority, not by position in the list.
func TestClaudeManifestDefaultModel(t *testing.T) {
	var defaults []string
	for _, model := range ClaudeManifestModels() {
		if model.IsDefault {
			defaults = append(defaults, model.ID)
		}
	}
	if len(defaults) != 1 {
		t.Fatalf("defaults = %v", defaults)
	}
	if defaults[0] != "claude-opus-5" {
		t.Fatalf("default = %q, want the highest defaultPriority", defaults[0])
	}
}

// `Off` only when the model accepts disabling thinking; `Ultra Code` only when it declares xhigh.
func TestClaudeThinkingOptions(t *testing.T) {
	byID := make(map[string][]string, 16)
	for _, model := range ClaudeManifestModels() {
		ids := make([]string, 0, len(model.ThinkingOptions))
		for _, option := range model.ThinkingOptions {
			ids = append(ids, option.ID)
			if option.ID == "high" && model.DefaultThinkingOptionID != "high" {
				t.Fatalf("%s: high is the default thinking level", model.ID)
			}
		}
		byID[model.ID] = ids
	}

	// xhigh model: Off, the five levels, then Ultra Code.
	opus5 := byID["claude-opus-5"]
	want := []string{"off", "low", "medium", "high", "xhigh", "max", "ultracode"}
	if strings.Join(opus5, ",") != strings.Join(want, ",") {
		t.Fatalf("opus-5 options = %v, want %v", opus5, want)
	}

	// A standard-effort model has no xhigh and therefore no Ultra Code.
	sonnet46 := byID["claude-sonnet-4-6"]
	for _, id := range sonnet46 {
		if id == "xhigh" || id == "ultracode" {
			t.Fatalf("sonnet-4-6 offers %q but declares standard effort: %v", id, sonnet46)
		}
	}

	// Haiku declares no effort levels: no thinking menu at all rather than a menu of one.
	if got := byID["claude-haiku-4-5"]; len(got) != 0 {
		t.Fatalf("haiku options = %v", got)
	}
}

// Fast mode is per model: enabling it on a model that does not support it makes the provider reject the
// launch, so the toggle has to know.
func TestClaudeModelSupportsFastMode(t *testing.T) {
	for _, supported := range []string{"claude-opus-5", "claude-opus-4-8[1m]", "claude-opus-4-7"} {
		if !ClaudeModelSupportsFastMode(supported) {
			t.Fatalf("%s should support fast mode", supported)
		}
	}
	for _, unsupported := range []string{"claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5", "unknown-model"} {
		if ClaudeModelSupportsFastMode(unsupported) {
			t.Fatalf("%s should not support fast mode", unsupported)
		}
	}
}

// A dated id resolves to its manifest entry so fast mode and thinking options stay correct.
func TestNormalizeClaudeModelID(t *testing.T) {
	if got := normalizeClaudeModelID("claude-opus-4-8-20260101"); got != "claude-opus-4-8" {
		t.Fatalf("dated id = %q", got)
	}
	if got := normalizeClaudeModelID("claude-fable-5[1m]"); got != "claude-fable-5" {
		t.Fatalf("alias = %q", got)
	}
	if got := normalizeClaudeModelID("  claude-opus-5  "); got != "claude-opus-5" {
		t.Fatalf("whitespace = %q", got)
	}
	// An unknown id is returned as-is rather than dropped: the provider may know a model we do not.
	if got := normalizeClaudeModelID("claude-something-new"); got != "claude-something-new" {
		t.Fatalf("unknown = %q", got)
	}
}

// Offering the toggle on a model that does not support it lets the user turn on something the provider
// then rejects at launch, which reads as the provider being broken.
func TestProviderFeaturesForFiltersFastMode(t *testing.T) {
	// A model that supports it keeps the toggle.
	withFast := ProviderFeaturesFor("claude", "claude-opus-5")
	found := false
	for _, feature := range withFast {
		if feature.ID == "fast_mode" {
			found = true
		}
	}
	if !found {
		t.Fatalf("fast mode missing for a supporting model: %+v", withFast)
	}

	// A model that does not support it loses it.
	for _, feature := range ProviderFeaturesFor("claude", "claude-haiku-4-5") {
		if feature.ID == "fast_mode" {
			t.Fatal("fast mode offered on a model that rejects it")
		}
	}

	// No model chosen yet: hide it, then show it once a supporting model is picked.
	for _, feature := range ProviderFeaturesFor("claude", "") {
		if feature.ID == "fast_mode" {
			t.Fatal("fast mode offered before a model is chosen")
		}
	}

	// Another provider's features are unaffected.
	// Codex gates fast mode on its own model list.
	hasFast := func(features []FeatureDefinition) bool {
		for _, feature := range features {
			if feature.ID == "fast_mode" {
				return true
			}
		}
		return false
	}
	if !hasFast(ProviderFeaturesFor("codex", "gpt-5.4")) {
		t.Fatal("codex should offer fast mode on gpt-5.4")
	}
	if hasFast(ProviderFeaturesFor("codex", "gpt-5.3-codex")) {
		t.Fatal("codex should not offer fast mode on gpt-5.3-codex")
	}
}
