//go:build !darwin && !windows && !nogui

package gui

import "github.com/wailsapp/wails/v3/pkg/application"

func dropWebView(*application.WebviewWindow) {}

func isWindowFocusedOnMain(w *application.WebviewWindow) bool {
	return w != nil && w.IsVisible()
}
