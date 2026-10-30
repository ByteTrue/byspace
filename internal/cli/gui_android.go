//go:build android && !nogui

package cli

import (
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DefaultVersion is populated via -ldflags on Android shared-library builds.
var DefaultVersion = "dev"

func init() {
	application.RegisterAndroidMain(func() {
		os.Exit(Main(DefaultVersion, os.Args[1:], os.Stdout, os.Stderr))
	})
}
