package cli

import (
	"os"
	"path/filepath"
	"strings"
)

// Invocation classification, ported from classify.ts.
//
// `byspace ~/code/myapp` should open that project, the way `cd` and `code` work. The alternative
// is requiring the user to remember the `open` subcommand for the one action they take most
// often, which is a worse first experience than the convenience is worth defending against.
//
// The classification is deliberately conservative: an argument is only treated as a project path
// when it names an existing *directory*. A typo then falls through to "unknown command", which
// says what happened, instead of "cannot open /typo" which looks like the app is broken.

// invocation is what the first argument means.
type invocation struct {
	// kind is "cli" (dispatch as a command) or "open-project".
	kind string
	// resolvedPath is the absolute path for open-project.
	resolvedPath string
}

// classifyInvocation decides what the first argument means.
func classifyInvocation(argv []string, knownCommands map[string]bool) invocation {
	if len(argv) == 0 {
		return invocation{kind: "cli"}
	}
	first := argv[0]
	if first == "" || strings.HasPrefix(first, "-") {
		return invocation{kind: "cli"}
	}
	if knownCommands[first] {
		return invocation{kind: "cli"}
	}
	if !isPathLikeArg(first) {
		return invocation{kind: "cli"}
	}
	resolved, err := resolveExistingDirectory(first)
	if err != nil {
		return invocation{kind: "cli"}
	}
	return invocation{kind: "open-project", resolvedPath: resolved}
}

// isPathLikeArg reports whether an argument looks like a path rather than a command.
//
// Only path-like arguments are probed on disk, so a mistyped command does not cost a stat per
// run and does not accidentally resolve to a directory that happens to share its name.
func isPathLikeArg(arg string) bool {
	switch {
	case arg == ".", arg == "..", arg == "~":
		return true
	case strings.HasPrefix(arg, "./"), strings.HasPrefix(arg, "../"):
		return true
	case strings.HasPrefix(arg, "/"), strings.HasPrefix(arg, "~/"):
		return true
	}
	// A Windows drive prefix (C:\ or C:/).
	if len(arg) >= 3 && isASCIILetter(arg[0]) && arg[1] == ':' && (arg[2] == '\\' || arg[2] == '/') {
		return true
	}
	return false
}

// resolveExistingDirectory returns the absolute path when the argument names a directory.
func resolveExistingDirectory(pathArg string) (string, error) {
	expanded := expandUserPath(pathArg)
	absolute, err := filepath.Abs(expanded)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.IsDir() {
		return "", os.ErrNotExist
	}
	return absolute, nil
}

// expandUserPath replaces a leading ~ with the user's home directory.
func expandUserPath(inputPath string) string {
	if inputPath == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return inputPath
		}
		return home
	}
	if strings.HasPrefix(inputPath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return inputPath
		}
		return filepath.Join(home, inputPath[2:])
	}
	return inputPath
}

func isASCIILetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// knownCommandNames is the set of first arguments that are commands, not paths.
//
// Kept as a list next to the dispatcher: a command missing from here would be shadowed by a
// directory of the same name in the working directory.
var knownCommandNames = map[string]bool{
	"app": true, "gui": true, "tray": true, "healthcheck": true,
	"serve": true, "web": true, "relay": true, "ls": true, "run": true, "logs": true,
	"attach": true, "wait": true, "send": true, "stop": true, "start": true, "status": true,
	"restart": true, "reload": true, "rm": true, "delete": true, "archive": true,
	"import": true, "inspect": true, "update": true, "detach": true,
	"daemon": true, "agent": true, "project": true, "workspace": true, "terminal": true,
	"script": true, "schedule": true, "heartbeat": true, "permit": true, "provider": true,
	"worktree": true, "clone": true, "open": true, "pair": true, "onboard": true,
	"hooks": true, "mcp-bridge": true, "print-plist": true, "print-unit": true,
	"version": true, "help": true,
}

// knownCommand reports whether a first argument is a command rather than a path.
func knownCommand(name string) bool {
	if strings.HasPrefix(name, "-") {
		return true
	}
	return knownCommandNames[name]
}
