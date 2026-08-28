//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package cli

import (
	"errors"
	"fmt"
	"os/exec"
	"syscall"
)

func detach(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

func pollChildExit(command *exec.Cmd) (bool, error) {
	var status syscall.WaitStatus
	pid, err := syscall.Wait4(command.Process.Pid, &status, syscall.WNOHANG, nil)
	if err != nil {
		return false, err
	}
	if pid == 0 {
		return false, nil
	}
	if status.Exited() {
		return true, fmt.Errorf("exit status %d", status.ExitStatus())
	}
	if status.Signaled() {
		return true, fmt.Errorf("signal %s", status.Signal())
	}
	return true, errors.New("unknown child exit status")
}
