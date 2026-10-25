//go:build windows

package jsonl

import "os/exec"

// setupProcessGroup is a no-op on Windows, where a job object would be required; the CLI
// children of a provider are terminated through the console control path instead.
func setupProcessGroup(_ *exec.Cmd) {}

// killProcessTree terminates the direct child. Windows needs a Job Object to reach
// grandchildren, which is tracked separately from this port.
func killProcessTree(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
