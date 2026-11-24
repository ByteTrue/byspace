package server

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/proc"
	"github.com/ByteTrue/byspace/internal/store"
)

func TestStopWorkspaceSetupReturnsWhenRunNeverCompletes(t *testing.T) {
	oldTimeout := setupRunCompletionTimeout
	setupRunCompletionTimeout = 20 * time.Millisecond
	t.Cleanup(func() { setupRunCompletionTimeout = oldTimeout })
	srv := &Server{setupRuns: map[string]*workspaceSetupRun{"ws_stuck": {done: make(chan struct{})}}}
	started := time.Now()
	srv.stopWorkspaceSetup("ws_stuck")
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("bounded setup wait took %v", elapsed)
	}
	srv.setupRunsMu.Lock()
	stopping := srv.setupRuns["ws_stuck"].stopping
	srv.setupRunsMu.Unlock()
	if !stopping {
		t.Fatal("stuck setup run was not marked stopping")
	}
}

func TestStopWorkspaceSetupTerminatesRunAndPreventsLaterCommands(t *testing.T) {
	srv, err := New(Options{HomeDir: filepath.Join(t.TempDir(), "home"), Version: "test", PiCommand: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	dir := t.TempDir()
	ws := store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: dir, DisplayName: "w", Kind: "directory",
		CreatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertWorkspace(ws); err != nil {
		t.Fatal(err)
	}

	pidPath := filepath.Join(dir, "child.pid")
	secondPath := filepath.Join(dir, "second-ran")
	var first, second string
	if runtime.GOOS == "windows" {
		quote := func(path string) string { return "'" + strings.ReplaceAll(path, "'", "''") + "'" }
		first = fmt.Sprintf("$p = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 300'; Set-Content -LiteralPath %s -Value $p.Id; Start-Sleep -Seconds 300", quote(pidPath))
		second = fmt.Sprintf("Set-Content -LiteralPath %s -Value ran", quote(secondPath))
	} else {
		first = fmt.Sprintf("sleep 300 & child=$!; echo \"$child\" > %q; wait \"$child\"", pidPath)
		second = fmt.Sprintf("touch %q", secondPath)
	}

	setupDone := make(chan struct{})
	go func() {
		srv.runWorkspaceSetup("ws_1", dir, "main", []string{first, second})
		close(setupDone)
	}()

	var pid int
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		srv.setupRunsMu.Lock()
		run := srv.setupRuns["ws_1"]
		active := run != nil && run.cmd != nil && run.cmd.Process != nil
		srv.setupRunsMu.Unlock()
		data, err := os.ReadFile(pidPath)
		if active && err == nil {
			pid, err = strconv.Atoi(strings.TrimSpace(string(data)))
			if err != nil {
				t.Fatal(err)
			}
			break
		}
		select {
		case <-setupDone:
			t.Fatal("setup finished before the active command was observed")
		default:
		}
		time.Sleep(20 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("timed out waiting for the setup descendant")
	}
	defer proc.SignalProcessTree(pid, true)

	stopDone := make(chan struct{})
	go func() {
		srv.stopWorkspaceSetup("ws_1")
		close(stopDone)
	}()
	select {
	case <-stopDone:
	case <-time.After(10 * time.Second):
		t.Fatal("stopWorkspaceSetup did not wait for termination to finish")
	}
	select {
	case <-setupDone:
	default:
		t.Fatal("setup run was still active after stopWorkspaceSetup returned")
	}
	if _, err := os.Stat(secondPath); !os.IsNotExist(err) {
		t.Fatalf("later setup command ran after archive: %v", err)
	}

	srv.mu.Lock()
	snap := srv.setupSnapshots["ws_1"]
	srv.mu.Unlock()
	snap.mu.Lock()
	status, errText := snap.Status, snap.Error
	snap.mu.Unlock()
	if status != "failed" || errText == nil || *errText != "workspace archived" {
		t.Fatalf("setup status = %q, error = %v", status, errText)
	}

	var killErr error
	if runtime.GOOS == "windows" {
		killErr = proc.Command("taskkill", "/PID", strconv.Itoa(pid), "/F").Run()
	} else {
		killErr = proc.Command("kill", "-0", strconv.Itoa(pid)).Run()
	}
	if killErr == nil {
		t.Fatal("setup descendant survived archive teardown")
	}
}
