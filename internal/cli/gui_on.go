//go:build !nogui

package cli

import (
	"io"

	"github.com/ByteTrue/byspace/internal/gui"
	"github.com/ByteTrue/byspace/internal/selfupdate"
)

func init() {
	selfupdate.GUI = true
}

func runGUI(version string, showMain bool, link string) error {
	return gui.Run(version, showMain, link)
}

func runDefaultNoArgs(version string, _ io.Writer) error {
	return gui.Run(version, true, "")
}
