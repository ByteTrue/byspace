//go:build !darwin && !nogui

package gui

import "github.com/wailsapp/wails/v3/pkg/application"

func mainMacWindowOptions() application.MacWindow {
	return application.MacWindow{}
}

// Windows keeps its native system titlebar (with Aero Snap, rounded corners, and native controls).
func configureNativeTitlebar(*application.WebviewWindow) {}
