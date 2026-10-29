//go:build windows

package proc

import (
	"context"
	"errors"
	"os/exec"
	"strconv"
	"strings"

	"golang.org/x/sys/windows"
)

func listeningOn(ctx context.Context, port int) ([]int, error) {
	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command",
		`try { Get-NetTCPConnection -State Listen -LocalPort `+strconv.Itoa(port)+` -ErrorAction Stop | ForEach-Object { $_.OwningProcess } } `+
			`catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { exit 0 }; [Console]::Error.WriteLine($_); exit 1 }`).Output()
	if err != nil {
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
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &n); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buf[:n]), nil
}

func terminate(pid int) error { return kill(pid) }

func kill(pid int) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return ErrDenied
		}
		if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return nil
		}
		return err
	}
	defer windows.CloseHandle(h)
	if err := windows.TerminateProcess(h, 1); err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return ErrDenied
		}
		return err
	}
	return nil
}
