//go:build !windows

package proc

import "os/exec"

// HideWindow is a no-op outside Windows.
func HideWindow(*exec.Cmd) {}
