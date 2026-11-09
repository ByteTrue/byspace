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

const defaultCodexModeID = "auto"

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
	OutputSchema    map[string]any
	Input           []map[string]any
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

	modeID := strings.TrimSpace(st.ModeID)
	if modeID == "" {
		modeID = defaultCodexModeID
	}
	if preset, ok := codexModePresets[modeID]; ok {
		if _, pinned := st.ProviderOptions["approval_policy"]; !pinned {
			params["approvalPolicy"] = preset.approvalPolicy
		}
		if preset.approvalsReviewer != "" {
			params["approvalsReviewer"] = preset.approvalsReviewer
		}
	}

	sandbox, pinned := st.ProviderOptions["sandbox_mode"].(string)
	if !pinned {
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
	if st.OutputSchema != nil {
		params["outputSchema"] = st.OutputSchema
	}
	return params
}
