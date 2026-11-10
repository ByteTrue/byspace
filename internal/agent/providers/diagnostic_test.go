package providers

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The diagnostic used to be one hardcoded "healthy" line, so it could not tell a missing binary
// from a misconfigured PATH. It must report what the daemon resolved.
func TestProviderDiagnosticReportsResolvedBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script")
	}
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	bin := filepath.Join(dir, "fake-claude")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho 9.9.9\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	text := BuildProviderDiagnostic(context.Background(), "claude", "", map[string]any{
		"command": []any{bin},
	})
	for _, want := range []string{"Command: " + bin, "Resolved path: " + bin, "Version: 9.9.9"} {
		if !strings.Contains(text, want) {
			t.Fatalf("diagnostic missing %q:\n%s", want, text)
		}
	}
}

func TestProviderDiagnosticReportsMissingBinary(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-pi")
	text := BuildProviderDiagnostic(context.Background(), "pi", missing, nil)
	if !strings.Contains(text, "Resolved path: not found") {
		t.Fatalf("diagnostic did not report the missing binary:\n%s", text)
	}
	if strings.Contains(text, "healthy") {
		t.Fatalf("diagnostic still contains a verdict:\n%s", text)
	}
	if !strings.Contains(text, "Auth config") {
		t.Fatalf("pi diagnostic should name its auth file:\n%s", text)
	}
}
