//go:build windows

package proc

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
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
	quoted := "'" + strings.ReplaceAll(pidPath, "'", "''") + "'"
	script := fmt.Sprintf("$p = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 300'; Set-Content -LiteralPath %s -Value $p.Id; exit 0", quoted)
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	cmd.SysProcAttr = OwnProcessGroup(cmd.SysProcAttr)
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot spawn PowerShell: %v", err)
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
	defer func() {
		if processAlive(pid) {
			killAll([]uint32{uint32(pid)})
		}
	}()
	done := make(chan struct{})
	close(done)
	ShutdownProcessTree(cmd.Process.Pid, done, identity)
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("descendant %d survived after root exited", pid)
}
