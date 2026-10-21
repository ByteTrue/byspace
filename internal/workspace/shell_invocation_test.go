package workspace

import (
	"runtime"
	"strings"
	"testing"
)

// `bash -lc` sources the user's login files, which can change PATH, define aliases or cd
// elsewhere — so a setup command that works for one developer fails for another with no visible
// cause. Project commands must be reproducible.
func TestBuildShellInvocationIsNotALoginShell(t *testing.T) {
	inv := BuildShellInvocation("npm ci")
	if runtime.GOOS == "windows" {
		if inv.Shell != "powershell" {
			t.Fatalf("shell = %q", inv.Shell)
		}
		joined := strings.Join(inv.Args, " ")
		for _, want := range []string{"-NoProfile", "-NonInteractive", "-Command", "npm ci"} {
			if !strings.Contains(joined, want) {
				t.Fatalf("missing %q in %v", want, inv.Args)
			}
		}
		return
	}
	if inv.Shell != "bash" {
		t.Fatalf("shell = %q", inv.Shell)
	}
	if len(inv.Args) != 2 || inv.Args[0] != "-c" || inv.Args[1] != "npm ci" {
		t.Fatalf("args = %v; a login or interactive flag would source user files", inv.Args)
	}
}

// BASH_ENV is sourced by a non-interactive bash before the command runs; leaving it set means a
// project command executes whatever the variable points at.
func TestSanitizedShellEnvRemovesBashEnv(t *testing.T) {
	base := []string{"PATH=/usr/bin", "BASH_ENV=/tmp/evil.sh", "ENV=/tmp/evil2.sh", "HOME=/Users/x"}
	got := SanitizedShellEnv(base)
	joined := strings.Join(got, "\n")
	for _, banned := range []string{"BASH_ENV", "ENV="} {
		if strings.Contains(joined, banned) {
			t.Fatalf("%s leaked: %v", banned, got)
		}
	}
	if !strings.Contains(joined, "PATH=/usr/bin") || !strings.Contains(joined, "HOME=/Users/x") {
		t.Fatalf("ordinary variables were dropped: %v", got)
	}
}
