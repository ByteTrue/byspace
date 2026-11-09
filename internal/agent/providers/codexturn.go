package providers

import "strings"

// Codex turn policy.
//
// The mode, the thinking level and the feature toggles only reach Codex on `turn/start`: thread/start
// does not carry them, and Codex re-reads them per turn. The daemon used to send none of them, so the
// mode picker, the thinking picker and the Fast toggle changed the record and the UI while Codex kept
// running with its own defaults. The shapes below are ported from the node daemon
// (`codex-app-server-agent.ts`, MODE_PRESETS / applyTurnWorkflowPolicy / toSandboxPolicy).

// codexModePreset is what one BySpace mode means to Codex.
type codexModePreset struct {
	approvalPolicy    string
	sandbox           string
	approvalsReviewer string
}

// codexModePresets maps every mode a client can send. `read-only` is not in the built-in mode list
// but older clients and custom profiles still name it.
var codexModePresets = map[string]codexModePreset{
	"read-only":   {approvalPolicy: "on-request", sandbox: "read-only"},
	"auto":        {approvalPolicy: "on-request", sandbox: "workspace-write"},
	"auto-review": {approvalPolicy: "on-request", sandbox: "workspace-write", approvalsReviewer: "auto_review"},
	"full-access": {approvalPolicy: "never", sandbox: "danger-full-access"},
}

// codexSandboxPolicy renders Codex's per-turn sandbox object.
//
// A plain string is not enough: workspace-write carries the network and writable-root decisions the
// user made in the provider sheet, and dropping them silently narrowed the sandbox.
func codexSandboxPolicy(sandbox string, workspaceWrite map[string]any) map[string]any {
	switch sandbox {
	case "read-only":
		return map[string]any{"type": "readOnly"}
	case "danger-full-access":
		return map[string]any{"type": "dangerFullAccess"}
	}
	policy := map[string]any{
		"type":                "workspaceWrite",
		"networkAccess":       false,
		"writableRoots":       []any{},
		"excludeSlashTmp":     false,
		"excludeTmpdirEnvVar": false,
	}
	for key, value := range workspaceWrite {
		switch strings.ReplaceAll(key, "_", "") {
		case "networkaccess":
			policy["networkAccess"] = value
		case "writableroots":
			policy["writableRoots"] = value
		case "excludeslashtmp":
			policy["excludeSlashTmp"] = value
		case "excludetmpdirenvvar":
			policy["excludeTmpdirEnvVar"] = value
		}
	}
	return policy
}

// codexTurnState is everything `turn/start` needs from the session.
type codexTurnState struct {
	ThreadID      string
	Cwd           string
	Model         string
	ModeID        string
	Thinking      string
	FeatureValues map[string]any
	// ProviderOptions may pin approval_policy or sandbox_mode; an explicit user setting outranks
	// the mode preset, the same way the provider sheet does in the app.
	ProviderOptions map[string]any
	// SystemPrompt rides in the collaboration mode's settings; Codex has no top-level parameter.
	SystemPrompt       string
	CollaborationModes []codexCollaborationMode
	OutputSchema       map[string]any
	Input              []map[string]any
}

// codexTurnParams builds the `turn/start` parameters.
//
// Order of precedence follows Codex's own: the mode preset supplies a default, the user's provider
// options override it, and an explicit thinking level or fast tier is added when the model accepts
// it. A model that does not accept fast mode is skipped rather than rejected by the provider.
func codexTurnParams(st codexTurnState) map[string]any {
	params := map[string]any{
		"threadId": st.ThreadID,
		"input":    st.Input,
	}
	if st.Cwd != "" {
		params["cwd"] = st.Cwd
	}
	if st.Model != "" {
		params["model"] = st.Model
	}

	// A mode the client never chose must not become a policy: Codex's own config (sandbox_mode,
	// approval_policy, network access) is the user's answer for an agent that asked for nothing.
	// The node daemon gated the preset the same way (`hasWorkflowModeOverride`).
	modeID := strings.TrimSpace(st.ModeID)
	if modeID != "" {
		if preset, ok := codexModePresets[modeID]; ok {
			if _, pinned := st.ProviderOptions["approval_policy"]; !pinned {
				params["approvalPolicy"] = preset.approvalPolicy
			}
			if preset.approvalsReviewer != "" {
				params["approvalsReviewer"] = preset.approvalsReviewer
			}
		}
	}

	sandbox, pinned := st.ProviderOptions["sandbox_mode"].(string)
	if !pinned && modeID != "" {
		sandbox = codexModePresets[modeID].sandbox
	}
	if sandbox != "" {
		var workspaceWrite map[string]any
		if raw, ok := st.ProviderOptions["sandbox_workspace_write"].(map[string]any); ok {
			workspaceWrite = raw
		}
		params["sandboxPolicy"] = codexSandboxPolicy(sandbox, workspaceWrite)
	}

	if thinking := strings.TrimSpace(st.Thinking); thinking != "" && thinking != "default" {
		params["effort"] = thinking
	}
	if fast, ok := st.FeatureValues["fast_mode"].(bool); ok && fast && CodexModelSupportsFastMode(st.Model) {
		params["serviceTier"] = "fast"
	}
	// The system prompt also has a top-level channel, independent of any collaboration mode: this is
	// what makes it arrive even when the mode list was never fetched.
	if prompt := strings.TrimSpace(st.SystemPrompt); prompt != "" {
		params["developerInstructions"] = prompt
	}
	planMode, _ := st.FeatureValues["plan_mode"].(bool)
	if mode, ok := pickCodexCollaborationMode(st.CollaborationModes, planMode); ok {
		modeID := mode.Mode
		if modeID == "" {
			modeID = "code"
		}
		params["collaborationMode"] = map[string]any{
			"mode":     modeID,
			"settings": codexCollaborationSettings(mode, st),
		}
	}
	if st.OutputSchema != nil {
		params["outputSchema"] = st.OutputSchema
	}
	return params
}

// codexCollaborationMode is one entry of Codex's collaborationMode/list.
//
// `mode` is the value turn/start expects; `name` is only for choosing among entries. The settings
// carry per-mode defaults that Codex otherwise applies on its own.
type codexCollaborationMode struct {
	Name                  string
	Mode                  string
	Model                 string
	ReasoningEffort       string
	DeveloperInstructions string
}

// parseCodexCollaborationModes reads the `collaborationMode/list` response.
func parseCodexCollaborationModes(res map[string]any) []codexCollaborationMode {
	raw, _ := res["data"].([]any)
	out := make([]codexCollaborationMode, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, codexCollaborationMode{
			Name:                  stringField(entry, "name"),
			Mode:                  stringField(entry, "mode"),
			Model:                 stringField(entry, "model"),
			ReasoningEffort:       stringField(entry, "reasoning_effort"),
			DeveloperInstructions: stringField(entry, "developer_instructions"),
		})
	}
	return out
}

func stringField(m map[string]any, key string) string {
	value, _ := m[key].(string)
	return value
}

// pickCodexCollaborationMode chooses between the plan and the ordinary working mode.
//
// Codex names these itself and does not promise a fixed set, so the choice is by name, the same way
// the node daemon made it: "plan"/"read" for planning, "auto"/"code" for ordinary work, and the
// first entry that is neither as a fallback.
func pickCodexCollaborationMode(modes []codexCollaborationMode, plan bool) (codexCollaborationMode, bool) {
	if len(modes) == 0 {
		return codexCollaborationMode{}, false
	}
	contains := func(name string, parts ...string) bool {
		name = strings.ToLower(name)
		for _, part := range parts {
			if strings.Contains(name, part) {
				return true
			}
		}
		return false
	}
	if plan {
		for _, mode := range modes {
			if contains(mode.Name, "plan", "read") {
				return mode, true
			}
		}
		return codexCollaborationMode{}, false
	}
	for _, mode := range modes {
		if contains(mode.Name, "auto", "code") {
			return mode, true
		}
	}
	for _, mode := range modes {
		if !contains(mode.Name, "plan", "read") {
			return mode, true
		}
	}
	return modes[0], true
}

// codexCollaborationSettings builds the settings that ride with a collaboration mode.
//
// The system prompt has no top-level parameter on turn/start: it is the mode's
// developer_instructions. That is why a Codex agent ignored the host-wide append prompt entirely.
func codexCollaborationSettings(mode codexCollaborationMode, st codexTurnState) map[string]any {
	settings := map[string]any{}
	if mode.Model != "" {
		settings["model"] = mode.Model
	}
	if mode.ReasoningEffort != "" {
		settings["reasoning_effort"] = mode.ReasoningEffort
	}
	parts := make([]string, 0, 3)
	for _, part := range []string{mode.DeveloperInstructions, st.SystemPrompt} {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	if len(parts) > 0 {
		settings["developer_instructions"] = strings.Join(parts, "\n\n")
	}
	if st.Model != "" {
		settings["model"] = st.Model
	}
	if thinking := strings.TrimSpace(st.Thinking); thinking != "" && thinking != "default" {
		settings["reasoning_effort"] = thinking
	}
	return settings
}
