package selfupdate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPathFirstAndWindowsShim(t *testing.T) {
	for _, c := range [][3]string{
		{"", `C:\B`, `C:\B`},
		{`C:\a;C:\d`, `C:\B`, `C:\B;C:\a;C:\d`},
		{`C:\a;c:\b\;C:\c;`, `C:\B`, `C:\B;C:\a;C:\c`},
	} {
		if got := pathFirst(c[0], c[1]); got != c[2] {
			t.Fatalf("pathFirst(%q, %q) = %q, want %q", c[0], c[1], got, c[2])
		}
	}

	dir := t.TempDir()
	exe := filepath.Join(dir, "byspace-windows-amd64.exe")
	if err := os.WriteFile(exe, []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	shimPath, err := writeShim(exe)
	if err != nil {
		t.Fatal(err)
	}
	if shimPath != filepath.Join(dir, "byspace.cmd") {
		t.Fatalf("unexpected shim path %q", shimPath)
	}
	b, err := os.ReadFile(shimPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"%~dp0byspace-windows-amd64.exe" %*`) {
		t.Fatalf("unexpected shim content: %q", b)
	}
	if !shimRuns(shimPath, exe) {
		t.Fatal("expected shimRuns to report true for matching exe")
	}
}
