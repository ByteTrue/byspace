package proc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestNoRawExecCommandInWindowsCompiledPackages guards against direct exec.Command /
// exec.CommandContext calls in packages compiled on Windows: in the -H windowsgui desktop binary,
// any child started without proc.Command (CREATE_NO_WINDOW) flashes a black console window.
func TestNoRawExecCommandInWindowsCompiledPackages(t *testing.T) {
	root := filepath.Clean("../..")
	err := filepath.WalkDir(filepath.Join(root, "internal"), func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		base := filepath.Base(path)
		// Files that only compile on darwin/linux/unix never run on Windows.
		if strings.HasSuffix(base, "_darwin.go") || strings.HasSuffix(base, "_linux.go") || strings.HasSuffix(base, "_unix.go") {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if rel == "internal/proc/proc.go" || rel == "internal/cli/output.go" || rel == "internal/daemon/service.go" || rel == "internal/terminal/shells.go" || rel == "internal/selfupdate/release.go" {
			return nil
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		text := string(raw)
		if strings.Contains(text, "exec.Command(") || strings.Contains(text, "exec.CommandContext(") {
			t.Errorf("%s calls exec.Command directly; use proc.Command / proc.CommandContext so Windows GUI builds set CREATE_NO_WINDOW", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
