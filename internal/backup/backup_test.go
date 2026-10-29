package backup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotDeduplicatesAndRestores(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(cfgPath, []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}

	// 1. First snapshot writes a backup archive.
	arch1, created, err := Snapshot(dir)
	if err != nil || !created || arch1 == "" {
		t.Fatalf("first Snapshot: created=%v arch=%q err=%v", created, arch1, err)
	}

	// 2. Second snapshot with identical content is deduplicated (created=false).
	if _, created2, err := Snapshot(dir); err != nil || created2 {
		t.Fatalf("expected deduplicated no-op snapshot, got created=%v err=%v", created2, err)
	}

	// 3. Corrupt config.json and restore from arch1.
	if err := os.WriteFile(cfgPath, []byte("corrupted"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Restore(dir, arch1); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	got, err := os.ReadFile(cfgPath)
	if err != nil || string(got) != `{"version":1}` {
		t.Fatalf("after Restore got %q, %v", got, err)
	}
}
