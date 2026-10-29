//go:build !windows

package selfupdate

import (
	"os/exec"
	"syscall"
)

// detachProcess puts cmd in its own session so macOS launchd does not kill the relaunch shell
// when the parent .app job exits (ported from magpie's runAfterExit / #2362).
func detachProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
