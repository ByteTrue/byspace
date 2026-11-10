package providers

import (
	"encoding/json"
	"os"
	"path/filepath"
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

// ClaudeModelsWithSettings returns the manifest models plus every model the user's Claude Code
// settings name.
//
// Claude Code is an Anthropic-compatible client: third-party gateways (Z.AI, a local router, an
// OpenRouter shim) are selected by writing the model id into settings.json — its own picker reads
// `modelPicker.options`, `model` and the `ANTHROPIC_*_MODEL` env keys. The daemon shipped only the
// Anthropic manifest, so those users saw no model they could actually run.
func ClaudeModelsWithSettings() []sdk.CatalogModel {
	models := ClaudeManifestModels()
	seen := make(map[string]bool, len(models))
	for _, model := range models {
		seen[model.ID] = true
	}

	for _, configured := range readClaudeSettingsModels() {
		if seen[configured.ID] {
			continue
		}
		seen[configured.ID] = true
		models = append(models, claudeCustomCatalogModel(configured))
	}
	return models
}

// claudeSettingsModel is one model named in Claude Code's settings.json.
type claudeSettingsModel struct {
	ID          string
	Label       string
	Description string
}

// Claude settings.json keys that name a model. The small/fast and per-family defaults are how
// Claude Code points a gateway at its own model ids.
var claudeSettingsModelEnvKeys = []string{
	"ANTHROPIC_MODEL",
	"ANTHROPIC_SMALL_FAST_MODEL",
	"ANTHROPIC_DEFAULT_FABLE_MODEL",
	"ANTHROPIC_DEFAULT_OPUS_MODEL",
	"ANTHROPIC_DEFAULT_SONNET_MODEL",
	"ANTHROPIC_DEFAULT_HAIKU_MODEL",
}

// claudeConfigDir mirrors Claude Code's own settings location.
func claudeConfigDir() string {
	if dir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude")
}

// readClaudeSettingsModels reads the model ids a user configured, in the order their picker shows
// them: modelPicker options first, then the single `model`, then the per-family env defaults.
//
// A missing or malformed settings file is not an error: the manifest alone is a working catalog,
// and a user editing the file should not lose every model in the picker.
func readClaudeSettingsModels() []claudeSettingsModel {
	path := filepath.Join(claudeConfigDir(), "settings.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var settings struct {
		Model       string         `json:"model"`
		Env         map[string]any `json:"env"`
		ModelPicker struct {
			Options []struct {
				Model       string `json:"model"`
				Label       string `json:"label"`
				Description string `json:"description"`
			} `json:"options"`
		} `json:"modelPicker"`
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return nil
	}

	out := make([]claudeSettingsModel, 0, len(settings.ModelPicker.Options)+len(claudeSettingsModelEnvKeys)+1)
	seen := make(map[string]bool)
	add := func(id, label, description string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		if strings.TrimSpace(label) == "" {
			label = id
		}
		out = append(out, claudeSettingsModel{ID: id, Label: label, Description: description})
	}
	for _, option := range settings.ModelPicker.Options {
		add(option.Model, option.Label, firstNonEmpty(option.Description, "From Claude settings.json modelPicker"))
	}
	add(settings.Model, settings.Model, "From Claude settings.json model")
	for _, key := range claudeSettingsModelEnvKeys {
		value, _ := settings.Env[key].(string)
		add(value, value, "From Claude settings.json env."+key)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// claudeCustomCatalogModel builds a picker entry for a model the manifest does not know.
//
// The gateway accepts the same effort flag as Anthropic's own models, so the standard levels are
// offered; nothing is claimed about fast mode or a context window the model did not declare.
func claudeCustomCatalogModel(configured claudeSettingsModel) sdk.CatalogModel {
	model := sdk.CatalogModel{
		ID:                      configured.ID,
		Label:                   configured.Label,
		Description:             configured.Description,
		Provider:                "claude",
		IsSelectable:            true,
		ThinkingOptions:         claudeThinkingOptions(claudeManifestEntry{EffortLevels: claudeEffortStandard}),
		DefaultThinkingOptionID: claudeDefaultThinkingOptionID,
	}
	if strings.HasSuffix(strings.ToLower(configured.ID), "[1m]") {
		model.Metadata = map[string]string{"contextWindowMaxTokens": "1000000"}
	}
	return model
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
	return ProviderFeaturesForSpec(GetProviderSpec(provider), provider, modelID)
}

// ProviderFeaturesForSpec is ProviderFeaturesFor for a spec that did not come from the built-in
// table — a configured provider inherits its base's features, and `GetProviderSpec` cannot see it.
func ProviderFeaturesForSpec(spec ProviderSpec, provider, modelID string) []FeatureDefinition {
	if len(spec.Features) == 0 {
		return spec.Features
	}
	// Two providers gate fast mode on the model. The gate is named here rather than as a flag on the
	// definition so the definition table stays a description of the provider, not of the client.
	// A configured provider that extends one of them inherits the gate: match on the spec's protocol
	// and id, not the raw provider id, so `my-claude` behaves like `claude`.
	fastModeAvailable := false
	switch {
	case provider == "claude" || spec.ID == "claude" || spec.Protocol == "claude-stream":
		fastModeAvailable = ClaudeModelSupportsFastMode(modelID)
	case provider == "codex" || spec.ID == "codex" || spec.Protocol == "codex-rpc":
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
