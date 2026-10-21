//go:build windows

package providers

import (
	"context"
	"os/exec"
	"strconv"
)

// defaultStartProcess launches a child.
//
// Windows has no process groups in the POSIX sense; `taskkill /T` is what kills a tree, and it is
// invoked from killProcessGroup.
func defaultStartProcess(ctx context.Context, command string, args []string, dir string, env []string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = dir
	cmd.Env = env
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

// killProcessGroup terminates the child and its children with taskkill.
func killProcessGroup(cmd *exec.Cmd, force bool) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	args := []string{"/PID", itoaPID(cmd.Process.Pid), "/T"}
	if force {
		args = append(args, "/F")
	}
	if err := exec.Command("taskkill", args...).Run(); err != nil {
		return cmd.Process.Kill()
	}
	return nil
}

// itoaPID renders a pid for taskkill's argument list.
func itoaPID(pid int) string {
	return strconv.Itoa(pid)
}
