//go:build !windows

package proc

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestProcessIdentityRejectsLiveReplacement(t *testing.T) {
	pid := os.Getpid()
	if CaptureProcessIdentity(pid) == "" {
		t.Skip("process start identity is unavailable")
	}
	if processIdentityMatches(pid, "different-start-time") {
		t.Fatal("a live process matched a different original identity")
	}
}

func TestShutdownProcessTreeKillsDescendantAfterRootExits(t *testing.T) {
	pidPath := filepath.Join(t.TempDir(), "child.pid")
	cmd := exec.Command("/bin/sh", "-c", fmt.Sprintf("trap '' TERM; sleep 300 </dev/null >/dev/null 2>&1 & echo $! > %q; exit 0", pidPath))
	cmd.SysProcAttr = OwnProcessGroup(cmd.SysProcAttr)
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot spawn shell: %v", err)
	}
	identity := CaptureProcessIdentity(cmd.Process.Pid)
	if identity == "" {
		t.Fatal("could not capture root process identity")
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	var pid int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if raw, err := os.ReadFile(pidPath); err == nil {
			pid, err = strconv.Atoi(strings.TrimSpace(string(raw)))
			if err != nil {
				t.Fatal(err)
			}
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if pid <= 0 {
		t.Fatal("descendant PID was not written")
	}
	defer func() { _ = syscall.Kill(pid, syscall.SIGKILL) }()
	done := make(chan struct{})
	close(done)
	ShutdownProcessTree(cmd.Process.Pid, done, identity)
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(pid, 0); err != nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("descendant %d survived after root exited", pid)
}
