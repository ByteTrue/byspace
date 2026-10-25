//go:build !windows

package providers

import (
	"context"
	"os/exec"
	"syscall"
)

// defaultStartProcess launches a child in its own process group.
//
// A separate group is what makes termination work: `opencode serve` spawns language servers and MCP
// children, and killing only the parent leaves them holding ports until the machine reboots.
func defaultStartProcess(ctx context.Context, command string, args []string, dir string, env []string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = dir
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

// killProcessGroup signals the child's whole process group.
func killProcessGroup(cmd *exec.Cmd, force bool) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	// A command that never started has pid 0, and `kill(-0)` signals OUR OWN process group — which
	// would take the daemon down with it. Guarded before the signal is computed.
	if cmd.Process.Pid <= 0 {
		return nil
	}
	signal := syscall.SIGTERM
	if force {
		signal = syscall.SIGKILL
	}
	// Negative pid addresses the group. Falling back to the single process is better than leaving the
	// child alive when the group was never created (an early start failure).
	if err := syscall.Kill(-cmd.Process.Pid, signal); err != nil {
		if force {
			return cmd.Process.Kill()
		}
		return cmd.Process.Signal(signal)
	}
	return nil
}

// ownProcessGroup puts a hand-started child in its own group.
//
// Used where the process must be started manually (pipes are wired before Start), so the caller
// cannot go through defaultStartProcess. Without it, killing the child leaves its descendants
// holding the stdout pipe, and the drain goroutines never see EOF.
func ownProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}
