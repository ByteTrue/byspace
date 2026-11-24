//go:build !windows

package proc

import (
	"errors"
	"syscall"
)

// OwnProcessGroup arranges for tree signals to reach the command and its descendants.
func OwnProcessGroup(attr *syscall.SysProcAttr) *syscall.SysProcAttr {
	if attr == nil {
		attr = &syscall.SysProcAttr{}
	}
	if !attr.Setsid {
		attr.Setpgid = true
	}
	return attr
}

func processTreeAlivePlatform(pid int, rootComplete bool, identity string) bool {
	if pid <= 0 || !processIdentityMatches(pid, identity) {
		return false
	}
	groupErr := syscall.Kill(-pid, 0)
	if groupErr == nil || errors.Is(groupErr, syscall.EPERM) {
		return true
	}
	if rootComplete {
		return false
	}
	processErr := syscall.Kill(pid, 0)
	return processErr == nil || errors.Is(processErr, syscall.EPERM)
}

func signalOwnedProcessTree(pid int, force bool, identity string) {
	if !processIdentityMatches(pid, identity) {
		return
	}
	SignalProcessTree(pid, force)
}

// SignalProcessTree signals the process group, falling back to the direct process if the group
// already disappeared. ShutdownProcessTree uses signalOwnedProcessTree to validate identity first.
func SignalProcessTree(pid int, force bool) {
	if pid <= 0 {
		return
	}
	signal := syscall.SIGTERM
	if force {
		signal = syscall.SIGKILL
	}
	if err := syscall.Kill(-pid, signal); err != nil {
		_ = syscall.Kill(pid, signal)
	}
}
