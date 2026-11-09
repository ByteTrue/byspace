package cli

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/daemon"
)

// A restart is only proven by a live, different pid.
//
// The old daemon deletes its pid lock before it closes the listener, so a health answer seen while
// the lock is gone used to count as "restarted" — the CLI printed `restarted pid=0` and returned
// while the process it was asked to replace was still the one answering.
func TestAwaitDaemonRestartNeedsALiveDifferentPID(t *testing.T) {
	health := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","serverId":"srv_test"}`))
	}))
	defer health.Close()
	addr := strings.TrimPrefix(health.URL, "http://")

	homeDir := filepath.Join(t.TempDir(), "home")
	if err := os.MkdirAll(homeDir, 0o700); err != nil {
		t.Fatal(err)
	}

	// The handover window: lock gone, the old process still answering.
	if _, restarted := awaitDaemonRestart(addr, homeDir, os.Getpid(), 300*time.Millisecond); restarted {
		t.Fatal("a missing pid lock was accepted as proof of a restart")
	}

	// A lock whose process is gone is not proof either.
	if err := daemon.WritePID(homeDir, 1<<30); err != nil {
		t.Fatal(err)
	}
	if _, restarted := awaitDaemonRestart(addr, homeDir, os.Getpid(), 300*time.Millisecond); restarted {
		t.Fatal("a dead pid was accepted as proof of a restart")
	}

	// The successor: alive, and not the pid we replaced.
	if err := daemon.WritePID(homeDir, os.Getpid()); err != nil {
		t.Fatal(err)
	}
	pid, restarted := awaitDaemonRestart(addr, homeDir, 0, 2*time.Second)
	if !restarted || pid != os.Getpid() {
		t.Fatalf("expected the live successor to be accepted, got pid=%d restarted=%v", pid, restarted)
	}
}
