package terminal

import (
	"os"
	"runtime"
	"testing"
)

// The picker must only offer shells that exist; a dead entry fails at spawn time.
func TestDetectInstalledShellsReturnsExisting(t *testing.T) {
	shells := DetectInstalledShells()
	if len(shells) == 0 {
		t.Skip("no shells detected in this environment")
	}
	for _, sh := range shells {
		if info, err := os.Stat(sh.Path); err != nil || info.IsDir() {
			t.Fatalf("detected a shell that does not exist: %s", sh.Path)
		}
		if sh.Name == "" {
			t.Fatalf("shell %s has no display name", sh.Path)
		}
	}
	// Exactly one default, and it comes first.
	defaults := 0
	for _, sh := range shells {
		if sh.IsDefault {
			defaults++
		}
	}
	if defaults != 1 || !shells[0].IsDefault {
		t.Fatalf("expected one default in first position, got %d", defaults)
	}
}

// $SHELL is the strongest signal of what the user actually runs.
func TestDetectInstalledShellsPrefersEnvShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix ordering")
	}
	target := ""
	for _, candidate := range []string{"/bin/sh", "/bin/bash", "/bin/zsh"} {
		if _, err := os.Stat(candidate); err == nil {
			target = candidate
			break
		}
	}
	if target == "" {
		t.Skip("no unix shell available")
	}
	t.Setenv("SHELL", target)
	shells := DetectInstalledShells()
	if len(shells) == 0 {
		t.Fatal("no shells detected")
	}
	if shells[0].Path != target {
		t.Fatalf("$SHELL should win: got %s, want %s", shells[0].Path, target)
	}
	if shells[0].Source != "env" {
		t.Fatalf("source = %q, want env", shells[0].Source)
	}
}

// A configured shell that does not exist must not become the default: the terminal would fail
// to spawn with an opaque error.
func TestResolveDefaultShellFallsBackWhenConfiguredIsGone(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix paths")
	}
	got := ResolveDefaultShell("/nonexistent/shell-xyz")
	if got == "/nonexistent/shell-xyz" {
		t.Fatal("a missing configured shell must not be used")
	}
	if info, err := os.Stat(got); err != nil || info.IsDir() {
		t.Fatalf("fallback shell %q does not exist", got)
	}
}

// An explicit existing shell wins over discovery.
func TestResolveDefaultShellHonoursConfigured(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix paths")
	}
	target := ""
	for _, candidate := range []string{"/bin/sh", "/bin/bash"} {
		if _, err := os.Stat(candidate); err == nil {
			target = candidate
			break
		}
	}
	if target == "" {
		t.Skip("no unix shell available")
	}
	if got := ResolveDefaultShell(target); got != target {
		t.Fatalf("configured shell ignored: got %s", got)
	}
}
