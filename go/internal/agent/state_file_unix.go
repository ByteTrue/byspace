//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package agent

import "os"

func atomicReplace(source, destination string) error {
	return os.Rename(source, destination)
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
