//go:build windows

package cli

import (
	"os"
	"syscall"
)

// The Windows desktop binary is linked with -H windowsgui so double-clicking it opens no
// console window. When run from PowerShell or cmd with CLI arguments (e.g. "byspace ls"),
// borrow the parent terminal's console so standard streams print normally (ported from
// magpie's internal/cli/console_windows.go).
func init() {
	if len(os.Args) < 2 {
		return
	}
	if t, err := syscall.GetFileType(syscall.Stdout); err == nil && t != 0 {
		return
	}
	attach := syscall.NewLazyDLL("kernel32.dll").NewProc("AttachConsole")
	const attachParentProcess = ^uintptr(0)
	if r, _, _ := attach.Call(attachParentProcess); r == 0 {
		return
	}
	if out, err := os.OpenFile("CONOUT$", os.O_RDWR, 0); err == nil {
		os.Stdout, os.Stderr = out, out
	}
	if in, err := os.OpenFile("CONIN$", os.O_RDWR, 0); err == nil {
		os.Stdin = in
	}
}
