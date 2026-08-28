//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package pi

import (
	"errors"
	"os/exec"
	"syscall"
)

type processTree struct{}

func configureProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func attachProcessTree(_ *exec.Cmd) (*processTree, error) {
	return &processTree{}, nil
}

func (tree *processTree) terminate(command *exec.Cmd, force bool) error {
	signal := syscall.SIGTERM
	if force {
		signal = syscall.SIGKILL
	}
	err := syscall.Kill(-command.Process.Pid, signal)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func (tree *processTree) close() error { return nil }
