//go:build !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !windows

package hub

import "os"

func replaceRelationshipFile(source, destination string) error {
	return os.Rename(source, destination)
}

func syncRelationshipDirectory(string) error { return nil }
