//go:build !windows

package jsonl

import (
	"os/exec"
	"syscall"
)

// setupProcessGroup puts the child in its own process group.
//
// A provider CLI spawns its own children (MCP bridges, language servers). Killing only the
// parent leaves those running with no owner, holding ports and file descriptors until the
// machine reboots. A separate group lets close kill the whole tree with one signal.
func setupProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// killProcessTree terminates the child and everything in its process group.
func killProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	// Negative pid addresses the whole group.
	if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil {
		// Fall back to the single process: the group may not have been created (an early
		// start failure) and leaving the child alive is worse than an unresolved group.
		_ = cmd.Process.Kill()
	}
}
