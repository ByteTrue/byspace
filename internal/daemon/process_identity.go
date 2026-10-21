package daemon

import (
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// Process identity checking, following managed-processes.ts.
//
// A pid recorded in a file is not a handle: after a crash the number can be reused by any
// process on the machine. Signalling it blindly means `byspace daemon stop` can kill something
// entirely unrelated — an editor, another daemon, whatever happened to inherit the number. The
// only way to know is to ask the OS what that pid is actually running.

// ProcessCommandLine returns the command line a pid is running, or "" when it cannot be read.
func ProcessCommandLine(pid int) string {
	if pid <= 0 {
		return ""
	}
	switch runtime.GOOS {
	case "windows":
		// CIM is the supported replacement for wmic, which is removed from current Windows.
		out, err := exec.Command("powershell", "-NoProfile", "-Command",
			"(Get-CimInstance Win32_Process -Filter \"ProcessId="+strconv.Itoa(pid)+"\").CommandLine").Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	default:
		out, err := exec.Command("ps", "-o", "command=", "-p", strconv.Itoa(pid)).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	}
}

// ProcessMatches reports whether a pid is still the process we recorded.
//
// A pid that is alive but running something else has been recycled, and must not be signalled.
// When the command line cannot be read the answer is "no": refusing to kill is recoverable,
// killing the wrong process is not.
func ProcessMatches(pid int, expectSubstring string) bool {
	if pid <= 0 {
		return false
	}
	needle := strings.TrimSpace(expectSubstring)
	if needle == "" {
		return false
	}
	commandLine := ProcessCommandLine(pid)
	if commandLine == "" {
		return false
	}
	// The recorded identity is "byspace" + the serve verb; both must appear, in any order the
	// install happens to produce (/usr/local/bin/byspace serve, ./bin/byspace serve --addr ...).
	for _, part := range strings.Fields(needle) {
		if !strings.Contains(commandLine, part) {
			return false
		}
	}
	return true
}

// daemonProcessIdentity is what a daemon process's command line must contain.
const daemonProcessIdentity = "byspace serve"
