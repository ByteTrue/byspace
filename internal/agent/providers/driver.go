package providers

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// ManagedSession is the unified runtime interface implemented by every agent provider host
// (Pi, OMP, Claude Code, Codex app-server, ACP family: Copilot/Cursor/Kimi/Kiro/Trae/Generic, and OpenCode).
type ManagedSession interface {
	Status() string
	Timeline() []pi.TimelineEntry
	SeedTimeline(entries []pi.TimelineEntry)
	LastAssistantText() string
	Prompt(ctx context.Context, message string, images []pi.ImageContent) error
	Steer(ctx context.Context, message string, images []pi.ImageContent) error
	Abort(ctx context.Context) error
	WaitForFinish(ctx context.Context) error
	GetState(ctx context.Context) (*pi.SessionState, error)
	SetModel(ctx context.Context, provider, modelID string) (*pi.Model, error)
	SetThinkingLevel(ctx context.Context, level string) error
	GetCommands(ctx context.Context) ([]pi.SlashCommand, error)
	PendingPermissions() []map[string]any
	RespondToPermission(requestID string, resp map[string]any) error
	ListSubagents(parentAgentID string) []pi.SubagentDescriptor
	GetSubagent(parentAgentID, subagentID string) (pi.SubagentDescriptor, bool)
	OnEvent(fn func(map[string]any)) func()
	Close() error
}

// ModeDefinition describes a selectable provider mode (e.g. plan, default, auto, build).
type ModeDefinition struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
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
	ID          string
	Label       string
	Description string
	Binary      string
	DefaultArgs []string
	Protocol    string // "pi-rpc" | "claude-stream" | "codex-rpc" | "acp" | "opencode-http"
	Modes       []ModeDefinition
	Features    []FeatureDefinition
	Models      []pi.CatalogModel
}

var builtinThinkingOptions = []pi.ThinkingOption{
	{ID: "off", Label: "Off"},
	{ID: "low", Label: "Low"},
	{ID: "medium", Label: "Medium"},
	{ID: "high", Label: "High"},
}

// BuiltinProviders lists all 10 built-in agent providers supported by BySpace.
var BuiltinProviders = []ProviderSpec{
	{
		ID:          "pi",
		Label:       "Pi",
		Description: "Pi coding agent",
		Binary:      "pi",
		DefaultArgs: []string{"--mode", "rpc", "--approve"},
		Protocol:    "pi-rpc",
		Modes:       []ModeDefinition{},
		Features:    []FeatureDefinition{},
		Models:      pi.DefaultFallbackModels(),
	},
	{
		ID:          "claude",
		Label:       "Claude Code",
		Description: "Anthropic Claude Code CLI agent",
		Binary:      "claude",
		DefaultArgs: []string{"-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose"},
		Protocol:    "claude-stream",
		Modes: []ModeDefinition{
			{ID: "default", Label: "Default", Description: "Prompts for permission on first use of each tool"},
			{ID: "acceptEdits", Label: "Accept Edits", Description: "Automatically accepts file edit permissions for the session"},
			{ID: "plan", Label: "Plan Mode", Description: "Claude can analyze and plan but cannot modify files or execute commands"},
			{ID: "auto", Label: "Auto", Description: "Uses a background safety classifier to review actions before execution"},
			{ID: "bypassPermissions", Label: "Bypass Permissions", Description: "Skips all permission prompts"},
		},
		Features: []FeatureDefinition{
			{ID: "fast", Label: "Fast Mode", Kind: "toggle", DefaultValue: false},
		},
		Models: []pi.CatalogModel{
			{ID: "claude-sonnet-4-5", Label: "Claude Sonnet 4.5", Provider: "claude", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
			{ID: "claude-opus-4-5", Label: "Claude Opus 4.5", Provider: "claude", IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
			{ID: "claude-haiku-4-5", Label: "Claude Haiku 4.5", Provider: "claude", IsSelectable: true},
		},
	},
	{
		ID:          "codex",
		Label:       "Codex",
		Description: "OpenAI Codex CLI agent",
		Binary:      "codex",
		DefaultArgs: []string{"app-server"},
		Protocol:    "codex-rpc",
		Modes: []ModeDefinition{
			{ID: "auto", Label: "Auto", Description: "Balanced autonomous execution with safety checks"},
			{ID: "plan", Label: "Plan", Description: "Read-only planning mode before execution"},
			{ID: "auto-review", Label: "Auto Review", Description: "Autonomous execution with review checkpoints"},
			{ID: "full-access", Label: "Full Access", Description: "Unrestricted command and file execution"},
		},
		Features: []FeatureDefinition{
			{ID: "fast", Label: "Fast Mode", Kind: "toggle", DefaultValue: false},
		},
		Models: []pi.CatalogModel{
			{ID: "gpt-5.3-codex", Label: "GPT-5.3 Codex", Provider: "codex", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
			{ID: "gpt-5.2", Label: "GPT-5.2", Provider: "codex", IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
		},
	},
	{
		ID:          "opencode",
		Label:       "OpenCode",
		Description: "OpenCode AI coding agent",
		Binary:      "opencode",
		DefaultArgs: []string{"serve"},
		Protocol:    "opencode-http",
		Modes: []ModeDefinition{
			{ID: "build", Label: "Build", Description: "Default build and implementation mode"},
			{ID: "plan", Label: "Plan", Description: "Read-only architecture and planning mode"},
		},
		Features: []FeatureDefinition{},
		Models: []pi.CatalogModel{
			{ID: "anthropic/claude-sonnet-4-5", Label: "Claude Sonnet 4.5", Provider: "opencode", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
		},
	},
	{
		ID:          "omp",
		Label:       "Oh My Pi",
		Description: "Oh My Pi coding agent",
		Binary:      "omp",
		DefaultArgs: []string{"--mode", "rpc"},
		Protocol:    "pi-rpc",
		Modes: []ModeDefinition{
			{ID: "full", Label: "Full", Description: "Approve all tool invocations automatically"},
			{ID: "write", Label: "Write", Description: "Allow file writes while prompting for shell commands"},
			{ID: "ask", Label: "Ask", Description: "Prompt before tool execution"},
		},
		Features: []FeatureDefinition{},
		Models: []pi.CatalogModel{
			{ID: "default", Label: "OMP Default", Provider: "omp", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
		},
	},
	{
		ID:          "copilot",
		Label:       "GitHub Copilot",
		Description: "GitHub Copilot ACP agent",
		Binary:      "copilot",
		DefaultArgs: []string{"--acp"},
		Protocol:    "acp",
		Modes: []ModeDefinition{
			{ID: "https://agentclientprotocol.com/protocol/session-modes#agent", Label: "Agent", Description: "Default agent mode for conversational interactions"},
			{ID: "https://agentclientprotocol.com/protocol/session-modes#plan", Label: "Plan", Description: "Plan mode for creating and executing multi-step plans"},
			{ID: "allow-all", Label: "Allow All", Description: "Automatically approves all Copilot tool, path, and URL requests."},
		},
		Features: []FeatureDefinition{},
		Models: []pi.CatalogModel{
			{ID: "claude-sonnet-4.5", Label: "Claude Sonnet 4.5", Provider: "copilot", IsDefault: true, IsSelectable: true},
			{ID: "gpt-5", Label: "GPT-5", Provider: "copilot", IsSelectable: true},
		},
	},
	{
		ID:          "cursor",
		Label:       "Cursor",
		Description: "Cursor ACP agent",
		Binary:      "cursor-agent",
		DefaultArgs: []string{"--acp"},
		Protocol:    "acp",
		Modes: []ModeDefinition{
			{ID: "agent", Label: "Agent", Description: "Cursor agent mode"},
			{ID: "plan", Label: "Plan", Description: "Cursor plan mode"},
		},
		Features: []FeatureDefinition{
			{ID: "fast", Label: "Fast", Kind: "toggle", DefaultValue: false},
		},
		Models: []pi.CatalogModel{
			{ID: "default", Label: "Cursor Default", Provider: "cursor", IsDefault: true, IsSelectable: true},
		},
	},
	{
		ID:          "kimi",
		Label:       "Kimi",
		Description: "Kimi Code ACP agent",
		Binary:      "kimi",
		DefaultArgs: []string{"--acp"},
		Protocol:    "acp",
		Modes: []ModeDefinition{
			{ID: "agent", Label: "Agent", Description: "Kimi agent mode"},
		},
		Features: []FeatureDefinition{},
		Models: []pi.CatalogModel{
			{ID: "kimi-k2.5", Label: "Kimi K2.5", Provider: "kimi", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
		},
	},
	{
		ID:          "kiro",
		Label:       "Kiro",
		Description: "Kiro ACP agent",
		Binary:      "kiro-cli",
		DefaultArgs: []string{"chat", "--acp"},
		Protocol:    "acp",
		Modes: []ModeDefinition{
			{ID: "agent", Label: "Agent", Description: "Kiro agent mode"},
		},
		Features: []FeatureDefinition{},
		Models: []pi.CatalogModel{
			{ID: "default", Label: "Kiro Default", Provider: "kiro", IsDefault: true, IsSelectable: true},
		},
	},
	{
		ID:          "trae",
		Label:       "Trae",
		Description: "Trae ACP agent",
		Binary:      "trae-cli",
		DefaultArgs: []string{"acp"},
		Protocol:    "acp",
		Modes: []ModeDefinition{
			{ID: "agent", Label: "Agent", Description: "Trae agent mode"},
		},
		Features: []FeatureDefinition{},
		Models: []pi.CatalogModel{
			{ID: "default", Label: "Trae Default", Provider: "trae", IsDefault: true, IsSelectable: true},
		},
	},
}

// GetProviderSpec returns the ProviderSpec for a given provider ID (or a generic ACP fallback for custom providers).
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
	return ProviderSpec{
		ID:          id,
		Label:       id,
		Description: "Custom ACP agent provider",
		Binary:      id,
		DefaultArgs: []string{"--acp"},
		Protocol:    "acp",
		Modes:       []ModeDefinition{{ID: "agent", Label: "Agent"}},
		Features:    []FeatureDefinition{},
		Models: []pi.CatalogModel{
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
	_, err := exec.LookPath(spec.Binary)
	return err == nil
}

// BuildSnapshotEntries builds the `entries` array for `get_providers_snapshot_response`.
func BuildSnapshotEntries(piModels []pi.CatalogModel, piCommandOverride string) []map[string]any {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	entries := make([]map[string]any, 0, len(BuiltinProviders))
	for _, spec := range BuiltinProviders {
		avail := IsBinaryAvailable(spec, piCommandOverride)
		status := "ready"
		if !avail {
			status = "unavailable"
		}
		models := spec.Models
		if spec.ID == "pi" && len(piModels) > 0 {
			models = piModels
		}
		entries = append(entries, map[string]any{
			"provider":    spec.ID,
			"label":       spec.Label,
			"status":      status,
			"enabled":     avail || spec.ID == "pi",
			"source":      "builtin",
			"fetchedAt":   now,
			"models":      models,
			"modes":       spec.Modes,
			"description": spec.Description,
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
		if cmd == "" && spec.ID == "omp" {
			cmd = "omp"
		}
		return pi.StartSession(pi.LaunchOptions{
			Command:          cmd,
			Cwd:              cfg.Cwd,
			Env:              cfg.Env,
			Model:            cfg.Model,
			ThinkingOptionID: cfg.ThinkingOptionID,
			Session:          cfg.SessionHandle,
		})
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
