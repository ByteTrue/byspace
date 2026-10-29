//go:build linux && !android

package awake

import (
	"os/exec"
	"syscall"
)

func takeHold(_ bool) (func(), error) {
	path, err := exec.LookPath("systemd-inhibit")
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(path, "--what=idle:sleep", "--who=BySpace", "--why=AI coding agents are working", "--mode=block", "sleep", "infinity")
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return func() {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		_ = cmd.Wait()
	}, nil
}
