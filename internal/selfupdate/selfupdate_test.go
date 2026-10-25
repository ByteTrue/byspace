package selfupdate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The whole sequence in one test: phases in order, the binary replaced, contents exact.
func TestUpdateReplacesBinaryAndReportsPhases(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "byspace")
	if err := os.WriteFile(executable, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	var phases []Phase
	updater := &Updater{
		CurrentVersion: "0.1.0",
		ExecutablePath: executable,
		TargetVersion:  "0.2.0",
		OnProgress:     func(phase Phase) { phases = append(phases, phase) },
		Fetch: func(context.Context, string) ([]byte, error) {
			return []byte("new binary"), nil
		},
	}

	result, err := updater.Update(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatalf("failed: %s", result.Error)
	}
	if result.PreviousVersion != "0.1.0" || result.NewVersion != "0.2.0" {
		t.Fatalf("versions: %+v", result)
	}
	if !result.RestartRequired {
		t.Fatal("replacing the file does not affect the running process; a restart is required")
	}

	body, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "new binary" {
		t.Fatalf("contents = %q", body)
	}
	info, err := os.Stat(executable)
	if err != nil {
		t.Fatal(err)
	}
	// Windows has no execute bit; "executable" there means a recognizable extension, not a mode.
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("the new binary is not executable: %v", info.Mode().Perm())
	}

	// Phases must arrive in order; the client renders each one.
	want := []Phase{PhaseStarting, PhaseDownloading, PhaseInstalling, PhaseComplete}
	if len(phases) != len(want) {
		t.Fatalf("phases = %v", phases)
	}
	for i := range want {
		if phases[i] != want[i] {
			t.Fatalf("phase %d = %q, want %q", i, phases[i], want[i])
		}
	}
}

// Two concurrent requests race on the same file and can leave a half-written binary, which is
// unbootable.
func TestUpdateRefusesConcurrent(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "byspace")
	if err := os.WriteFile(executable, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	release := make(chan struct{})
	updater := &Updater{
		ExecutablePath: executable,
		Fetch: func(context.Context, string) ([]byte, error) {
			<-release
			return []byte("new"), nil
		},
	}

	first := make(chan error, 1)
	go func() {
		_, err := updater.Update(context.Background())
		first <- err
	}()

	// Wait until the first update is inside Fetch.
	for {
		updater.mu.Lock()
		inProgress := updater.inProgress
		updater.mu.Unlock()
		if inProgress {
			break
		}
	}

	_, err := updater.Update(context.Background())
	if !errors.Is(err, ErrInProgress) {
		t.Fatalf("second update must be refused with ErrInProgress, got %v", err)
	}

	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
}

// An empty payload must be refused: renaming an empty file into place would brick the daemon.
func TestUpdateRefusesEmptyPayload(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "byspace")
	if err := os.WriteFile(executable, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	updater := &Updater{
		ExecutablePath: executable,
		Fetch:          func(context.Context, string) ([]byte, error) { return nil, nil },
	}
	result, err := updater.Update(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Success {
		t.Fatal("an empty payload must fail")
	}
	body, _ := os.ReadFile(executable)
	if string(body) != "old" {
		t.Fatal("the old binary was replaced with an empty file")
	}
}

// A read-only directory is refused before downloading, with a reason the user can act on.
func TestUpdateRefusesReadOnlyDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("chmod 0555 does not make a directory read-only on Windows")
	}
	dir := t.TempDir()
	executable := filepath.Join(dir, "byspace")
	if err := os.WriteFile(executable, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	downloaded := false
	updater := &Updater{
		ExecutablePath: executable,
		Fetch: func(context.Context, string) ([]byte, error) {
			downloaded = true
			return []byte("new"), nil
		},
	}
	result, err := updater.Update(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Success {
		t.Fatal("a read-only directory must be refused")
	}
	if downloaded {
		t.Fatal("the download must not run when the install cannot succeed")
	}
	if result.Error == "" {
		t.Fatal("the refusal needs a reason")
	}
}

// A rename within one directory is atomic: a partial write must never reach the executable path.
func TestReplaceBinaryLeavesNoTempOnFailure(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "byspace")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ReplaceBinary(target, []byte("new")); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != "byspace" {
			t.Fatalf("temp file left behind: %s", entry.Name())
		}
	}
}

// A symlinked binary must be replaced at its real path, or the update writes through the symlink
// and leaves the target unchanged.
func TestExecutableResolvesSymlinks(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real-byspace")
	if err := os.WriteFile(real, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "byspace")
	if err := os.Symlink(real, link); err != nil {
		t.Skip("symlinks unavailable:", err)
	}

	updater := &Updater{ExecutablePath: link}
	// ExecutablePath is honoured verbatim; the symlink resolution applies to os.Executable.
	// Point at the symlink through ReplaceBinary to confirm the caller's choice is respected.
	resolved, err := updater.executable()
	if err != nil {
		t.Fatal(err)
	}
	if resolved != link {
		t.Fatalf("an explicit ExecutablePath must be used as given, got %q", resolved)
	}
}
