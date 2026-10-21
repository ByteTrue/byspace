package providers

import (
	"context"
	"encoding/json"
	"github.com/ByteTrue/byspace/internal/execres"
	"os"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// ManagedSession is the unified runtime interface implemented by every agent provider host
// (Pi, OMP, Claude Code, Codex app-server, ACP family: Copilot/Cursor/Kimi/Kiro/Trae/Generic, and OpenCode).
type ManagedSession interface {
	Status() string
	Timeline() []sdk.TimelineEntry
	SeedTimeline(entries []sdk.TimelineEntry)
	StreamSeq() int
	Usage(ctx context.Context) *sdk.AgentUsage
	// TurnToken identifies the turn that currently owns the session, so a late completion
	// event from a previous turn can be discarded instead of ending the new one.
	TurnToken() string
	LastError() string
	ActiveTurn() (string, string)
	LastAssistantText() string
	SetNextClientMessageID(id string)
	Prompt(ctx context.Context, message string, images []sdk.ImageContent) error
	Steer(ctx context.Context, message string, images []sdk.ImageContent) error
	Abort(ctx context.Context) error
	WaitForFinish(ctx context.Context) error
	GetState(ctx context.Context) (*sdk.SessionState, error)
	SetModel(ctx context.Context, provider, modelID string) (*sdk.Model, error)
	SetThinkingLevel(ctx context.Context, level string) error
	GetCommands(ctx context.Context) ([]sdk.SlashCommand, error)
	PendingPermissions() []map[string]any
	RespondToPermission(requestID string, resp map[string]any) error
	ListSubagents(parentAgentID string) []sdk.SubagentDescriptor
	GetSubagent(parentAgentID, subagentID string) (sdk.SubagentDescriptor, bool)
	OnEvent(fn func(map[string]any)) func()
	Close() error
}

// ModeDefinition describes a selectable provider mode (e.g. plan, default, auto, build).
type ModeDefinition struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Description  string `json:"description,omitempty"`
	Icon         string `json:"icon,omitempty"`
	ColorTier    string `json:"colorTier,omitempty"`
	IsUnattended bool   `json:"isUnattended,omitempty"`
}

// FeatureDefinition describes a provider toggle/select feature.
type FeatureDefinition struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Description  string `json:"description,omitempty"`
	Kind         string `json:"type"` // "toggle" | "select"
	DefaultValue any    `json:"value"`
}

// ProviderSpec defines a built-in or custom agent provider.
type ProviderSpec struct {
	ID            string
	Label         string
	Description   string
	Binary        string
	DefaultArgs   []string
	Protocol      string // "pi-rpc" | "claude-stream" | "codex-rpc" | "acp" | "opencode-http"
	DefaultModeID any
	Modes         []ModeDefinition
	Features      []FeatureDefinition
	Models        []sdk.CatalogModel
}

var builtinThinkingOptions = []sdk.ThinkingOption{
	{ID: "off", Label: "Off"},
	{ID: "low", Label: "Low"},
	{ID: "medium", Label: "Medium"},
	{ID: "high", Label: "High"},
}

// BuiltinProviders lists the 6 core built-in agent providers matching AGENT_PROVIDER_DEFINITIONS
// in @bytetrue/protocol/provider-manifest (Claude, Codex, Copilot, OpenCode, Pi, Oh My Pi).
// Additional ACP or derived providers (Cursor, Kimi, Kiro, Trae, Z.AI, Qwen, etc.) are opt-in
// via "+ Add provider" in config.json (extends: "acp" | <builtin>).
var BuiltinProviders = []ProviderSpec{
	{
		ID:            "claude",
		Label:         "Claude",
		Description:   "Anthropic's official CLI for Claude models",
		Binary:        "claude",
		DefaultArgs:   []string{"-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose"},
		Protocol:      "claude-stream",
		DefaultModeID: "default",
		Modes: []ModeDefinition{
			{ID: "plan", Label: "Plan Mode", Description: "Analyze the codebase without executing tools or edits", Icon: "ShieldEllipsis", ColorTier: "planning"},
			{ID: "default", Label: "Always Ask", Description: "Prompts for permission the first time a tool is used", Icon: "Shield", ColorTier: "safe"},
			{ID: "acceptEdits", Label: "Accept File Edits", Description: "Automatically approves edit-focused tools without prompting", Icon: "ShieldPlus", ColorTier: "moderate"},
			{ID: "auto", Label: "Auto mode", Description: "Uses a model classifier to review permission prompts automatically", Icon: "ShieldCheck", ColorTier: "moderate"},
			{ID: "bypassPermissions", Label: "Bypass", Description: "Skip all permission prompts (use with caution)", Icon: "ShieldOff", ColorTier: "dangerous", IsUnattended: true},
		},
		Features: []FeatureDefinition{
			{ID: "fast", Label: "Fast Mode", Kind: "toggle", DefaultValue: false},
		},
		Models: []sdk.CatalogModel{
			{ID: "claude-sonnet-4-5", Label: "Claude Sonnet 4.5", Provider: "claude", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
			{ID: "claude-opus-4-5", Label: "Claude Opus 4.5", Provider: "claude", IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
			{ID: "claude-haiku-4-5", Label: "Claude Haiku 4.5", Provider: "claude", IsSelectable: true},
		},
	},
	{
		ID:            "codex",
		Label:         "Codex",
		Description:   "OpenAI's lightweight coding agent that runs in your terminal",
		Binary:        "codex",
		DefaultArgs:   []string{"app-server"},
		Protocol:      "codex-rpc",
		DefaultModeID: "auto",
		Modes: []ModeDefinition{
			{ID: "auto", Label: "Default Permissions", Description: "Edit files and run commands with Codex's default approval flow.", Icon: "Shield", ColorTier: "moderate"},
			{ID: "auto-review", Label: "Auto-review", Description: "Same workspace-write permissions as Default, routed through auto-reviewer.", Icon: "ShieldCheck", ColorTier: "moderate"},
			{ID: "full-access", Label: "Full Access", Description: "Edit files, run commands, and access the network without additional prompts.", Icon: "ShieldOff", ColorTier: "dangerous", IsUnattended: true},
		},
		Features: []FeatureDefinition{
			{ID: "fast", Label: "Fast Mode", Kind: "toggle", DefaultValue: false},
		},
		Models: []sdk.CatalogModel{
			{ID: "gpt-5.3-codex", Label: "GPT-5.3 Codex", Provider: "codex", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
			{ID: "gpt-5.2", Label: "GPT-5.2", Provider: "codex", IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
		},
	},
	{
		ID:            "copilot",
		Label:         "Copilot",
		Description:   "GitHub's AI pair programmer with agentic capabilities",
		Binary:        "copilot",
		DefaultArgs:   []string{"--acp"},
		Protocol:      "acp",
		DefaultModeID: "https://agentclientprotocol.com/protocol/session-modes#agent",
		Modes: []ModeDefinition{
			{ID: "https://agentclientprotocol.com/protocol/session-modes#agent", Label: "Agent", Description: "Default agent mode for conversational interactions", Icon: "Shield", ColorTier: "moderate"},
			{ID: "https://agentclientprotocol.com/protocol/session-modes#plan", Label: "Plan", Description: "Plan mode for creating and executing multi-step plans", Icon: "ShieldEllipsis", ColorTier: "planning"},
			{ID: "allow-all", Label: "Allow All", Description: "Automatically approves all Copilot tool, path, and URL requests.", Icon: "ShieldOff", ColorTier: "dangerous", IsUnattended: true},
		},
		Features: []FeatureDefinition{},
		Models: []sdk.CatalogModel{
			{ID: "claude-sonnet-4.5", Label: "Claude Sonnet 4.5", Provider: "copilot", IsDefault: true, IsSelectable: true},
			{ID: "gpt-5", Label: "GPT-5", Provider: "copilot", IsSelectable: true},
		},
	},
	{
		ID:            "opencode",
		Label:         "OpenCode",
		Description:   "Open-source coding assistant with multi-provider model support",
		Binary:        "opencode",
		DefaultArgs:   []string{"serve"},
		Protocol:      "opencode-http",
		DefaultModeID: nil,
		Modes: []ModeDefinition{
			{ID: "build", Label: "Build", Description: "Default mode with full tool access for building and editing", Icon: "Shield", ColorTier: "moderate"},
			{ID: "plan", Label: "Plan", Description: "Read-only planning mode that avoids file edits", Icon: "ShieldEllipsis", ColorTier: "planning"},
		},
		Features: []FeatureDefinition{},
		Models: []sdk.CatalogModel{
			{ID: "anthropic/claude-sonnet-4-5", Label: "Claude Sonnet 4.5", Provider: "opencode", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
		},
	},
	{
		ID:          "pi",
		Label:       "Pi",
		Description: "Minimal terminal-based coding agent with multi-provider LLM support",
		Binary:      "pi",
		DefaultArgs: []string{"--mode", "rpc", "--approve"},
		Protocol:    "pi-rpc",
		Modes:       []ModeDefinition{},
		Features:    []FeatureDefinition{},
		Models:      pi.DefaultFallbackModels(),
	},
	{
		ID:            "omp",
		Label:         "Oh My Pi",
		Description:   "Multi-provider coding agent with native approvals, host tools, and subagents",
		Binary:        "omp",
		DefaultArgs:   []string{"--mode", "rpc"},
		Protocol:      "pi-rpc",
		DefaultModeID: "full",
		Modes: []ModeDefinition{
			{ID: "full", Label: "Full Access", Description: "Launches OMP with yolo approval mode so tools run without prompts.", Icon: "ShieldOff", ColorTier: "dangerous", IsUnattended: true},
			{ID: "write", Label: "Write Approval", Description: "Launches OMP with write approval mode — reads are free, writes require approval.", Icon: "ShieldAlert", ColorTier: "moderate"},
			{ID: "ask", Label: "Always Ask", Description: "Launches OMP with always-ask approval mode for write and exec tools.", Icon: "Shield", ColorTier: "safe"},
		},
		Features: []FeatureDefinition{},
		Models: []sdk.CatalogModel{
			{ID: "default", Label: "OMP Default", Provider: "omp", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
		},
	},
}

// ACPPresets defines known ACP preset specifications when a user adds them via "+ Add provider"
// or launches an agent with their provider ID.
var ACPPresets = map[string]ProviderSpec{
	"cursor": {
		ID:          "cursor",
		Label:       "Cursor",
		Description: "Cursor ACP agent",
		Binary:      "cursor-agent",
		DefaultArgs: []string{"--acp"},
		Protocol:    "acp",
		Modes:       []ModeDefinition{{ID: "agent", Label: "Agent"}, {ID: "plan", Label: "Plan"}},
		Features:    []FeatureDefinition{{ID: "fast", Label: "Fast", Kind: "toggle", DefaultValue: false}},
		Models:      []sdk.CatalogModel{{ID: "default", Label: "Cursor Default", Provider: "cursor", IsDefault: true, IsSelectable: true}},
	},
	"kimi": {
		ID:          "kimi",
		Label:       "Kimi",
		Description: "Kimi Code ACP agent",
		Binary:      "kimi",
		DefaultArgs: []string{"--acp"},
		Protocol:    "acp",
		Modes:       []ModeDefinition{{ID: "agent", Label: "Agent"}},
		Features:    []FeatureDefinition{},
		Models:      []sdk.CatalogModel{{ID: "kimi-k2.5", Label: "Kimi K2.5", Provider: "kimi", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"}},
	},
	"kiro": {
		ID:          "kiro",
		Label:       "Kiro",
		Description: "Kiro ACP agent",
		Binary:      "kiro-cli",
		DefaultArgs: []string{"chat", "--acp"},
		Protocol:    "acp",
		Modes:       []ModeDefinition{{ID: "agent", Label: "Agent"}},
		Features:    []FeatureDefinition{},
		Models:      []sdk.CatalogModel{{ID: "default", Label: "Kiro Default", Provider: "kiro", IsDefault: true, IsSelectable: true}},
	},
	"trae": {
		ID:          "trae",
		Label:       "Trae",
		Description: "Trae ACP agent",
		Binary:      "trae-cli",
		DefaultArgs: []string{"acp"},
		Protocol:    "acp",
		Modes:       []ModeDefinition{{ID: "agent", Label: "Agent"}},
		Features:    []FeatureDefinition{},
		Models:      []sdk.CatalogModel{{ID: "default", Label: "Trae Default", Provider: "trae", IsDefault: true, IsSelectable: true}},
	},
}

// GetProviderSpec returns the ProviderSpec for a given provider ID (built-in, known ACP preset, or generic ACP fallback).
func GetProviderSpec(providerID string) ProviderSpec {
	id := strings.TrimSpace(providerID)
	if id == "" {
		id = "pi"
	}
	for _, p := range BuiltinProviders {
		if p.ID == id {
			return p
		}
	}
	if preset, ok := ACPPresets[id]; ok {
		return preset
	}
	return ProviderSpec{
		ID:          id,
		Label:       id,
		Description: "Custom ACP agent provider",
		Binary:      id,
		DefaultArgs: []string{"--acp"},
		Protocol:    "acp",
		Modes:       []ModeDefinition{{ID: "agent", Label: "Agent"}},
		Features:    []FeatureDefinition{},
		Models: []sdk.CatalogModel{
			{ID: "default", Label: id + " Default", Provider: id, IsDefault: true, IsSelectable: true},
		},
	}
}

// IsBinaryAvailable checks whether a provider binary exists in PATH or via an override env var.
func IsBinaryAvailable(spec ProviderSpec, piCommandOverride string) bool {
	if spec.ID == "pi" && piCommandOverride != "" {
		return true
	}
	envKey := strings.ToUpper(strings.ReplaceAll(spec.ID, "-", "_")) + "_COMMAND"
	if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
		return true
	}
	// LookPath alone returns the first match on PATH, which is not the same as a binary that
	// runs: a stale install earlier in PATH shadows a good one later and the providers page then
	// reports "not installed" for a machine where it plainly is.
	return execres.IsCommandAvailable(context.Background(), spec.Binary)
}

// BuildSnapshotEntries builds the `entries` array for `get_providers_snapshot_response`,
// including the 6 built-in providers plus any custom/derived providers configured in config.json.
func BuildSnapshotEntries(piModels []sdk.CatalogModel, piCommandOverride string, customProviders map[string]any) []map[string]any {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	entries := make([]map[string]any, 0, len(BuiltinProviders)+len(customProviders))
	builtinSet := make(map[string]bool, len(BuiltinProviders))

	for _, spec := range BuiltinProviders {
		builtinSet[spec.ID] = true
		avail := IsBinaryAvailable(spec, piCommandOverride)
		enabled := avail && spec.ID != "omp"
		if override, ok := customProviders[spec.ID].(map[string]any); ok {
			if en, hasEn := override["enabled"].(bool); hasEn {
				enabled = en
			}
		}
		status := "unavailable"
		if enabled && avail {
			status = "ready"
		}
		models := spec.Models
		if spec.ID == "pi" && len(piModels) > 0 {
			models = piModels
		}
		if !enabled {
			models = []sdk.CatalogModel{}
		}
		entries = append(entries, map[string]any{
			"provider":      spec.ID,
			"label":         spec.Label,
			"status":        status,
			"enabled":       enabled,
			"source":        "builtin",
			"fetchedAt":     now,
			"defaultModeId": spec.DefaultModeID,
			"models":        models,
			"modes":         spec.Modes,
			"description":   spec.Description,
		})
	}

	// Append user-added custom/plugin providers (e.g. Cursor, Kimi, Kiro, Trae, Z.AI, etc.)
	for id, rawCfg := range customProviders {
		if builtinSet[id] {
			continue
		}
		cfgMap, ok := rawCfg.(map[string]any)
		if !ok {
			continue
		}
		spec := GetProviderSpec(id)
		label, _ := cfgMap["label"].(string)
		if label == "" {
			label = spec.Label
		}
		desc, _ := cfgMap["description"].(string)
		if desc == "" {
			desc = spec.Description
		}
		enabled := true
		if en, hasEn := cfgMap["enabled"].(bool); hasEn {
			enabled = en
		}
		status := "ready"
		if !enabled {
			status = "unavailable"
		}
		entries = append(entries, map[string]any{
			"provider":    id,
			"label":       label,
			"status":      status,
			"enabled":     enabled,
			"source":      "custom",
			"fetchedAt":   now,
			"models":      spec.Models,
			"modes":       spec.Modes,
			"description": desc,
		})
	}
	return entries
}

// BuildAvailableProviders builds the `providers` array for `list_available_providers_response`.
func BuildAvailableProviders(piCommandOverride string) []map[string]any {
	out := make([]map[string]any, 0, len(BuiltinProviders))
	for _, spec := range BuiltinProviders {
		avail := IsBinaryAvailable(spec, piCommandOverride)
		out = append(out, map[string]any{
			"provider":  spec.ID,
			"available": avail || spec.ID == "pi",
			"error":     nil,
		})
	}
	return out
}

// LaunchConfig holds the parameters needed to start any provider session.
type LaunchConfig struct {
	Provider         string
	CommandOverride  string
	Cwd              string
	Model            string
	ModeID           string
	ThinkingOptionID string
	SessionHandle    string
	Env              []string
	// ProviderOptions is structured provider configuration the user set in the provider sheet
	// (codex's sandbox_mode / approval_policy, opencode's model provider). Passed through to the
	// adapter; it is not environment variables.
	ProviderOptions map[string]any
	// MCPServers are injected through the generated extension; pi has no launch flag for them.
	MCPServers []pi.MCPConfig
	// SystemPrompt is the daemon-side prompt appended to the provider's own.
	SystemPrompt string
	// HomeDir is where materialised provider images land. Empty disables image output rather
	// than writing somewhere arbitrary.
	HomeDir string
}

// StartProviderSession launches the appropriate host session for any built-in or custom provider.
func StartProviderSession(cfg LaunchConfig) (ManagedSession, error) {
	spec := GetProviderSpec(cfg.Provider)
	cmd := strings.TrimSpace(cfg.CommandOverride)
	if cmd == "" {
		envKey := strings.ToUpper(strings.ReplaceAll(spec.ID, "-", "_")) + "_COMMAND"
		cmd = strings.TrimSpace(os.Getenv(envKey))
	}

	switch spec.Protocol {
	case "pi-rpc":
		// omp shares pi's JSONL RPC transport but not its flags: it has no --extension and no
		// --approve, and rejects unknown flags outright, so reusing pi's argument list made it
		// exit immediately. It takes the system prompt as --append-system-prompt instead of
		// through an extension.
		isOMP := spec.ID == "omp"
		if isOMP {
			if cmd == "" {
				cmd = "omp"
			}
			sess, err := pi.StartSession(pi.LaunchOptions{
				Command:            cmd,
				Cwd:                cfg.Cwd,
				Env:                cfg.Env,
				Model:              cfg.Model,
				ThinkingOptionID:   cfg.ThinkingOptionID,
				Session:            cfg.SessionHandle,
				AppendSystemPrompt: cfg.SystemPrompt,
				NoApprove:          true,
			})
			if err != nil {
				return nil, err
			}
			return sess, nil
		}
		// The integration extension is what makes rewind possible: pi exposes entry capture and
		// tree navigation only through extensions, so without it `agent.rewind` has no way to
		// reach the provider.
		extPath, extCleanup, extErr := pi.WriteIntegrationExtension(pi.ExtensionOptions{
			MCPServers:   cfg.MCPServers,
			SystemPrompt: cfg.SystemPrompt,
		})
		if extErr != nil {
			extPath, extCleanup = "", func() {}
		}
		sess, err := pi.StartSession(pi.LaunchOptions{
			Command:          cmd,
			Cwd:              cfg.Cwd,
			Env:              cfg.Env,
			Model:            cfg.Model,
			ThinkingOptionID: cfg.ThinkingOptionID,
			Session:          cfg.SessionHandle,
			ExtensionPaths:   []string{extPath},
		})
		if err != nil {
			extCleanup()
			return nil, err
		}
		sess.SetCleanup(extCleanup)
		return sess, nil
	case "claude-stream":
		return StartClaudeSession(cfg, cmd)
	case "codex-rpc":
		return StartCodexSession(cfg, cmd)
	case "opencode-http":
		return StartOpenCodeSession(cfg, cmd)
	default:
		return StartACPSession(cfg, spec, cmd)
	}
}

// imageBlocksForClaude renders composer images as Anthropic stream-json base64 image blocks.
func imageBlocksForClaude(images []sdk.ImageContent) []map[string]any {
	blocks := make([]map[string]any, 0, len(images))
	for _, img := range images {
		if img.Data == "" {
			continue
		}
		mimeType := img.MimeType
		if mimeType == "" {
			mimeType = "image/png"
		}
		blocks = append(blocks, map[string]any{
			"type": "image",
			"source": map[string]any{
				"type":       "base64",
				"media_type": mimeType,
				"data":       img.Data,
			},
		})
	}
	return blocks
}

// imageBlocksForCodex renders composer images as codex app-server data-URL image inputs.
func imageBlocksForCodex(images []sdk.ImageContent) []map[string]any {
	blocks := make([]map[string]any, 0, len(images))
	for _, img := range images {
		if img.Data == "" {
			continue
		}
		mimeType := img.MimeType
		if mimeType == "" {
			mimeType = "image/png"
		}
		blocks = append(blocks, map[string]any{
			"type": "image",
			"url":  "data:" + mimeType + ";base64," + img.Data,
		})
	}
	return blocks
}

// imageBlocksForACP renders composer images as ACP prompt image blocks.
func imageBlocksForACP(images []sdk.ImageContent) []map[string]any {
	blocks := make([]map[string]any, 0, len(images))
	for _, img := range images {
		if img.Data == "" {
			continue
		}
		mimeType := img.MimeType
		if mimeType == "" {
			mimeType = "image/png"
		}
		blocks = append(blocks, map[string]any{
			"type":     "image",
			"data":     img.Data,
			"mimeType": mimeType,
		})
	}
	return blocks
}

// imageBlocksForOpenCode renders composer images as OpenCode file parts (data URLs).
func imageBlocksForOpenCode(images []sdk.ImageContent) []map[string]any {
	blocks := make([]map[string]any, 0, len(images))
	for _, img := range images {
		if img.Data == "" {
			continue
		}
		mimeType := img.MimeType
		if mimeType == "" {
			mimeType = "image/png"
		}
		blocks = append(blocks, map[string]any{
			"type": "file",
			"mime": mimeType,
			"url":  "data:" + mimeType + ";base64," + img.Data,
		})
	}
	return blocks
}

// BuildCompactSnapshot dedupes thinking option sets so the catalog can be sent without
// repeating the same 7-entry option list on every model of a provider.
//
// Mirrors CompactProviderSnapshotSchema: models drop `provider` (inherited from the entry) and
// `thinkingOptions` (replaced by an index into `thinkingSets`). The app's provider cache reads
// compactSnapshot and rehydrates it; without it every snapshot re-downloads full option lists.
func BuildCompactSnapshot(entries []map[string]any) map[string]any {
	thinkingSets := make([]map[string]any, 0)
	index := make(map[string]int)

	compactEntries := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		out := make(map[string]any, len(entry))
		for k, v := range entry {
			if k == "models" {
				continue
			}
			out[k] = v
		}
		models, _ := entry["models"].([]pi.CatalogModel)
		if len(models) > 0 {
			compact := make([]map[string]any, 0, len(models))
			for _, model := range models {
				m := map[string]any{
					"id":           model.ID,
					"label":        model.Label,
					"isSelectable": model.IsSelectable,
					"isDefault":    model.IsDefault,
				}
				if model.Description != "" {
					m["description"] = model.Description
				}
				if len(model.Metadata) > 0 {
					m["metadata"] = model.Metadata
				}
				if len(model.ThinkingOptions) > 0 {
					key := thinkingSetKey(model.ThinkingOptions, model.DefaultThinkingOptionID)
					idx, ok := index[key]
					if !ok {
						idx = len(thinkingSets)
						index[key] = idx
						thinkingSets = append(thinkingSets, map[string]any{
							"options":         model.ThinkingOptions,
							"defaultOptionId": model.DefaultThinkingOptionID,
						})
					}
					m["thinkingSet"] = idx
				}
				compact = append(compact, m)
			}
			out["models"] = compact
		}
		compactEntries = append(compactEntries, out)
	}

	return map[string]any{
		"entries":      compactEntries,
		"thinkingSets": thinkingSets,
	}
}

func thinkingSetKey(options []pi.ThinkingOption, defaultID string) string {
	b, err := json.Marshal(options)
	if err != nil {
		return defaultID
	}
	return defaultID + "|" + string(b)
}

// IsKnownProvider reports whether id matches a built-in provider or an ACP preset.
//
// Resuming a record whose provider this build does not register cannot work: the command it
// names may not exist, and the resulting failure is an opaque exec error instead of a clear
// "this agent uses a provider you do not have".
func IsKnownProvider(id string) bool {
	if strings.TrimSpace(id) == "" {
		// An empty provider means "pi" for records written before providers were explicit.
		return true
	}
	for _, spec := range BuiltinProviders {
		if spec.ID == id {
			return true
		}
	}
	_, ok := ACPPresets[id]
	return ok
}
