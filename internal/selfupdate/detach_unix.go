//go:build !windows

package selfupdate

import (
	"os"
	"os/exec"
	"syscall"
)

func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(syscall.Signal(0)) == nil
}

// detachProcess puts cmd in its own session so macOS launchd does not kill the relaunch shell
// when the parent .app job exits (ported from magpie's runAfterExit / #2362).
func detachProcess(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
