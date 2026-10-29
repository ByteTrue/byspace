//go:build !windows && !nogui

package gui

import "github.com/wailsapp/wails/v3/pkg/application"

func openFolder(app *application.App, path string) error {
	if app == nil {
		return nil
	}
	return app.Env.OpenFileManager(path, false)
}
