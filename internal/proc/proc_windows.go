//go:build windows

package proc

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000 // CREATE_NO_WINDOW

var getConsoleWindow = syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")

var hasConsole = func() bool {
	h, _, _ := getConsoleWindow.Call()
	return h != 0
}

// HideWindow sets CREATE_NO_WINDOW on cmd when this process has no console window.
func HideWindow(cmd *exec.Cmd) {
	if cmd == nil || hasConsole() {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
