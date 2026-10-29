//go:build windows

package server

import (
	"github.com/ByteTrue/byspace/internal/proc"
	"os/exec"
	"strconv"
	"syscall"
)

// setupProcessGroup opens the script's shell in a new process group.
//
// Windows has no POSIX groups: a process tree is addressed by pid through `taskkill /T`, and
// CREATE_NEW_PROCESS_GROUP keeps the shell's console signals from reaching the daemon.
func setupProcessGroup(cmd *exec.Cmd) {
	proc.HideWindow(cmd)
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= syscall.CREATE_NEW_PROCESS_GROUP
}

// terminateProcessGroup ends the shell and everything it spawned.
//
// taskkill without /F asks for a window close, which a console script honours the same way a
// SIGTERM handler does.
func terminateProcessGroup(pid int) {
	_ = proc.Command("taskkill", "/PID", strconv.Itoa(pid), "/T").Run()
}

// killProcessGroup force-ends the tree, including children that ignored the request.
func killProcessGroup(pid int) {
	_ = proc.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
}
