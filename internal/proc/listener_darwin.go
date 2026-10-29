//go:build darwin

package proc

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

func listeningOn(ctx context.Context, port int) ([]int, error) {
	lsof := "/usr/sbin/lsof"
	if _, err := os.Stat(lsof); err != nil {
		lsof = "lsof"
	}
	out, err := exec.CommandContext(ctx, lsof, "-nP", "-a", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN", "-t").Output()
	var ee *exec.ExitError
	if err != nil && !(errors.As(err, &ee) && len(bytes.TrimSpace(out)) == 0) {
		return nil, err
	}
	var ps []int
	seen := map[int]bool{}
	for _, l := range strings.Fields(string(out)) {
		if n, convErr := strconv.Atoi(l); convErr == nil && n > 0 && !seen[n] {
			seen[n] = true
			ps = append(ps, n)
		}
	}
	return ps, nil
}

func executable(pid int) (string, error) {
	b, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil {
		return "", err
	}
	if len(b) < 5 {
		return "", errors.New("no program path")
	}
	b = b[4:]
	if i := bytes.IndexByte(b, 0); i > 0 {
		return string(b[:i]), nil
	}
	return "", errors.New("no program path")
}
