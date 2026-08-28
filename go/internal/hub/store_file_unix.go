//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package hub

import "os"

func replaceRelationshipFile(source, destination string) error {
	return os.Rename(source, destination)
}

func syncRelationshipDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
