//go:build !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !windows

package agent

import "os"

func atomicReplace(source, destination string) error {
	return os.Rename(source, destination)
}

func syncDirectory(string) error { return nil }
