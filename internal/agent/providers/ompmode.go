package providers

import (
	"fmt"
	"strings"
)

// MinSupportedOmpVersion is the oldest omp this daemon knows how to drive.
//
// Ported from provider-config.ts. The approval-mode flag and the RPC surface changed across omp versions,
// and an older binary accepts the launch arguments and then behaves differently — the agent starts, so
// nothing reports a failure, and the user sees a session whose mode does nothing.
const MinSupportedOmpVersion = "16.3.9"

// OmpModeArgs maps an omp mode id onto the launch arguments that implement it.
//
// Ported from resolveOmpLaunchMode. omp has no per-turn approval RPC: the posture is decided at launch and
// never changes, which is why the mode is an argument here rather than a request later.
//
// The translation is the whole point of the three modes. Without it, Full Access, Write Approval and Always
// Ask all ran with omp's default approval behaviour — the user's choice of "ask me before writing" silently
// became whatever omp defaults to.
func OmpModeArgs(modeID string) (string, []string, error) {
	trimmed := strings.TrimSpace(modeID)
	if trimmed == "" {
		trimmed = "full"
	}
	switch trimmed {
	case "full":
		return "full", []string{"--approval-mode", "yolo"}, nil
	case "write":
		return "write", []string{"--approval-mode", "write"}, nil
	case "ask":
		return "ask", []string{"--approval-mode", "always-ask"}, nil
	}
	// Refused rather than defaulted: silently running an unknown mode as "full" would grant unattended
	// access to a caller who asked for something else, and the caller cannot tell it happened.
	return "", nil, fmt.Errorf("unsupported OMP mode %q", modeID)
}

// OmpModelRoleArgs renders the per-role model overrides omp accepts.
//
// Ported from resolveOmpModelRoleArgs: `--smol` and `--slow` let a user point omp's cheap and deliberate
// roles at different models. Absent values are omitted so omp keeps its own defaults.
func OmpModelRoleArgs(smolModel, slowModel, planModel string) []string {
	args := make([]string, 0, 6)
	if value := strings.TrimSpace(smolModel); value != "" {
		args = append(args, "--smol", value)
	}
	if value := strings.TrimSpace(slowModel); value != "" {
		args = append(args, "--slow", value)
	}
	if value := strings.TrimSpace(planModel); value != "" {
		args = append(args, "--plan", value)
	}
	return args
}

// OmpVersionSupported reports whether an omp version satisfies the minimum.
//
// Ported from formatOmpVersionSupport's comparison: three numeric components, compared in order. An
// unparseable version is treated as unsupported — a binary that cannot say what it is cannot be trusted to
// have the flags either.
func OmpVersionSupported(version string) bool {
	parsed, ok := parseOmpVersion(version)
	if !ok {
		return false
	}
	minimum, _ := parseOmpVersion(MinSupportedOmpVersion)
	for index := 0; index < 3; index++ {
		if parsed[index] != minimum[index] {
			return parsed[index] > minimum[index]
		}
	}
	return true
}

// OmpVersionMessage renders the user-facing explanation for an out-of-date omp.
//
// Ported from formatOmpVersionSupport: the installed version, the required one, and what to do. A bare
// "unsupported" makes the user guess whether to upgrade or to reconfigure.
func OmpVersionMessage(installed string) string {
	trimmed := strings.TrimSpace(installed)
	if trimmed == "" {
		trimmed = "unknown"
	}
	return fmt.Sprintf("Oh My Pi %s is older than the minimum supported version %s. Run `omp upgrade` (or the "+
		"equivalent for your install) to update it.", trimmed, MinSupportedOmpVersion)
}

// parseOmpVersion reads a version from `omp --version` output.
//
// The output is a sentence on some builds ("omp 16.4.0 (abc123)"), so the first three dotted numbers are
// extracted rather than the whole string being parsed.
func parseOmpVersion(output string) ([3]int, bool) {
	var result [3]int
	fields := strings.FieldsFunc(output, func(r rune) bool {
		return !(r >= '0' && r <= '9') && r != '.'
	})
	for _, field := range fields {
		parts := strings.Split(strings.Trim(field, "."), ".")
		if len(parts) < 3 {
			continue
		}
		var parsed [3]int
		ok := true
		for index := 0; index < 3; index++ {
			value := 0
			for _, digit := range parts[index] {
				if digit < '0' || digit > '9' {
					ok = false
					break
				}
				value = value*10 + int(digit-'0')
			}
			if !ok {
				break
			}
			parsed[index] = value
		}
		if ok {
			return parsed, true
		}
	}
	return result, false
}
