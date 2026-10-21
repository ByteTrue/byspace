package workspace

import (
	"runtime"
	"strings"
)

// Shell invocation for project-authored command strings, ported from string-command-shell.ts.
//
// A `byspace.json` command must run the same way on every machine. `bash -lc` sources the user's
// login files, which can change PATH, define aliases, print banners, or `cd` somewhere else — so
// a setup command that works for one developer fails for another with no visible cause. The node
// daemon uses a non-login shell for exactly this reason, and strips BASH_ENV, which would source
// an arbitrary file before the command runs.

// ShellInvocation is the executable and argument list for one command string.
type ShellInvocation struct {
	Shell string
	Args  []string
}

// BuildShellInvocation returns the shell command for a project-authored command string.
//
// Unix uses `bash -c` (not `-l`, not `-i`). Windows uses PowerShell with `-NoProfile`
// `-NonInteractive`, so a user's profile cannot rewrite the environment or prompt for input.
func BuildShellInvocation(command string) ShellInvocation {
	if runtime.GOOS == "windows" {
		return ShellInvocation{
			Shell: "powershell",
			Args: []string{
				"-NoProfile", "-NonInteractive",
				"-ExecutionPolicy", "Bypass",
				"-Command", command,
			},
		}
	}
	return ShellInvocation{Shell: "bash", Args: []string{"-c", command}}
}

// SanitizedShellEnv strips variables that would source extra files.
//
// BASH_ENV is sourced by a non-interactive bash before the command runs; leaving it set means a
// project command executes whatever the variable points at, which is not part of the project.
func SanitizedShellEnv(base []string) []string {
	out := make([]string, 0, len(base))
	for _, entry := range base {
		key, _, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if key == "BASH_ENV" || key == "ENV" {
			continue
		}
		out = append(out, entry)
	}
	return out
}

// ShellEnvOverlay names the variables to remove, for callers that merge environments.
func ShellEnvOverlay() []string { return []string{"BASH_ENV", "ENV"} }
