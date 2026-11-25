//go:build windows

package proc

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
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

func TestDescendantsRetriesTransientSnapshotFailure(t *testing.T) {
	oldCreate := createProcessSnapshot
	t.Cleanup(func() { createProcessSnapshot = oldCreate })
	calls := 0
	createProcessSnapshot = func(flags, pid uint32) (windows.Handle, error) {
		calls++
		if calls < 3 {
			return 0, windows.ERROR_BAD_LENGTH
		}
		return oldCreate(flags, pid)
	}
	if _, err := descendants(uint32(os.Getpid())); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("snapshot calls = %d, want 3", calls)
	}
}

func TestDescendantsReturnsTerminalSnapshotFailure(t *testing.T) {
	oldCreate := createProcessSnapshot
	t.Cleanup(func() { createProcessSnapshot = oldCreate })
	calls := 0
	createProcessSnapshot = func(uint32, uint32) (windows.Handle, error) {
		calls++
		return 0, windows.ERROR_BAD_LENGTH
	}
	if _, err := descendants(uint32(os.Getpid())); err == nil {
		t.Fatal("terminal snapshot failure was discarded")
	}
	if calls != 3 {
		t.Fatalf("snapshot calls = %d, want 3", calls)
	}
}

func TestDescendantsReturnsEnumerationFailure(t *testing.T) {
	oldCreate := createProcessSnapshot
	t.Cleanup(func() { createProcessSnapshot = oldCreate })
	createProcessSnapshot = func(uint32, uint32) (windows.Handle, error) { return 0, nil }
	if _, err := descendants(uint32(os.Getpid())); err == nil {
		t.Fatal("process enumeration failure was discarded")
	}
}

func TestKillDescendantsSkipsFailedSnapshot(t *testing.T) {
	oldList, oldTerminate := listDescendants, terminateProcesses
	t.Cleanup(func() { listDescendants, terminateProcesses = oldList, oldTerminate })
	listDescendants = func(uint32) ([]uint32, error) { return nil, errors.New("snapshot failed") }
	terminated := false
	terminateProcesses = func([]uint32) { terminated = true }
	killDescendants(os.Getpid())
	if terminated {
		t.Fatal("processes were terminated from a failed snapshot")
	}
}

func TestForceKillDescendantsRetriesFailedSnapshot(t *testing.T) {
	oldList, oldTerminate := listDescendants, terminateProcesses
	t.Cleanup(func() { listDescendants, terminateProcesses = oldList, oldTerminate })
	pid := os.Getpid()
	calls := 0
	listDescendants = func(uint32) ([]uint32, error) {
		calls++
		if calls < 3 {
			return nil, errors.New("snapshot failed")
		}
		if calls == 3 {
			return []uint32{uint32(pid)}, nil
		}
		return nil, nil
	}
	var terminated []uint32
	terminateProcesses = func(pids []uint32) { terminated = append(terminated, pids...) }
	forceKillDescendants(pid, time.Second)
	if len(terminated) != 1 || terminated[0] != uint32(pid) {
		t.Fatalf("terminated processes = %v, want %d", terminated, pid)
	}
	if calls != 4 {
		t.Fatalf("snapshot calls = %d, want 4", calls)
	}
}

func TestProcessTreeAliveDoesNotTrustFailedDescendantSnapshot(t *testing.T) {
	oldList := listDescendants
	t.Cleanup(func() { listDescendants = oldList })
	listDescendants = func(uint32) ([]uint32, error) { return nil, errors.New("snapshot failed") }
	pid := os.Getpid()
	if !processTreeAlivePlatform(pid, true, CaptureProcessIdentity(pid)) {
		t.Fatal("failed descendant snapshot was treated as an exited tree")
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
