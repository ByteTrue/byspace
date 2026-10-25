//go:build !windows

package daemon

import "syscall"

// processAlive reports whether a pid exists and can be signalled.
func processAlive(pid int) bool {
	return pid > 0 && syscall.Kill(pid, 0) == nil
}

// terminateProcess asks a process to exit. The daemon treats SIGTERM as "finish the write you
// are in and leave", which is why stop waits for it before escalating.
func terminateProcess(pid int) error {
	return syscall.Kill(pid, syscall.SIGTERM)
}

// killProcess ends a process that ignored terminateProcess.
func killProcess(pid int) error {
	return syscall.Kill(pid, syscall.SIGKILL)
}
