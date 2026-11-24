//go:build windows

package proc

import (
	"errors"
	"strconv"

	"golang.org/x/sys/windows"
)

func queryProcessIdentityPlatform(pid int) (string, bool, error) {
	if pid <= 0 {
		return "", false, nil
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return "", false, nil
		}
		return "", true, err
	}
	defer windows.CloseHandle(h)
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &created, &exited, &kernel, &user); err != nil {
		return "", true, err
	}
	started := int64(created.HighDateTime)<<32 | int64(created.LowDateTime)
	return strconv.FormatInt(started, 10), true, nil
}
