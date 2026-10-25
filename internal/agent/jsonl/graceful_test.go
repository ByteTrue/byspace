//go:build !windows

package jsonl

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// A provider killed with SIGKILL can lose its session file — the transcript is the user's
// history, so the close path gives it a chance to flush before escalating.
func TestCloseAllowsGracefulFlush(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	dir := t.TempDir()
	marker := filepath.Join(dir, "flushed")
	// The "provider" traps SIGTERM, writes its state, then exits — exactly what pi does when it
	// finalises a session.
	script := `trap 'echo flushed > "` + marker + `"; exit 0' TERM; while true; do sleep 0.05; done`

	proc, err := Start(LaunchConfig{Command: "/bin/sh", Args: []string{"-c", script}})
	if err != nil {
		t.Skip("cannot spawn:", err)
	}

	// Give the shell a moment to install the trap.
	time.Sleep(200 * time.Millisecond)
	if err := proc.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// The trap must have run: SIGTERM reached it before any SIGKILL.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, statErr := os.Stat(marker); statErr == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the process was killed without a chance to flush: no SIGTERM handler ran")
}

// A process that ignores SIGTERM must still be reaped, or the daemon hangs on a stuck child.
func TestCloseEscalatesWhenGracefulIsIgnored(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	proc, err := Start(LaunchConfig{Command: "/bin/sh", Args: []string{"-c", `trap '' TERM; while true; do sleep 0.05; done`}})
	if err != nil {
		t.Skip("cannot spawn:", err)
	}
	time.Sleep(200 * time.Millisecond)

	done := make(chan error, 1)
	go func() { done <- proc.Close() }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Close did not return for a process ignoring SIGTERM")
	}
}
