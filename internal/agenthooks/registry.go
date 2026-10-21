package agenthooks

// Providers lists every agent CLI whose hooks BySpace can install.
//
// The event name to state mapping lives in internal/cli/hooks.go (the shim the command calls), so
// the two halves cannot drift: installing an event that the shim does not understand would run a
// command that reports nothing.
var Providers = []Provider{
	{
		ID:           "claude",
		Kind:         "config-file",
		ConfigDir:    ".claude",
		ConfigFile:   "settings.json",
		ConfigDirEnv: "CLAUDE_CONFIG_DIR",
		Events: []EventDefinition{
			{Name: "UserPromptSubmit", State: StateRunning},
			{Name: "Stop", State: StateIdle},
			{Name: "StopFailure", State: StateIdle},
			{Name: "SessionEnd", State: StateIdle},
			// Notification has no fixed meaning: it fires for idle prompts and for tool
			// approvals, and the shim decides which. Installing it is still right, because an
			// approval prompt is exactly when the user needs the indicator.
			{Name: "Notification"},
		},
	},
	{
		ID:           "codex",
		Kind:         "config-file",
		ConfigDir:    ".codex",
		ConfigFile:   "hooks.json",
		ConfigDirEnv: "CODEX_HOME",
		Events: []EventDefinition{
			{Name: "UserPromptSubmit", State: StateRunning},
			{Name: "PreToolUse", State: StateRunning},
			{Name: "PostToolUse", State: StateRunning},
			{Name: "PermissionRequest", State: StateNeedsInput},
			{Name: "Stop", State: StateIdle},
		},
	},
	{
		ID:         "opencode",
		Kind:       "plugin-file",
		ConfigDir:  ".config/opencode",
		ConfigFile: "plugins/byspace-terminal-activity.js",
		Events: []EventDefinition{
			{Name: "session.status.busy", State: StateRunning},
			{Name: "session.status.retry", State: StateRunning},
			{Name: "session.status.idle", State: StateIdle},
			{Name: "permission.asked", State: StateNeedsInput},
			{Name: "permission.replied", State: StateRunning},
		},
	},
}

// Find returns the provider with the given id.
func Find(id string) (Provider, bool) {
	for _, provider := range Providers {
		if provider.ID == id {
			return provider, true
		}
	}
	return Provider{}, false
}

// InstallAll installs every provider's hooks, returning the per-provider outcome.
//
// One failing provider does not stop the others: a user with a broken claude settings file still
// gets working codex hooks, and the error says which one failed.
func InstallAll() map[string]error {
	results := make(map[string]error, len(Providers))
	for _, provider := range Providers {
		results[provider.ID] = Install(provider)
	}
	return results
}

// UninstallAll removes BySpace's hooks from every provider.
func UninstallAll() map[string]error {
	results := make(map[string]error, len(Providers))
	for _, provider := range Providers {
		results[provider.ID] = Uninstall(provider)
	}
	return results
}
