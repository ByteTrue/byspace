package providers

import (
	"fmt"
	"strings"
)

// ResolveModelIdentity splits the wire's provider/model form once at the daemon boundary.
// ProviderOptions can supply the provider for a bare model ID; an explicit prefix wins.
func ResolveModelIdentity(agentProvider, combined string, options map[string]any) (string, string, error) {
	combined = strings.TrimSpace(combined)
	provider := firstOptionString(options, "modelProvider", "model_provider", "providerID")
	model := combined
	if before, after, ok := strings.Cut(combined, "/"); ok {
		if strings.TrimSpace(before) == "" || strings.TrimSpace(after) == "" {
			return "", "", fmt.Errorf("invalid model %q: expected provider/model", combined)
		}
		// Native Codex model IDs may contain several slashes. Only split the wire prefixes
		// BySpace itself emits; other prefixes belong to the native model ID.
		if agentProvider != "codex" || before == "openai" || before == "magpie" {
			provider, model = strings.TrimSpace(before), strings.TrimSpace(after)
		}
	}
	if provider == "" {
		switch agentProvider {
		case "pi", "claude":
			provider = "anthropic"
		case "codex":
			// Codex owns its default provider in config.toml. A bare native model id must not
			// override a custom model_provider with openai.
			provider = ""
		default:
			provider = agentProvider
		}
	}
	if strings.ContainsRune(model, 0) || strings.ContainsRune(provider, 0) {
		return "", "", fmt.Errorf("invalid model identity")
	}
	return provider, model, nil
}

func firstOptionString(options map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := options[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
