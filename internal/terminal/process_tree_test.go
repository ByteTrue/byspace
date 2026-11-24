//go:build !windows

package terminal

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCloseKillsTerminalDescendants(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	sess, err := StartSession(StartOptions{
		Command: "/bin/sh",
		Args:    []string{"-c", "trap '' TERM; sleep 300 & echo $! > \"" + pidFile + "\"; wait"},
	})
	if err != nil {
		t.Skip("cannot spawn /bin/sh:", err)
	}
	pid := waitForPIDFile(t, pidFile)
	closed := make(chan struct{})
	go func() {
		_ = sess.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(8 * time.Second):
		t.Fatal("Close did not return after terminating the terminal tree")
	}
	if err := exec.Command("kill", "-0", pid).Run(); err == nil {
		t.Fatalf("terminal descendant %s survived Close", pid)
	}
}

func TestCloseAllowsTerminalGracefulExit(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "flushed")
	sess, err := StartSession(StartOptions{
		Command: "/bin/sh",
		Args:    []string{"-c", "trap 'echo flushed > \"" + marker + "\"; exit 0' TERM; while true; do sleep 0.05; done"},
	})
	if err != nil {
		t.Skip("cannot spawn /bin/sh:", err)
	}
	time.Sleep(200 * time.Millisecond)
	if err := sess.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("terminal did not run its SIGTERM handler: %v", err)
	}
}

func TestCloseEscalatesTerminalThatIgnoresTerminate(t *testing.T) {
	sess, err := StartSession(StartOptions{
		Command: "/bin/sh",
		Args:    []string{"-c", "trap '' TERM; while true; do sleep 0.05; done"},
	})
	if err != nil {
		t.Skip("cannot spawn /bin/sh:", err)
	}
	time.Sleep(200 * time.Millisecond)
	closed := make(chan struct{})
	go func() {
		_ = sess.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(8 * time.Second):
		t.Fatal("Close did not escalate a terminal that ignored SIGTERM")
	}
}

func waitForPIDFile(t *testing.T, path string) string {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if raw, err := os.ReadFile(path); err == nil {
			if pid := strings.TrimSpace(string(raw)); pid != "" {
				return pid
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("terminal child PID was not written")
	return ""
}
