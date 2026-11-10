package providers

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/ByteTrue/byspace/internal/execres"
)

// BuildProviderDiagnostic renders the text the provider sheet's Diagnostic action shows.
//
// It reports what the daemon actually resolved, not a verdict. That distinction is the whole point:
// "Pi is healthy" was a hardcoded answer, and the real failure ("installed under ~/.pi, missing from
// this daemon's PATH") only becomes visible when the command, its resolved path and the search dirs
// are printed.
func BuildProviderDiagnostic(ctx context.Context, providerID, piCommandOverride string, cfg map[string]any) string {
	id := strings.TrimSpace(providerID)
	if id == "" {
		id = "pi"
	}
	spec := ResolveProviderSpecWithConfig(id, cfg)
	command := strings.TrimSpace(spec.Binary)
	// Mirror the launch order: an explicit Pi override beats the environment, and a
	// <PROVIDER>_COMMAND environment variable beats the config/default binary.
	envCommand := strings.TrimSpace(os.Getenv(strings.ToUpper(strings.ReplaceAll(id, "-", "_")) + "_COMMAND"))
	switch {
	case id == "pi" && strings.TrimSpace(piCommandOverride) != "":
		command = strings.TrimSpace(piCommandOverride)
	case envCommand != "":
		command = envCommand
	}
	if command == "" {
		command = id
	}

	lines := []string{spec.Label + " (" + id + ")", "  Command: " + command}
	resolved := resolveDiagnosticCommand(ctx, command)
	if resolved == "" {
		lines = append(lines, "  Resolved path: not found")
		lines = append(lines, "  Version: not run")
	} else {
		lines = append(lines, "  Resolved path: "+resolved)
		version, err := execres.Version(ctx, resolved)
		if err != nil || version == "" {
			lines = append(lines, "  Version: (--version failed)")
		} else {
			lines = append(lines, "  Version: "+version)
		}
	}

	if !strings.ContainsAny(command, `/\`) {
		matches := execres.Enumerate(command)
		if len(matches) == 0 {
			lines = append(lines, "  PATH matches: none")
		} else {
			lines = append(lines, "  PATH matches: "+strings.Join(matches, "\n    "))
		}
	}
	lines = append(lines, "  Daemon PATH: "+os.Getenv("PATH"))

	for _, row := range providerConfigRows(id) {
		lines = append(lines, "  "+row[0]+": "+row[1])
	}
	return strings.Join(lines, "\n")
}

// resolveDiagnosticCommand resolves a bare name across PATH and the standard install dirs, and a
// path with a separator literally.
func resolveDiagnosticCommand(ctx context.Context, command string) string {
	if strings.TrimSpace(command) == "" {
		return ""
	}
	if strings.ContainsAny(command, `/\`) {
		if execres.Probe(ctx, command) {
			return command
		}
		return ""
	}
	return execres.Find(ctx, command)
}

// providerConfigRows reports the files whose contents select models or credentials for a provider.
//
// Only locations that exist as documented contracts belong here. Claude and Pi read these files
// themselves; naming the exact path is what lets a user check the file the daemon did not read.
func providerConfigRows(providerID string) [][2]string {
	home, _ := os.UserHomeDir()
	rows := make([][2]string, 0, 2)
	switch providerID {
	case "pi":
		path := filepath.Join(home, ".pi", "agent", "auth.json")
		rows = append(rows, [2]string{"Auth config (" + path + ")", filePresence(path)})
	case "claude":
		path := filepath.Join(claudeConfigDir(), "settings.json")
		rows = append(rows, [2]string{"Settings (" + path + ")", filePresence(path)})
		if models := readClaudeSettingsModels(); len(models) > 0 {
			rows = append(rows, [2]string{"Models from settings", strconv.Itoa(len(models))})
		}
	}
	return rows
}

func filePresence(path string) string {
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		return "found"
	}
	return "not found"
}
