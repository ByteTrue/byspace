//go:build windows

package proc

import (
	"strconv"
	"syscall"
)

// OwnProcessGroup keeps console signals for the child separate from the daemon. Windows tree
// termination itself is addressed by the root PID through taskkill /T.
func OwnProcessGroup(attr *syscall.SysProcAttr) *syscall.SysProcAttr {
	if attr == nil {
		attr = &syscall.SysProcAttr{}
	}
	attr.CreationFlags |= syscall.CREATE_NEW_PROCESS_GROUP
	return attr
}

func processTreeAlivePlatform(pid int, rootComplete bool, identity string) bool {
	if pid <= 0 || !processIdentityMatches(pid, identity) {
		return false
	}
	if !rootComplete && processAlive(pid) {
		return true
	}
	for _, descendant := range descendants(uint32(pid)) {
		if processAlive(int(descendant)) {
			return true
		}
	}
	return false
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := syscall.OpenProcess(0x1000, false, uint32(pid)) // PROCESS_QUERY_LIMITED_INFORMATION
	if err != nil {
		return false
	}
	defer func() { _ = syscall.CloseHandle(handle) }()
	var code uint32
	if err := syscall.GetExitCodeProcess(handle, &code); err != nil {
		return false
	}
	return code == 259 // STILL_ACTIVE
}

func signalOwnedProcessTree(pid int, force bool, identity string) {
	if !processIdentityMatches(pid, identity) {
		return
	}
	SignalProcessTree(pid, force)
}

// SignalProcessTree ends the root and everything it spawned. taskkill without /F is the
// graceful close request; /F handles console processes and children that ignored it.
func SignalProcessTree(pid int, force bool) {
	if pid <= 0 {
		return
	}
	args := []string{"/PID", strconv.Itoa(pid), "/T"}
	if force {
		// A root that already exited cannot anchor taskkill /T; enumerate its remaining descendants.
		killDescendants(pid)
		args = append(args, "/F")
	}
	cmd := Command("taskkill", args...)
	cmd.SysProcAttr = OwnProcessGroup(cmd.SysProcAttr)
	_ = cmd.Run()
}
