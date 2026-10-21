package home

import (
	"strings"
	"testing"
)

// A terminal or agent must never inherit the supervisor's identity markers: the Pi
// terminal-activity extension reads the owner-pid marker and, seeing a foreign pid, concludes
// it is an inherited child and registers no handlers at all — the terminal then never reports
// running/idle.
func TestExternalProcessEnvStripsRuntimeControls(t *testing.T) {
	base := []string{
		"PATH=/usr/bin",
		"HOME=/Users/x",
		"BYSPACE_SUPERVISED=1",
		PiTerminalHookOwnerPIDEnvKey + "=1234",
		"ELECTRON_RUN_AS_NODE=1",
	}
	got := ExternalProcessEnv(base)
	joined := strings.Join(got, "\n")

	for _, banned := range []string{"BYSPACE_SUPERVISED", PiTerminalHookOwnerPIDEnvKey, "ELECTRON_RUN_AS_NODE"} {
		if strings.Contains(joined, banned) {
			t.Fatalf("%s leaked into the child environment:\n%s", banned, joined)
		}
	}
	if !strings.Contains(joined, "PATH=/usr/bin") || !strings.Contains(joined, "HOME=/Users/x") {
		t.Fatalf("ordinary variables were dropped:\n%s", joined)
	}
}

// Stripping runs after overlays, so a call site cannot reintroduce a key by passing it in.
func TestExternalProcessEnvStripsAfterOverlays(t *testing.T) {
	got := ExternalProcessEnv(
		[]string{"PATH=/usr/bin"},
		map[string]string{PiTerminalHookOwnerPIDEnvKey: "999"},
		map[string]string{"CUSTOM": "x"},
	)
	joined := strings.Join(got, "\n")
	if strings.Contains(joined, PiTerminalHookOwnerPIDEnvKey) {
		t.Fatalf("overlay reintroduced a runtime key:\n%s", joined)
	}
	if !strings.Contains(joined, "CUSTOM=x") {
		t.Fatalf("overlay value lost:\n%s", joined)
	}
}

// Overlays win over the base, so a caller can still set ordinary variables.
func TestExternalProcessEnvOverlayPrecedence(t *testing.T) {
	got := ExternalProcessEnv([]string{"PORT=1"}, map[string]string{"PORT": "2"})
	if strings.Join(got, ",") != "PORT=2" {
		t.Fatalf("got %v", got)
	}
}

func TestIsRuntimeControlEnvKey(t *testing.T) {
	if !IsRuntimeControlEnvKey(PiTerminalHookOwnerPIDEnvKey) {
		t.Fatal("the hook owner marker is runtime state")
	}
	if IsRuntimeControlEnvKey("PATH") {
		t.Fatal("PATH is not runtime state")
	}
}

// A daemon launched from inside a pi agent inherits that agent's session identity. A child pi
// that keeps it appends to the parent's transcript instead of opening a new session, and the
// new agent produces no visible turn at all — the failure looks like "the agent never replies"
// with no error anywhere.
func TestExternalProcessEnvStripsPiSessionIdentity(t *testing.T) {
	base := []string{
		"PATH=/usr/bin",
		"PI_SESSION_FILE=/Users/x/.pi/agent/sessions/-tmp-/abc.jsonl",
		"PI_SESSION_ID=01a15306",
		"PI_MODEL=deepseek-flash",
		"PI_PROVIDER=bytetrueapi",
		"PI_CODING_AGENT=true",
	}
	joined := strings.Join(ExternalProcessEnv(base), "\n")
	for _, banned := range []string{"PI_SESSION_FILE", "PI_SESSION_ID", "PI_MODEL", "PI_PROVIDER", "PI_CODING_AGENT"} {
		if strings.Contains(joined, banned) {
			t.Fatalf("%s leaked into a child pi:\n%s", banned, joined)
		}
	}
	if !strings.Contains(joined, "PATH=/usr/bin") {
		t.Fatal("ordinary variables must survive")
	}
}
