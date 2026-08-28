package daemon

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestOwnershipLeaseIsExclusiveAndReusable(t *testing.T) {
	home := t.TempDir()
	first, err := acquireOwnership(home)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireOwnership(home); err == nil {
		first.Release()
		t.Fatal("second ownership lease unexpectedly succeeded")
	}
	if err := first.Release(); err != nil {
		t.Fatal(err)
	}

	second, err := acquireOwnership(home)
	if err != nil {
		t.Fatalf("ownership lock was not reusable: %v", err)
	}
	if err := second.Release(); err != nil {
		t.Fatal(err)
	}

	lockPath := filepath.Join(home, ownershipFilename)
	if _, err := os.Stat(lockPath); err != nil {
		t.Fatalf("stable lock file is missing: %v", err)
	}
	if runtime.GOOS != "windows" {
		assertMode(t, lockPath, 0o600)
	}
}
