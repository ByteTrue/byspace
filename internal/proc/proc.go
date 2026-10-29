package proc

import (
	"context"
	"os/exec"
	"time"
)

var waitDelay = 2 * time.Second

// Command returns an *exec.Cmd configured with Windows batch-quoting and CREATE_NO_WINDOW
// when the parent is a GUI process with no console (ported from magpie's internal/proc/proc.go).
func Command(name string, arg ...string) *exec.Cmd {
	cmd := exec.Command(name, arg...)
	batch(cmd)
	HideWindow(cmd)
	return cmd
}

// CommandContext is like exec.CommandContext with WaitDelay, descendant tree termination,
// Windows batch-quoting, and CREATE_NO_WINDOW.
func CommandContext(ctx context.Context, name string, arg ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, arg...)
	cmd.WaitDelay = waitDelay
	cancelTree(cmd)
	batch(cmd)
	HideWindow(cmd)
	return cmd
}
