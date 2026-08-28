//go:build !(aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris)

package cli

import "os/exec"

func detach(_ *exec.Cmd) {}

func pollChildExit(_ *exec.Cmd) (bool, error) { return false, nil }
