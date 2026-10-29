package proc

import (
	"context"
	"os/exec"
)

// Command returns an *exec.Cmd configured so that on Windows, when the parent
// process is a GUI app with no console, the child starts with CREATE_NO_WINDOW
// instead of flashing a black console window (ported from magpie's internal/proc).
func Command(name string, arg ...string) *exec.Cmd {
	cmd := exec.Command(name, arg...)
	HideWindow(cmd)
	return cmd
}

// CommandContext is like exec.CommandContext but applies HideWindow on Windows.
func CommandContext(ctx context.Context, name string, arg ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, arg...)
	HideWindow(cmd)
	return cmd
}
