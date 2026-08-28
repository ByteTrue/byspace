//go:build !windows && !aix && !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris

package pi

import "os/exec"

type processTree struct{}

func configureProcess(_ *exec.Cmd) {}

func attachProcessTree(_ *exec.Cmd) (*processTree, error) {
	return &processTree{}, nil
}

func (tree *processTree) terminate(command *exec.Cmd, _ bool) error {
	return command.Process.Kill()
}

func (tree *processTree) close() error { return nil }
