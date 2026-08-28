//go:build !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !windows

package daemon

import (
	"errors"
	"os"
)

func lockFile(_ *os.File) (func() error, error) {
	return nil, errors.New("daemon ownership locking is not supported on this platform")
}
