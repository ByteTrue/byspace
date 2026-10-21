//go:build windows

package jsonl

import "os/exec"

// terminateProcessTree is a hard kill on Windows: there is no SIGTERM, and a console control
// event needs a Job Object plus a shared console. Recorded as a platform gap.
func terminateProcessTree(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
