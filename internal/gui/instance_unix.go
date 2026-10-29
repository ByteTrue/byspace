//go:build !windows && !nogui

package gui

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
)

var heldGUILockFile *os.File

// acquireOrHandOverGUILock ensures only one desktop GUI instance runs per BYSPACE_HOME on macOS/Unix.
// If another desktop instance already holds gui.lock, it activates the running app and returns true.
func acquireOrHandOverGUILock(homeDir string, showMain bool, initialLink string) bool {
	if runtime.GOOS == "android" || homeDir == "" {
		return false
	}
	lockPath := filepath.Join(homeDir, "gui.lock")
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return false
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		if runtime.GOOS == "darwin" {
			if initialLink != "" {
				_ = exec.Command("open", initialLink).Run()
			} else if showMain {
				_ = exec.Command("open", "-b", "com.bytetrue.byspace").Run()
			}
		}
		return true
	}
	heldGUILockFile = f
	return false
}
