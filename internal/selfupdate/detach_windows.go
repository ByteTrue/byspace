//go:build windows

package selfupdate

import "os/exec"

func detachProcess(*exec.Cmd) {}
