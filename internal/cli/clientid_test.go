package cli

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// The id identifies "the BySpace CLI on this machine" rather than one process, so it persists across invocations.
func TestCliClientKeyPersists(t *testing.T) {
	resetClientID()
	dir := t.TempDir()

	first := cliClientKey(dir)
	if !strings.HasPrefix(first, "cid_") || len(first) != len("cid_")+32 {
		t.Fatalf("id = %q", first)
	}

	// Stored where the next invocation will find it.
	raw, err := os.ReadFile(filepath.Join(dir, cliClientKeyFile))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(raw)) != first {
		t.Fatalf("stored %q, got %q", strings.TrimSpace(string(raw)), first)
	}

	// A second process reads the same value rather than minting a new one.
	resetClientID()
	if second := cliClientKey(dir); second != first {
		t.Fatalf("second run = %q, first = %q", second, first)
	}
}

// A blank stored value is not an id: two machines would share "".
func TestCliClientKeyIgnoresBlankFile(t *testing.T) {
	resetClientID()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, cliClientKeyFile), []byte("  \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got := cliClientKey(dir)
	if !strings.HasPrefix(got, "cid_") {
		t.Fatalf("id = %q", got)
	}
}

// A read-only home must not stop `byspace ls`: the id is bookkeeping.
func TestCliClientKeySurvivesUnwritableHome(t *testing.T) {
	resetClientID()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Skip("cannot make the directory unwritable")
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	got := cliClientKey(dir)
	if !strings.HasPrefix(got, "cid_") {
		t.Fatalf("id = %q", got)
	}
}

// resetClientID clears the cached id so a test can observe the first-use path.
func resetClientID() {
	cliClientOnce = sync.Once{}
	cliClientID = ""
}
