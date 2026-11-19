//go:build !windows

package gui

import (
	"os"
	"runtime"

	"github.com/ByteTrue/byspace/internal/proc"
)

func openFolder(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	opener := "xdg-open"
	if runtime.GOOS == "darwin" {
		opener = "open"
	}
	cmd := proc.Command(opener, path)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
