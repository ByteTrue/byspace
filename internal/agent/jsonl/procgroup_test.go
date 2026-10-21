package jsonl

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Killing a provider must reach its children: a CLI spawns MCP bridges and language servers, and
// killing only the parent leaves them running with no owner.
func TestCloseKillsProcessTree(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "grandchild.pid")
	// The "provider" starts a grandchild, records its pid, then waits forever.
	script := `sleep 300 & echo $! > "` + pidFile + `"; wait`

	proc, err := Start(LaunchConfig{Command: "/bin/sh", Args: []string{"-c", script}})
	if err != nil {
		t.Skip("cannot spawn:", err)
	}

	var grandchild string
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && grandchild == "" {
		if raw, readErr := os.ReadFile(pidFile); readErr == nil {
			grandchild = strings.TrimSpace(string(raw))
		}
		if grandchild == "" {
			time.Sleep(50 * time.Millisecond)
		}
	}
	if grandchild == "" {
		_ = proc.Close()
		t.Skip("grandchild pid not observed")
	}

	// Bound the close: without the process-group kill, Close blocks forever waiting on a child
	// that will never exit, and a hanging test is a worse signal than a failing one.
	closed := make(chan struct{})
	go func() {
		_ = proc.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not return: the process tree was not killed")
	}
	time.Sleep(400 * time.Millisecond)

	// `kill -0` succeeds only while the pid exists.
	if killErr := exec.Command("kill", "-0", grandchild).Run(); killErr == nil {
		t.Fatalf("grandchild %s survived Close: the process group was not killed", grandchild)
	}
}
