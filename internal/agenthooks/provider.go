// Package agenthooks installs the terminal-activity hooks that agent CLIs run.
//
// Ported from terminal/agent-hooks/**. Each provider has its own configuration format and its own
// event names, but the job is the same: when the agent inside a BySpace terminal starts working,
// stops, or asks the user something, it must tell the daemon so the sidebar indicator is honest.
//
// Two rules apply to every provider and both are load-bearing:
//
//   - Only touch entries we wrote. A user may have their own hooks in the same file, and
//     overwriting the file silently deletes their work. Every entry we add carries a marker, and
//     removal filters by that marker.
//   - Merge, never replace. The file may carry unrelated settings; rewriting a parsed-and-
//     re-serialised document preserves them, writing a fresh one does not.
package agenthooks

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
)

// State is the activity state a hook reports.
type State string

// Activity states understood by the daemon.
const (
	StateRunning    State = "running"
	StateIdle       State = "idle"
	StateNeedsInput State = "needs-input"
)

// EventDefinition is one hook event a provider emits.
type EventDefinition struct {
	// Name is the provider's own event name, passed to the shim.
	Name string
	// State is the activity state that event means, when it means one directly.
	State State
}

// Provider describes one agent CLI's hook configuration.
type Provider struct {
	ID string
	// Events are the hook events to install.
	Events []EventDefinition
	// ConfigDir is the directory under the user's home (or its env override).
	ConfigDir string
	// ConfigFile is the file within ConfigDir.
	ConfigFile string
	// ConfigDirEnv overrides ConfigDir when set.
	ConfigDirEnv string
	// Kind is "config-file" for JSON hooks, "plugin-file" for a JS plugin.
	Kind string
}

// ShellCommand is the command a hook entry runs.
//
// Guarded on BYSPACE_TERMINAL_ID: the hook fires only inside a BySpace terminal, so running the
// agent in the user's own shell does not spawn a process per event that then has nothing to
// report. The CLI path is overridable because the daemon may be a downloaded binary that is not on
// PATH.
func ShellCommand(providerID, event string) string {
	return fmt.Sprintf(`if [ -n "$BYSPACE_TERMINAL_ID" ]; then "${BYSPACE_HOOK_CLI:-byspace}" hooks %s %s; fi`,
		shellToken(providerID), shellToken(event))
}

// shellToken quotes a value for the shell.
//
// The provider id and event name are ours, but quoting costs nothing and a future event name with
// a space would otherwise split the command.
func shellToken(value string) string {
	if value == "" {
		return "''"
	}
	safe := true
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' ||
			r == '.' || r == '_' || r == '-' || r == '/') {
			safe = false
			break
		}
	}
	if safe {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// ProviderHome resolves the directory the provider reads its config from.
func (p Provider) ProviderHome() (string, error) {
	if p.ConfigDirEnv != "" {
		if override := strings.TrimSpace(os.Getenv(p.ConfigDirEnv)); override != "" {
			return override, nil
		}
	}
	// An absolute ConfigDir is taken as-is. filepath.Join would otherwise treat it as relative and
	// glue it onto the home directory, silently writing somewhere nobody reads.
	if filepath.IsAbs(p.ConfigDir) {
		return p.ConfigDir, nil
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(userHome, p.ConfigDir), nil
}

// ConfigPath is the full path of the file to edit.
func (p Provider) ConfigPath() (string, error) {
	providerHome, err := p.ProviderHome()
	if err != nil {
		return "", err
	}
	return filepath.Join(providerHome, filepath.FromSlash(p.ConfigFile)), nil
}

// marker identifies an entry BySpace wrote.
//
// It is the substring we look for when merging and when removing, so it must appear verbatim in
// every entry we create. "hooks <id>" also appears in the command, which means an entry copied by
// hand still counts as ours.
func (p Provider) marker() string { return "hooks " + p.ID }

// Install writes the hooks for a provider, preserving everything else in the file.
func Install(p Provider) error {
	if p.Kind == "plugin-file" {
		return installPluginFile(p)
	}
	return installConfigFile(p)
}

// Uninstall removes only the entries BySpace wrote.
func Uninstall(p Provider) error {
	if p.Kind == "plugin-file" {
		return uninstallPluginFile(p)
	}
	return uninstallConfigFile(p)
}

// readConfigFile loads a JSON config, returning an empty object when the file is absent.
//
// A missing file is normal (a fresh install), so it is not an error. A malformed file IS reported:
// silently replacing a user's broken settings with ours would destroy whatever they were editing.
func readConfigFile(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON; refusing to overwrite it: %w", path, err)
	}
	if config == nil {
		config = map[string]any{}
	}
	return config, nil
}

// installConfigFile merges our hook entries into a provider's JSON settings.
func installConfigFile(p Provider) error {
	path, err := p.ConfigPath()
	if err != nil {
		return err
	}
	config, err := readConfigFile(path)
	if err != nil {
		return err
	}

	hooks := normalizeHooks(config["hooks"])
	for _, event := range p.Events {
		// Keep the user's entries for this event, drop any previous version of ours, then append
		// one fresh entry per event. Two entries for the same event would report twice.
		kept := filterOutOurs(hooks[event.Name], p.marker())
		kept = append(kept, map[string]any{
			"matcher": "",
			"hooks": []any{
				map[string]any{
					"type":    "command",
					"command": ShellCommand(p.ID, event.Name),
					"timeout": 10,
				},
			},
		})
		hooks[event.Name] = kept
	}
	config["hooks"] = hooks

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(path, append(encoded, '\n'), 0o644)
}

// uninstallConfigFile removes our entries and leaves the rest.
func uninstallConfigFile(p Provider) error {
	path, err := p.ConfigPath()
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
		return nil
	}
	config, err := readConfigFile(path)
	if err != nil {
		return err
	}

	hooks := normalizeHooks(config["hooks"])
	for _, event := range p.Events {
		kept := filterOutOurs(hooks[event.Name], p.marker())
		if len(kept) == 0 {
			// Leaving an empty array would look like a configured-but-broken hook list.
			delete(hooks, event.Name)
			continue
		}
		hooks[event.Name] = kept
	}
	if len(hooks) == 0 {
		delete(config, "hooks")
	} else {
		config["hooks"] = hooks
	}

	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(path, append(encoded, '\n'), 0o644)
}

// normalizeHooks coerces the hooks object, tolerating a provider that wrote something else there.
func normalizeHooks(raw any) map[string]any {
	if hooks, ok := raw.(map[string]any); ok {
		return hooks
	}
	return map[string]any{}
}

// filterOutOurs drops entries whose JSON contains the marker.
func filterOutOurs(raw any, marker string) []any {
	entries, ok := raw.([]any)
	if !ok {
		return nil
	}
	kept := make([]any, 0, len(entries))
	for _, entry := range entries {
		encoded, err := json.Marshal(entry)
		if err != nil {
			// Unserialisable: keep it, since dropping it would be data loss.
			kept = append(kept, entry)
			continue
		}
		if strings.Contains(string(encoded), marker) {
			continue
		}
		kept = append(kept, entry)
	}
	return kept
}
