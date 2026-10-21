package providers

import (
	"strconv"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// Claude thinking option ids.
const (
	claudeDefaultThinkingOptionID   = "high"
	claudeDisabledThinkingOptionID  = "off"
	claudeUltraCodeThinkingOptionID = "ultracode"
)

// claudeEffortLabels is the display text for each effort level.
var claudeEffortLabels = map[string]string{
	"low":    "Low",
	"medium": "Medium",
	"high":   "High",
	"xhigh":  "Extra High",
	"max":    "Max",
}

// claudeEffortLevels are the two level sets a model can declare.
//
// `xhigh` exists only on the newer models; a model that does not list it would reject the value, which
// is why the set is per model rather than global.
var (
	claudeEffortStandard = []string{"low", "medium", "high", "max"}
	claudeEffortXHigh    = []string{"low", "medium", "high", "xhigh", "max"}
)

// claudeManifestEntry is one model as the manifest declares it.
type claudeManifestEntry struct {
	ID                       string
	Label                    string
	Description              string
	Aliases                  []string
	ContextWindowMaxTokens   int
	EffortLevels             []string
	SupportsThinkingDisabled bool
	SupportsFastMode         bool
	// DefaultPriority picks the default model: the highest wins. Zero means "not a candidate".
	DefaultPriority int
}

// claudeModelManifest is the model list, in display order.
//
// Ported from claude/model-manifest.ts. Go shipped three models while the node daemon ships sixteen plus
// their aliases, so the Claude model picker was missing most of what the provider offers — including
// every long-context (`[1m]`) variant, which is the whole reason a user picks one.
//
// Ordering is the manifest's own: the picker renders in this order and the default is chosen by
// defaultPriority, not by position.
var claudeModelManifest = []claudeManifestEntry{
	{ID: "claude-opus-5", Label: "Opus 5", DefaultPriority: 2, ContextWindowMaxTokens: 1_000_000,
		EffortLevels: claudeEffortXHigh, SupportsThinkingDisabled: true, SupportsFastMode: true},
	{ID: "claude-fable-5-1", Label: "Fable 5.1", ContextWindowMaxTokens: 1_000_000,
		EffortLevels: claudeEffortXHigh},
	{ID: "claude-fable-5", Label: "Fable 5", Aliases: []string{"claude-fable-5[1m]"},
		ContextWindowMaxTokens: 1_000_000, EffortLevels: claudeEffortXHigh},
	{ID: "claude-opus-4-8[1m]", Label: "Opus 4.8 1M", ContextWindowMaxTokens: 1_000_000,
		EffortLevels: claudeEffortXHigh, SupportsThinkingDisabled: true, SupportsFastMode: true},
	{ID: "claude-opus-4-8", Label: "Opus 4.8", DefaultPriority: 1, ContextWindowMaxTokens: 200_000,
		EffortLevels: claudeEffortXHigh, SupportsThinkingDisabled: true, SupportsFastMode: true},
	{ID: "claude-sonnet-5", Label: "Sonnet 5", ContextWindowMaxTokens: 200_000,
		EffortLevels: claudeEffortXHigh, SupportsThinkingDisabled: true},
	{ID: "claude-sonnet-5[1m]", Label: "Sonnet 5 1M", ContextWindowMaxTokens: 1_000_000,
		EffortLevels: claudeEffortXHigh, SupportsThinkingDisabled: true},
	{ID: "claude-opus-4-7[1m]", Label: "Opus 4.7 1M", ContextWindowMaxTokens: 1_000_000,
		EffortLevels: claudeEffortXHigh, SupportsThinkingDisabled: true, SupportsFastMode: true},
	{ID: "claude-opus-4-7", Label: "Opus 4.7", ContextWindowMaxTokens: 200_000,
		EffortLevels: claudeEffortXHigh, SupportsThinkingDisabled: true, SupportsFastMode: true},
	{ID: "claude-opus-4-6[1m]", Label: "Opus 4.6 1M", ContextWindowMaxTokens: 1_000_000,
		EffortLevels: claudeEffortStandard, SupportsThinkingDisabled: true, SupportsFastMode: true},
	{ID: "claude-opus-4-6", Label: "Opus 4.6", ContextWindowMaxTokens: 200_000,
		EffortLevels: claudeEffortStandard, SupportsThinkingDisabled: true, SupportsFastMode: true},
	{ID: "claude-sonnet-4-6[1m]", Label: "Sonnet 4.6 1M", ContextWindowMaxTokens: 1_000_000,
		EffortLevels: claudeEffortStandard, SupportsThinkingDisabled: true},
	{ID: "claude-sonnet-4-6", Label: "Sonnet 4.6", ContextWindowMaxTokens: 200_000,
		EffortLevels: claudeEffortStandard, SupportsThinkingDisabled: true},
	{ID: "claude-haiku-4-5", Label: "Haiku 4.5", Description: "Haiku 4.5 · Fastest for quick answers",
		ContextWindowMaxTokens: 200_000},
}

// ClaudeManifestModels builds the catalog entries for Claude.
//
// An alias becomes its own entry that resolves to the base model: the provider accepts the alias as a
// model id, so the picker has to offer it, but choosing it must not create a second "model" with its own
// thinking configuration.
func ClaudeManifestModels() []sdk.CatalogModel {
	defaultID := ""
	highestPriority := 0
	for _, entry := range claudeModelManifest {
		if entry.DefaultPriority > highestPriority {
			highestPriority = entry.DefaultPriority
			defaultID = entry.ID
		}
	}

	out := make([]sdk.CatalogModel, 0, len(claudeModelManifest))
	for _, entry := range claudeModelManifest {
		model := sdk.CatalogModel{
			ID:                      entry.ID,
			Label:                   entry.Label,
			Description:             entry.Description,
			Provider:                "claude",
			IsSelectable:            true,
			IsDefault:               entry.ID == defaultID,
			ThinkingOptions:         claudeThinkingOptions(entry),
			DefaultThinkingOptionID: "",
		}
		if len(model.ThinkingOptions) > 0 {
			model.DefaultThinkingOptionID = claudeDefaultThinkingOptionID
		}
		// The catalog schema has no context-window field; the value rides in metadata, which the
		// protocol passes through and the UI reads for the usage ring's denominator.
		if entry.ContextWindowMaxTokens > 0 {
			model.Metadata = map[string]string{
				"contextWindowMaxTokens": strconv.Itoa(entry.ContextWindowMaxTokens),
			}
		}
		out = append(out, model)

		for _, alias := range entry.Aliases {
			// An alias resolves to the same settings, so it carries them. The id is what differs.
			aliased := model
			aliased.ID = alias
			aliased.IsDefault = false
			out = append(out, aliased)
		}
	}
	return out
}

// claudeThinkingOptions builds a model's thinking menu.
//
// Ported from buildThinkingOptions: `Off` only when the model accepts disabling thinking, the effort
// levels it declares, and `Ultra Code` only when it declares `xhigh` (the option is that level in a
// different posture, so a model without it would reject the value).
func claudeThinkingOptions(entry claudeManifestEntry) []sdk.ThinkingOption {
	if len(entry.EffortLevels) == 0 {
		return nil
	}
	out := make([]sdk.ThinkingOption, 0, len(entry.EffortLevels)+2)
	if entry.SupportsThinkingDisabled {
		out = append(out, sdk.ThinkingOption{ID: claudeDisabledThinkingOptionID, Label: "Off"})
	}
	for _, level := range entry.EffortLevels {
		label := claudeEffortLabels[level]
		if label == "" {
			label = level
		}
		out = append(out, sdk.ThinkingOption{ID: level, Label: label})
	}
	for _, level := range entry.EffortLevels {
		if level == "xhigh" {
			out = append(out, sdk.ThinkingOption{ID: claudeUltraCodeThinkingOptionID, Label: "Ultra Code"})
			break
		}
	}
	return out
}

// ClaudeModelSupportsFastMode reports whether a model accepts the fast-mode toggle.
//
// Fast mode is a per-model capability: enabling it on a model that does not support it makes the provider
// reject the launch. An unknown model returns false so the toggle is hidden rather than offered and then
// failing.
func ClaudeModelSupportsFastMode(modelID string) bool {
	normalized := normalizeClaudeModelID(modelID)
	for _, entry := range claudeModelManifest {
		if entry.ID == normalized {
			return entry.SupportsFastMode
		}
	}
	return false
}

// normalizeClaudeModelID resolves an alias or a dated id to its manifest id.
//
// The provider accepts ids like `claude-opus-4-8-20260101`; matching those to the manifest entry keeps
// fast-mode and thinking options correct for a model the user typed by hand.
func normalizeClaudeModelID(modelID string) string {
	trimmed := strings.TrimSpace(modelID)
	if trimmed == "" {
		return ""
	}
	for _, entry := range claudeModelManifest {
		if entry.ID == trimmed {
			return entry.ID
		}
		for _, alias := range entry.Aliases {
			if alias == trimmed {
				return entry.ID
			}
		}
	}
	// A dated suffix: `-YYYYMMDD` at the end.
	if index := strings.LastIndexByte(trimmed, '-'); index > 0 {
		suffix := trimmed[index+1:]
		if len(suffix) == 8 && isAllDigits(suffix) {
			return normalizeClaudeModelID(trimmed[:index])
		}
	}
	return trimmed
}

// isAllDigits reports whether a string is eight decimal digits.
func isAllDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(value) > 0
}

// ProviderFeaturesFor returns a provider's features, filtered to what the chosen model supports.
//
// Ported from buildClaudeFeatures. Fast mode is per model: offering the toggle on a model that does not
// support it lets the user turn on something the provider then rejects at launch, which reads as the
// provider being broken. A provider with no model-specific features returns its list unchanged.
func ProviderFeaturesFor(provider, modelID string) []FeatureDefinition {
	spec := GetProviderSpec(provider)
	if len(spec.Features) == 0 {
		return spec.Features
	}
	// Two providers gate fast mode on the model. The gate is named here rather than as a flag on the
	// definition so the definition table stays a description of the provider, not of the client.
	fastModeAvailable := false
	switch provider {
	case "claude":
		fastModeAvailable = ClaudeModelSupportsFastMode(modelID)
	case "codex":
		fastModeAvailable = CodexModelSupportsFastMode(modelID)
	default:
		return spec.Features
	}

	out := make([]FeatureDefinition, 0, len(spec.Features))
	for _, feature := range spec.Features {
		// The node daemon calls this `fast_mode`; Go shipped `fast`. Both are accepted so an older
		// client that remembers the previous id still finds its toggle.
		if (feature.ID == "fast" || feature.ID == "fast_mode") && !fastModeAvailable {
			continue
		}
		out = append(out, feature)
	}
	return out
}
