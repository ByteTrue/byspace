package daemon

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The lock must round-trip its metadata: pid alone cannot distinguish a running daemon from a
// recycled pid after a crash.
func TestPIDLockRoundTrip(t *testing.T) {
	dir := t.TempDir()
	listen := "127.0.0.1:6778"
	if err := WritePIDLock(dir, PIDLockInfo{PID: os.Getpid(), Listen: &listen}); err != nil {
		t.Fatal(err)
	}
	info, ok := ReadPIDLock(dir)
	if !ok {
		t.Fatal("lock did not parse")
	}
	if info.PID != os.Getpid() {
		t.Fatalf("pid = %d", info.PID)
	}
	if info.Listen == nil || *info.Listen != listen {
		t.Fatalf("listen = %v", info.Listen)
	}
	if info.StartedAt == "" || info.Hostname == "" {
		t.Fatalf("metadata missing: %+v", info)
	}
}

// Homes written before the JSON lock existed hold a bare integer; reading one must still work.
func TestPIDLockReadsLegacyBarePID(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "byspace.pid"), []byte("4242\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, ok := ReadPIDLock(dir)
	if !ok || info.PID != 4242 {
		t.Fatalf("legacy lock: ok=%v info=%+v", ok, info)
	}
}

func TestPIDLockStaleWhenProcessGone(t *testing.T) {
	dir := t.TempDir()
	// A pid that cannot be alive.
	if err := WritePIDLock(dir, PIDLockInfo{PID: 999_999_999}); err != nil {
		t.Fatal(err)
	}
	info, _ := ReadPIDLock(dir)
	if !IsStale(dir, info) {
		t.Fatal("a dead pid must be stale")
	}
}

// A live pid with an old heartbeat is a recycled pid, not our daemon.
func TestPIDLockStaleWhenHeartbeatOld(t *testing.T) {
	dir := t.TempDir()
	if err := WritePIDLock(dir, PIDLockInfo{PID: os.Getpid()}); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * PidLockStaleAfter)
	if err := os.Chtimes(filepath.Join(dir, "byspace.pid"), old, old); err != nil {
		t.Fatal(err)
	}
	info, _ := ReadPIDLock(dir)
	if !IsStale(dir, info) {
		t.Fatal("an expired heartbeat must be stale even when the pid is alive")
	}

	TouchPIDLock(dir)
	info, _ = ReadPIDLock(dir)
	if IsStale(dir, info) {
		t.Fatal("a fresh heartbeat must not be stale")
	}
}
