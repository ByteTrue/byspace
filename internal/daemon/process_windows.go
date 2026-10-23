//go:build windows

package daemon

import "syscall"

// stillActive is STILL_ACTIVE from processthreadsapi.h. The kernel reports a running process by
// leaving its exit code at this sentinel, which is why liveness needs the exit code, not just
// a successful OpenProcess.
const stillActive = 259

// processAlive opens the process and reads its exit code. OpenProcess fails for a pid that is
// gone, which is the only portable answer on Windows: the kernel has no signal-0 equivalent.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := syscall.OpenProcess(syscall.PROCESS_QUERY_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer func() { _ = syscall.CloseHandle(handle) }()
	var code uint32
	if err := syscall.GetExitCodeProcess(handle, &code); err != nil {
		return false
	}
	return code == stillActive
}

// terminateProcess ends the process. Windows has no SIGTERM: Node's process.kill(pid, "SIGTERM")
// is TerminateProcess there too, so a graceful request is not available to match.
func terminateProcess(pid int) error {
	return killProcess(pid)
}

// killProcess terminates the process by handle.
func killProcess(pid int) error {
	handle, err := syscall.OpenProcess(syscall.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer func() { _ = syscall.CloseHandle(handle) }()
	return syscall.TerminateProcess(handle, 1)
}
