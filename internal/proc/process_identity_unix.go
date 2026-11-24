//go:build !windows

package proc

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func queryProcessIdentityPlatform(pid int) (string, bool, error) {
	if pid <= 0 {
		return "", false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ps", "-p", strconv.Itoa(pid), "-o", "lstart=")
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	out, err := cmd.Output()
	if err == nil {
		identity := strings.TrimSpace(string(out))
		if identity == "" {
			return "", true, errors.New("ps returned an empty process start time")
		}
		return identity, true, nil
	}
	if ctx.Err() != nil {
		return "", true, ctx.Err()
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && strings.TrimSpace(string(out)) == "" && strings.TrimSpace(string(exitErr.Stderr)) == "" {
		// ps exits 1 without output when -p matches no process. Other failures carry an
		// error and must not be interpreted as proof that the original root exited.
		return "", false, nil
	}
	return "", true, err
}
