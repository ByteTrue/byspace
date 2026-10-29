//go:build windows && !nogui

package gui

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows"
)

var procGetForegroundWindow = windows.NewLazySystemDLL("user32.dll").NewProc("GetForegroundWindow")

func dropWebView(*application.WebviewWindow) {}

func isWindowFocusedOnMain(w *application.WebviewWindow) bool {
	if w == nil {
		return false
	}
	hwnd := uintptr(w.NativeWindow())
	if hwnd == 0 {
		return false
	}
	fg, _, _ := procGetForegroundWindow.Call()
	return fg == hwnd
}
