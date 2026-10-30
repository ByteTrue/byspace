//go:build android && !nogui

package cli

import (
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func init() {
	application.RegisterAndroidMain(func() {
		os.Exit(Main("0.23.3", os.Args[1:], os.Stdout, os.Stderr))
	})
}
