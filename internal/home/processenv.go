package home

import "strings"

// Runtime-control environment keys, ported from byspace-env.ts.
//
// These describe the current process's relationship to a BySpace supervisor. They must never
// reach a child: a terminal spawned from an agent, or an agent spawned from a supervised
// daemon, would conclude it is an inherited subordinate and change behaviour — most visibly,
// the Pi terminal-activity extension reads the owner-pid marker, sees a foreign pid, decides it
// is a child process, and registers no handlers at all, so the terminal never reports
// running/idle again.
const (
	// PiTerminalHookOwnerPIDEnvKey marks which process owns the terminal-activity reporter.
	PiTerminalHookOwnerPIDEnvKey = "BYSPACE_PI_TERMINAL_HOOK_OWNER_PID"
)

var runtimeControlEnvKeys = []string{
	// pi's own session identity. A daemon launched *from inside a pi agent* (by an agent
	// running BySpace's own dev loop, which is how this was found) exports these for its own
	// session; a child pi that inherits them appends to the parent's transcript instead of
	// opening a new one, and the agent producted no visible turn at all.
	"PI_SESSION_FILE",
	"PI_SESSION_ID",
	"PI_MODEL",
	"PI_PROVIDER",
	"PI_REASONING_LEVEL",
	"PI_CODING_AGENT",
	// BySpace's own agent-scoped variables: they describe the current agent, and a grandchild
	// that inherits them reports activity to the wrong agent.
	"BYSPACE_AGENT_ID",
	"BYSPACE_AGENT_CWD",
	"BYSPACE_SUBAGENT_REPORT_TOKEN",
	"BYSPACE_SUBAGENT_REPORT_URL",
	"BYSPACE_NODE_ENV",
	"BYSPACE_DESKTOP_MANAGED",
	"BYSPACE_SUPERVISED",
	"ELECTRON_RUN_AS_NODE",
	"ELECTRON_NO_ATTACH_CONSOLE",
	"ESBUILD_BINARY_PATH",
	PiTerminalHookOwnerPIDEnvKey,
}

// ExternalProcessEnv returns the environment to hand a child process: the base env plus
// overlays, minus every runtime-control key.
//
// Stripping happens after the overlays are applied, so a caller cannot reintroduce a key by
// passing it as an overlay — the invariant belongs to this function, not to each call site.
func ExternalProcessEnv(base []string, overlays ...map[string]string) []string {
	merged := make(map[string]string, len(base))
	order := make([]string, 0, len(base))

	for _, entry := range base {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		if _, seen := merged[key]; !seen {
			order = append(order, key)
		}
		merged[key] = value
	}
	for _, overlay := range overlays {
		for key, value := range overlay {
			if _, seen := merged[key]; !seen {
				order = append(order, key)
			}
			merged[key] = value
		}
	}

	for _, key := range runtimeControlEnvKeys {
		if _, present := merged[key]; !present {
			continue
		}
		delete(merged, key)
		filtered := order[:0]
		for _, existing := range order {
			if existing != key {
				filtered = append(filtered, existing)
			}
		}
		order = filtered
	}

	out := make([]string, 0, len(order))
	for _, key := range order {
		out = append(out, key+"="+merged[key])
	}
	return out
}

// IsRuntimeControlEnvKey reports whether a key is process-local state.
func IsRuntimeControlEnvKey(key string) bool {
	for _, candidate := range runtimeControlEnvKeys {
		if candidate == key {
			return true
		}
	}
	return false
}
