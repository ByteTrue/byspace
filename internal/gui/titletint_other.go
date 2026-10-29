//go:build !windows && !nogui

package gui

import "github.com/wailsapp/wails/v3/pkg/application"

const frameOnlyResizeJS = ""

func tintWindowsTitleBar(*application.WebviewWindow, [3]uint8, bool) bool {
	return false
}

func initialWindowsChrome(DesktopSettings) (application.WindowsWindow, application.RGBA) {
	return application.WindowsWindow{}, application.RGBA{}
}
