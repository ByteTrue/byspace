package pi

import (
	"context"
	"strings"
)

// CatalogModel represents a BySpace-formatted AgentModelDefinition derived from Pi's model list.
type CatalogModel struct {
	ID                      string           `json:"id"`
	Label                   string           `json:"label"`
	Provider                string           `json:"provider"`
	ThinkingOptions         []ThinkingOption `json:"thinkingOptions,omitempty"`
	DefaultThinkingOptionID string           `json:"defaultThinkingOptionId,omitempty"`
}

// ThinkingOption represents a selectable reasoning level for a model.
type ThinkingOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

var defaultThinkingOptions = []ThinkingOption{
	{ID: "off", Label: "Off"},
	{ID: "minimal", Label: "Minimal"},
	{ID: "low", Label: "Low"},
	{ID: "medium", Label: "Medium"},
	{ID: "high", Label: "High"},
	{ID: "xhigh", Label: "Extra High"},
}

// ProbeCatalog starts a short-lived no-session Pi RPC process, queries its available
// models and slash commands, and shuts it down.
func ProbeCatalog(ctx context.Context, opts LaunchOptions) ([]CatalogModel, []SlashCommand, error) {
	opts.NoSession = true
	sess, err := StartSession(opts)
	if err != nil {
		return nil, nil, err
	}
	defer sess.Close()

	rawModels, err := sess.GetAvailableModels(ctx)
	if err != nil {
		return nil, nil, err
	}
	cmds, _ := sess.GetCommands(ctx)

	out := make([]CatalogModel, 0, len(rawModels))
	for _, m := range rawModels {
		if m.Provider == "" || m.ID == "" {
			continue
		}
		fullID := m.Provider + "/" + m.ID
		label := strings.TrimSpace(m.Name)
		if label == "" {
			label = fullID
		}
		cm := CatalogModel{
			ID:       fullID,
			Label:    label,
			Provider: "pi",
		}
		if m.Reasoning {
			cm.ThinkingOptions = defaultThinkingOptions
			cm.DefaultThinkingOptionID = "medium"
		}
		out = append(out, cm)
	}
	return out, cmds, nil
}

// SplitModelID splits a combined "provider/modelId" string into its two parts.
// If no slash is present, provider defaults to "anthropic".
func SplitModelID(combined string) (provider, modelID string) {
	trimmed := strings.TrimSpace(combined)
	if p, m, ok := strings.Cut(trimmed, "/"); ok && p != "" && m != "" {
		return p, m
	}
	return "anthropic", trimmed
}
