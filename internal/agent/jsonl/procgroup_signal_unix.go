//go:build !windows

package jsonl

import (
	"os/exec"
	"syscall"
)

// terminateProcessTree sends SIGTERM to the whole group.
//
// SIGTERM rather than SIGKILL: the provider can still flush its session file. The group is
// signalled negatively so its children (MCP bridges, language servers) go too.
func terminateProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
		_ = cmd.Process.Signal(syscall.SIGTERM)
	}
}
