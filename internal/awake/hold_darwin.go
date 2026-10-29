//go:build darwin

package awake

import (
	"os"
	"os/exec"
	"strconv"
)

func takeHold(display bool) (func(), error) {
	cmd := exec.Command("/usr/bin/caffeinate", caffeinateArgs(display, os.Getpid())...)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}, nil
}

func caffeinateArgs(display bool, pid int) []string {
	args := []string{"-i"}
	if display {
		args = append(args, "-d")
	}
	return append(args, "-w", strconv.Itoa(pid))
}
