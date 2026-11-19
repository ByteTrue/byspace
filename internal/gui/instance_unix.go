//go:build !windows

package gui

import (
	"os"
	"path/filepath"
	"syscall"
)

var heldGUILockFile *os.File

// acquireOrHandOverGUILock ensures only one desktop tray/supervisor instance runs per BYSPACE_HOME.
// If another instance already holds gui.lock, it opens the local web UI (or installed PWA) when requested and returns true.
func acquireOrHandOverGUILock(homeDir string, showMain bool, initialLink string) bool {
	if homeDir == "" {
		return false
	}
	lockPath := filepath.Join(homeDir, "gui.lock")
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return false
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		if showMain || initialLink != "" {
			_ = OpenLocalWebApp(ResolveLocalWebURL(homeDir, initialLink))
		}
		return true
	}
	heldGUILockFile = f
	return false
}
