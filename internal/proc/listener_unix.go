//go:build !windows

package proc

import (
	"errors"
	"syscall"
)

func terminate(pid int) error { return sig(pid, syscall.SIGTERM) }
func kill(pid int) error      { return sig(pid, syscall.SIGKILL) }

func sig(pid int, s syscall.Signal) error {
	err := syscall.Kill(pid, s)
	if errors.Is(err, syscall.EPERM) {
		return ErrDenied
	}
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
