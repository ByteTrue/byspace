package providers

import "strings"

// codexFastModeModels are the models that accept Codex's fast mode.
//
// Ported from codex-feature-definitions.ts, which cites developers.openai.com/codex/speed. Fast mode is
// priority inference at increased usage — a per-model product tier, not a client-side flag — so offering
// it on an unsupported model makes the provider reject the turn.
var codexFastModeModels = map[string]bool{
	"gpt-6-astra":   true,
	"gpt-5.6":       true,
	"gpt-5.6-sol":   true,
	"gpt-5.6-terra": true,
	"gpt-5.6-luna":  true,
	"gpt-5.5":       true,
	"gpt-5.4":       true,
}

// CodexModelSupportsFastMode reports whether a model accepts fast mode.
//
// An unknown or empty model returns false: the toggle is hidden rather than offered and then rejected.
func CodexModelSupportsFastMode(modelID string) bool {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return false
	}
	return codexFastModeModels[normalized]
}
