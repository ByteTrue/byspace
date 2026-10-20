package pi

import (
	"context"
	"strings"
)

// CatalogModel represents a BySpace-formatted AgentModelDefinition derived from Pi's model list.
type CatalogModel struct {
	ID                      string            `json:"id"`
	Label                   string            `json:"label"`
	Description             string            `json:"description,omitempty"`
	Provider                string            `json:"provider"`
	Metadata                map[string]string `json:"metadata,omitempty"`
	IsDefault               bool              `json:"isDefault,omitempty"`
	IsSelectable            bool              `json:"isSelectable,omitempty"`
	ThinkingOptions         []ThinkingOption  `json:"thinkingOptions,omitempty"`
	DefaultThinkingOptionID string            `json:"defaultThinkingOptionId,omitempty"`
}

// ThinkingOption represents a selectable reasoning level for a model.
type ThinkingOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	IsDefault   bool   `json:"isDefault,omitempty"`
}

var allPiThinkingOptions = []ThinkingOption{
	{ID: "off", Label: "Off", Description: "No extra reasoning"},
	{ID: "minimal", Label: "Minimal", Description: "Light reasoning"},
	{ID: "low", Label: "Low", Description: "Faster reasoning"},
	{ID: "medium", Label: "Medium", Description: "Balanced reasoning"},
	{ID: "high", Label: "High", Description: "Deeper reasoning"},
	{ID: "xhigh", Label: "XHigh", Description: "Very deep reasoning"},
	{ID: "max", Label: "Max", Description: "Extreme reasoning"},
}

func getSupportedPiThinkingOptions(m Model) ([]ThinkingOption, string) {
	if !m.Reasoning {
		return nil, ""
	}
	var supported []ThinkingOption
	var supportedIndices []int
	for idx, opt := range allPiThinkingOptions {
		if m.ThinkingLevelMap != nil {
			mapped, exists := m.ThinkingLevelMap[opt.ID]
			if exists && mapped == nil {
				continue
			}
			if opt.ID == "xhigh" || opt.ID == "max" {
				if !exists || mapped == nil {
					continue
				}
			}
		} else {
			if opt.ID == "xhigh" || opt.ID == "max" {
				continue
			}
		}
		supported = append(supported, opt)
		supportedIndices = append(supportedIndices, idx)
	}
	if len(supported) == 0 {
		return nil, ""
	}

	// Default level is "medium" (index 3) or the first supported option >= index 3,
	// falling back to the last supported option (matching getDefaultPiThinkingLevel in agent.ts).
	const mediumIndex = 3
	defaultID := supported[len(supported)-1].ID
	for i, origIdx := range supportedIndices {
		if origIdx >= mediumIndex {
			defaultID = supported[i].ID
			break
		}
	}
	for i := range supported {
		if supported[i].ID == defaultID {
			supported[i].IsDefault = true
		}
	}
	return supported, defaultID
}

func normalizePiModelLabel(label string) string {
	trimmed := strings.TrimSpace(label)
	if strings.Contains(trimmed, "/") {
		parts := strings.Split(trimmed, "/")
		trimmed = strings.TrimSpace(parts[len(parts)-1])
	}
	if idx := strings.Index(trimmed, ": "); idx != -1 {
		trimmed = strings.TrimSpace(trimmed[idx+2:])
	}
	return trimmed
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

	st, _ := sess.GetState(ctx)
	var defaultFullID string
	if st != nil && st.Model != nil && st.Model.Provider != "" && st.Model.ID != "" {
		defaultFullID = st.Model.Provider + "/" + st.Model.ID
	}

	rawModels, err := sess.GetAvailableModels(ctx)
	if err != nil {
		return nil, nil, err
	}
	cmds, _ := sess.GetCommands(ctx)

	out := make([]CatalogModel, 0, len(rawModels))
	foundDefault := false
	for _, m := range rawModels {
		if m.Provider == "" || m.ID == "" {
			continue
		}
		fullID := m.Provider + "/" + m.ID
		rawName := strings.TrimSpace(m.Name)
		if rawName == "" {
			rawName = m.ID
		}
		label := normalizePiModelLabel(rawName)
		thinkingOpts, defaultThinkingID := getSupportedPiThinkingOptions(m)
		isDef := defaultFullID != "" && fullID == defaultFullID
		if isDef {
			foundDefault = true
		}
		cm := CatalogModel{
			ID:           fullID,
			Label:        label,
			Description:  fullID,
			Provider:     "pi",
			Metadata:     map[string]string{"provider": m.Provider, "modelId": m.ID},
			IsDefault:    isDef,
			IsSelectable: true,
		}
		if len(thinkingOpts) > 0 {
			cm.ThinkingOptions = thinkingOpts
			cm.DefaultThinkingOptionID = defaultThinkingID
		}
		out = append(out, cm)
	}
	if !foundDefault && len(out) > 0 {
		out[0].IsDefault = true
	}
	return out, cmds, nil
}

// DefaultFallbackModels returns a default selectable Pi model when live probing returns empty.
func DefaultFallbackModels() []CatalogModel {
	opts, defID := getSupportedPiThinkingOptions(Model{Reasoning: true})
	return []CatalogModel{
		{
			ID:                      "default",
			Label:                   "Pi Default",
			Provider:                "pi",
			IsDefault:               true,
			IsSelectable:            true,
			ThinkingOptions:         opts,
			DefaultThinkingOptionID: defID,
		},
	}
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
