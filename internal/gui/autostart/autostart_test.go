package autostart

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestAutostartSetAndDisable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows autostart writes to HKCU Run registry")
	}
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("XDG_CONFIG_HOME", tmp+"/.config")

	if Enabled() != Off {
		t.Fatalf("expected Off initially, got %s", Enabled())
	}
	if err := Set(true); err != nil {
		t.Fatalf("Set(true): %v", err)
	}
	if Enabled() != On {
		t.Fatalf("expected On after Set(true), got %s", Enabled())
	}
	if runtime.GOOS == "darwin" {
		b, err := os.ReadFile(record())
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), "<key>AbandonProcessGroup</key><true/>") {
			t.Fatalf("expected AbandonProcessGroup in plist, got %s", b)
		}
	}
	if err := Set(false); err != nil {
		t.Fatalf("Set(false): %v", err)
	}
	if Enabled() != Off {
		t.Fatalf("expected Off after Set(false), got %s", Enabled())
	}
}
