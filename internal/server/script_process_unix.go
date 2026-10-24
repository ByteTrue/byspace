//go:build !windows

package server

import (
	"os/exec"
	"syscall"
)

// setupProcessGroup puts the script's shell in its own process group, so stopping it takes the
// children too. A build script spawns npm/vite/go, and signalling only the shell leaves them
// holding their ports.
func setupProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// terminateProcessGroup asks the group to exit.
func terminateProcessGroup(pid int) {
	_ = syscall.Kill(-pid, syscall.SIGTERM)
}

// killProcessGroup ends a group that ignored terminateProcessGroup.
func killProcessGroup(pid int) {
	_ = syscall.Kill(-pid, syscall.SIGKILL)
}
