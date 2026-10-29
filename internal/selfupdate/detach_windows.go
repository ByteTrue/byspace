//go:build windows

package selfupdate

import (
	"os/exec"
	"syscall"
)

const (
	winSynchronize  = 0x00100000
	winWaitTimeout  = 0x00000102
	winDetachedProc = 0x00000008
	winNewProcGroup = 0x00000200
)

// processAlive reports whether pid is still running on Windows via OpenProcess(SYNCHRONIZE)
// and WaitForSingleObject (ported from magpie's internal/update/proc_windows.go; Go's
// os.Process.Signal(0) always returns EWINDOWS on Windows and cannot test liveness).
func processAlive(pid int) bool {
	h, err := syscall.OpenProcess(winSynchronize, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)
	ev, _ := syscall.WaitForSingleObject(h, 0)
	return ev == winWaitTimeout
}

func detachProcess(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= winDetachedProc | winNewProcGroup
}
