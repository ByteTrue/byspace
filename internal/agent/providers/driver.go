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
// (Pi, Claude Code, Codex app-server, OpenCode, and any ACP agent).
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
	// AppendTimelineItem stores one item in the session's own timeline and returns the entry, without
	// broadcasting it. The daemon emits the timeline event itself, so this cannot re-enter the event
	// loop. The entry carries no turn id: the daemon uses it for rows that belong to no turn, such as
	// the system-error row a failed turn leaves behind.
	AppendTimelineItem(item sdk.TimelineItem) sdk.TimelineEntry
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

// BuiltinProviders lists the 4 core built-in agent providers matching AGENT_PROVIDER_DEFINITIONS
// in @bytetrue/protocol/provider-manifest (Claude, Codex, OpenCode, Pi). Every other agent —
// Copilot, Oh My Pi, Cursor, Kimi, Kiro, Trae, Z.AI, Qwen, etc. — is opt-in via "+ Add provider"
// in config.json (extends: "acp" | <builtin>), speaking ACP through the generic host.
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
			{ID: "fast_mode", Label: "Fast Mode", Kind: "toggle", DefaultValue: false},
		},
		// The manifest, not a hand-written list: three models on one side and sixteen plus aliases on
		// the other meant the picker offered a fraction of what the provider has, missing every
		// long-context variant.
		Models: ClaudeManifestModels(),
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
			// The id is `fast_mode` to match the node daemon (and Codex's own feature name). Go had
			// shipped `fast`, which the provider sheet would send back as an unknown toggle.
			{ID: "fast_mode", Label: "Fast", Description: "Priority inference at increased usage", Kind: "toggle", DefaultValue: false},
			{ID: "plan_mode", Label: "Plan", Description: "Switch Codex into planning-only collaboration mode", Kind: "toggle", DefaultValue: false},
		},
		Models: []sdk.CatalogModel{
			{ID: "gpt-5.3-codex", Label: "GPT-5.3 Codex", Provider: "codex", IsDefault: true, IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
			{ID: "gpt-5.2", Label: "GPT-5.2", Provider: "codex", IsSelectable: true, ThinkingOptions: builtinThinkingOptions, DefaultThinkingOptionID: "medium"},
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
}

// GetProviderSpec returns the ProviderSpec for a given provider ID (built-in or generic ACP fallback).
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
	// The scripted providers are addressable by id but are not part of the product's built-in list.
	for _, spec := range registeredTestProviders() {
		if spec.ID == id {
			return spec
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

// ResolveProviderCommand gives process launches the same executable as availability checks.
// An explicit path remains literal; a bare command also searches the standard install locations
// that a desktop app's OS-provided PATH omits.
func ResolveProviderCommand(ctx context.Context, command string) string {
	if resolved := execres.Find(ctx, command); resolved != "" {
		return resolved
	}
	// Preserve the launch error for a missing command instead of turning it into "empty command".
	return command
}

// customProviderBinary is the executable a custom provider will actually launch.
//
// `command` is where the config says so — it may be an array (`[path, args...]`) or a string — and it is what the test
// fixtures rely on: a provider pointed at `provider-node` in a temp directory is unavailable exactly when that file is
// gone. Falling back to the spec's default binary would probe a name the config never mentioned.
func customProviderBinary(cfg map[string]any, spec ProviderSpec) string {
	switch command := cfg["command"].(type) {
	case []any:
		if len(command) > 0 {
			if text, ok := command[0].(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
		}
	case []string:
		if len(command) > 0 && strings.TrimSpace(command[0]) != "" {
			return strings.TrimSpace(command[0])
		}
	case string:
		if trimmed := strings.TrimSpace(command); trimmed != "" {
			return trimmed
		}
	}
	return spec.Binary
}

// ServedProviderIDs returns the provider ids this daemon answers for, including the scripted ones
// a development build registers.
//
// The config validator needs this: it has to accept a plain `{enabled: false}` patch for a provider
// the daemon already serves, scripted ones included, and still require a launch command for any
// other id the user invents.
func ServedProviderIDs() map[string]bool {
	out := make(map[string]bool, len(BuiltinProviders)+1)
	for _, spec := range BuiltinProviders {
		out[spec.ID] = true
	}
	for _, spec := range registeredTestProviders() {
		out[spec.ID] = true
	}
	return out
}

// BuildSnapshotEntries builds the `entries` array for `get_providers_snapshot_response`,
// including the 4 built-in providers plus any custom/derived providers configured in config.json.
//
// discoverCatalog is called only for an enabled provider whose binary resolved, and may be nil.
// Runtime metadata wins over the static spec list; a failed or empty probe keeps the configured fallback.
func BuildSnapshotEntries(discoverCatalog func(providerID string) ProviderCatalog, piCommandOverride string, customProviders map[string]any) []map[string]any {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	entries := make([]map[string]any, 0, len(BuiltinProviders)+len(customProviders))
	builtinSet := make(map[string]bool, len(BuiltinProviders))

	for _, spec := range BuiltinProviders {
		builtinSet[spec.ID] = true
		avail := IsBinaryAvailable(spec, piCommandOverride)
		// `enabled` is the user's switch, not a verdict on the CLI: the app filters its provider
		// lists by it, so deriving it from availability hid every provider whose binary was not on
		// PATH — the import sheet asked only the survivors and read the silence as "no history".
		// Availability belongs in `status`, which is what the UI renders as "not installed".
		enabled := true
		if override, ok := customProviders[spec.ID].(map[string]any); ok {
			if en, hasEn := override["enabled"].(bool); hasEn {
				enabled = en
			}
		}
		status := "unavailable"
		models := spec.Models
		if enabled && avail {
			status = "ready"
			if discoverCatalog != nil {
				if discovered := discoverCatalog(spec.ID); len(discovered.Models) > 0 {
					models = discovered.Models
				}
			}
		}
		entries = append(entries, withCatalog(map[string]any{
			"provider":      spec.ID,
			"label":         spec.Label,
			"status":        status,
			"enabled":       enabled,
			"source":        "builtin",
			"fetchedAt":     now,
			"defaultModeId": spec.DefaultModeID,
			"description":   spec.Description,
		}, models, spec.Modes))
	}

	// The scripted providers follow the built-ins, matching node's registry which lists every registered
	// provider. Their models have to be in the catalog for the model picker to offer them.
	//
	// They are gated exactly like the built-ins: a scripted provider the user switched off in settings
	// has to disappear from the picker. Hardcoding enabled=true here made the settings switch a no-op
	// for `mock` — the toggle wrote the config, the entry ignored it, and the switch snapped back.
	for _, spec := range registeredTestProviders() {
		builtinSet[spec.ID] = true
		enabled := true
		if override, ok := customProviders[spec.ID].(map[string]any); ok {
			if en, hasEn := override["enabled"].(bool); hasEn {
				enabled = en
			}
		}
		status := "unavailable"
		if enabled {
			status = "ready"
		}
		entries = append(entries, withCatalog(map[string]any{
			"provider":    spec.ID,
			"label":       spec.Label,
			"status":      status,
			"enabled":     enabled,
			"source":      "builtin",
			"fetchedAt":   now,
			"description": spec.Description,
		}, spec.Models, spec.Modes))
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
		spec := ResolveProviderSpecWithConfig(id, cfgMap)
		// The config's own model list wins: `models` replaces the catalog and `additionalModels` is merged on top.
		// Ignoring them offered only the generic "<id> Default" row, so the picker could not select the model the
		// config named. A pi-derived provider merges onto pi's probed catalog rather than the placeholder spec.
		runtimeModels := spec.Models
		runtimeModes := spec.Modes
		if spec.Protocol == "pi-rpc" && discoverCatalog != nil {
			if discovered := discoverCatalog("pi"); len(discovered.Models) > 0 {
				runtimeModels = discovered.Models
			}
		}
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
		// Both conditions matter: a configured provider whose binary is gone is unavailable, not ready. Reporting
		// only `enabled` made a provider whose CLI had been removed look usable until the first message failed —
		// and the picker offered it as a choice.
		status := "ready"
		if !enabled {
			status = "unavailable"
		} else if binary := customProviderBinary(cfgMap, spec); binary != "" && !execres.IsCommandAvailable(context.Background(), binary) {
			status = "unavailable"
		}
		if status == "ready" && spec.Protocol == "acp" && discoverCatalog != nil {
			discovered := discoverCatalog(id)
			if len(discovered.Models) > 0 {
				runtimeModels = discovered.Models
			}
			if len(discovered.Modes) > 0 {
				runtimeModes = discovered.Modes
			}
		}
		entries = append(entries, withCatalog(map[string]any{
			"provider":    id,
			"label":       label,
			"status":      status,
			"enabled":     enabled,
			"source":      "custom",
			"fetchedAt":   now,
			"description": desc,
		}, MergeProviderModels(id, cfgMap, runtimeModels), runtimeModes))
	}
	return entries
}

// withCatalog adds a provider's models and modes when it is ready.
//
// Node publishes an unavailable provider (switched off, or its CLI not installed) without a
// catalog: only a ready provider has fetched one. Listing the static models of a provider that
// cannot run made the model picker offer them, and picking one silently did nothing.
func withCatalog(entry map[string]any, models []sdk.CatalogModel, modes []ModeDefinition) map[string]any {
	if entry["status"] == "ready" {
		entry["models"] = models
		entry["modes"] = modes
	}
	return entry
}

// BuildAvailableProviders builds the `providers` array for `list_available_providers_response`.
func BuildAvailableProviders(piCommandOverride string) []map[string]any {
	out := make([]map[string]any, 0, len(BuiltinProviders))
	for _, spec := range BuiltinProviders {
		avail := IsBinaryAvailable(spec, piCommandOverride)
		out = append(out, map[string]any{
			"provider":  spec.ID,
			"available": avail,
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
	ModelProvider    string
	ModeID           string
	ThinkingOptionID string
	SessionHandle    string
	Env              []string
	// ProviderOptions is structured provider configuration the user set in the provider sheet
	// (codex's sandbox_mode / approval_policy, opencode's model provider). Passed through to the
	// adapter; it is not environment variables.
	ProviderOptions map[string]any
	// FeatureValues are the provider's own feature toggles, set by the client at create time. They
	// are a separate protocol field from ProviderOptions, not a key inside it.
	FeatureValues map[string]any
	// SystemPrompt is the daemon-side prompt appended to the provider's own.
	SystemPrompt string
	MCPServers   map[string]sdk.MCPServerConfig
	// HomeDir is where materialised provider images land. Empty disables image output rather
	// than writing somewhere arbitrary.
	HomeDir string
	// ProviderConfig is this provider's entry from the daemon config, if any. It decides `extends`
	// (which runtime the provider inherits: protocol, binary, modes) and the launch argv, which a
	// profile may set to `[interpreter, script]`.
	ProviderConfig map[string]any
}

func resolveProviderLaunch(cfg LaunchConfig) (ProviderSpec, string, []string) {
	spec, argv := ProviderSpecForLaunch(cfg.Provider, cfg.ProviderConfig)
	cmd := strings.TrimSpace(cfg.CommandOverride)
	if cmd == "" {
		envKey := strings.ToUpper(strings.ReplaceAll(spec.ID, "-", "_")) + "_COMMAND"
		cmd = strings.TrimSpace(os.Getenv(envKey))
	}
	if cmd == "" && len(argv) > 0 {
		cmd = argv[0]
	}
	if cmd != "" {
		resolveCommand := cmd
		if spec.Protocol == "opencode-http" && strings.HasSuffix(cmd, " acp") {
			resolveCommand = strings.TrimSuffix(cmd, " acp")
		}
		if !strings.HasPrefix(resolveCommand, "http://") && !strings.HasPrefix(resolveCommand, "https://") {
			resolved := ResolveProviderCommand(context.Background(), resolveCommand)
			if resolveCommand != cmd {
				resolved += " acp"
			}
			cmd = resolved
		}
	}
	return spec, cmd, argv
}

// StartProviderSession launches the appropriate host session for any built-in or custom provider.
func StartProviderSession(cfg LaunchConfig) (ManagedSession, error) {
	spec, cmd, argv := resolveProviderLaunch(cfg)
	// A profile's command may name an interpreter plus the script to run. Dropping the tail started
	// the interpreter with the provider's flags instead of the program the user configured.
	var providerArgs []string
	if len(argv) > 1 {
		providerArgs = argv[1:]
	}
	// Keep the inherited daemon environment intact, but let a resolved JS CLI find its
	// interpreter through /usr/bin/env as well. Nil means "inherit the daemon environment".
	if cfg.Env != nil {
		cfg.Env = execres.AppendStandardDirs(cfg.Env)
	}

	switch spec.Protocol {
	case "pi-rpc":
		// The integration extension is what makes rewind possible: pi exposes entry capture and
		// tree navigation only through extensions, so without it `agent.rewind` has no way to
		// reach the provider.
		extPath, extCleanup, extErr := pi.WriteIntegrationExtension(pi.ExtensionOptions{
			SystemPrompt: cfg.SystemPrompt,
			MCPServers:   cfg.MCPServers,
		})
		if extErr != nil {
			return nil, extErr
		}
		launchModel := cfg.Model
		if cfg.ModelProvider != "" && cfg.Model != "" {
			launchModel = cfg.ModelProvider + "/" + cfg.Model
		}
		sess, err := pi.StartSession(pi.LaunchOptions{
			Command:          cmd,
			Args:             providerArgs,
			Cwd:              cfg.Cwd,
			Env:              cfg.Env,
			Model:            launchModel,
			ThinkingOptionID: cfg.ThinkingOptionID,
			Session:          cfg.SessionHandle,
			ExtensionPaths:   []string{extPath},
			HomeDir:          cfg.HomeDir,
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
		return startCodexSessionWithArgs(cfg, cmd, providerArgs)
	case "mock-native":
		// Scripted provider: no subprocess, no binary. It exists so the end-to-end specs have something that
		// streams deterministically without a model.
		return StartMockSession(MockLaunchOptions{
			Cwd:           cfg.Cwd,
			Model:         cfg.Model,
			ModeID:        cfg.ModeID,
			ThinkingID:    cfg.ThinkingOptionID,
			SessionID:     cfg.SessionHandle,
			FeatureValues: cfg.FeatureValues,
		}), nil
	case "opencode-http":
		return startOpenCodeSessionWithArgs(cfg, cmd, providerArgs)
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
				// Aliases are how the client resolves a remembered model id (findModelByReference), so
				// dropping them here lost the mapping for every client that read the compact snapshot.
				if len(model.Aliases) > 0 {
					m["aliases"] = model.Aliases
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

// IsKnownProvider reports whether id matches a built-in provider.
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
	// A development build serves `mock`; its agents must resume after a restart like any other.
	for _, spec := range registeredTestProviders() {
		if spec.ID == id {
			return true
		}
	}
	return false
}
