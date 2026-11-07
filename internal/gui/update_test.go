package gui

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func write(t *testing.T, path, content string) os.FileInfo {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return fi
}

func TestInstallStagedSwapsBinaryOnce(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "byspace.exe")
	self := write(t, exe, "old")
	staged := exe + ".new"
	write(t, staged, "the-new-binary")

	u := &ClientUpdater{Version: "0.1.0", exe: exe, self: self, staged: staged, state: "ready"}

	if !u.InstallStaged() {
		t.Fatal("InstallStaged failed to swap a staged binary")
	}
	if got, err := os.ReadFile(exe); err != nil || string(got) != "the-new-binary" {
		t.Fatalf("exe = %q (err %v), want the new binary", got, err)
	}
	if s := u.Status(); s.State != "" {
		t.Fatalf("state after install = %q, want cleared", s.State)
	}
	if _, err := os.Stat(staged); !os.IsNotExist(err) {
		t.Fatalf("staged file survived the swap: %v", err)
	}

	// Nothing left to swap, but the disk already holds the new binary.
	if !u.InstallStaged() {
		t.Fatal("second InstallStaged must report the already-replaced binary")
	}
}

// The staged->installed rename can retry with sleeps for up to 30s on Windows while antivirus
// holds the download open. It must not block the state lock: OnShutdown takes it, and OnShutdown
// runs on the main UI thread.
func TestUpdateStateReadableWhileInstallRuns(t *testing.T) {
	u := &ClientUpdater{Version: "0.1.0", exe: filepath.Join(t.TempDir(), "byspace.exe"), state: "ready"}
	u.staged = u.exe + ".new"

	u.installMu.Lock()
	defer u.installMu.Unlock()

	done := make(chan struct{})
	go func() {
		_ = u.Status()
		_, _ = u.State()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("update state reads blocked behind the binary swap")
	}
}
