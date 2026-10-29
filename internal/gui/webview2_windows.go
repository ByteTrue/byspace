//go:build windows && !nogui

package gui

import (
	"log"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows"
)

const (
	webView2DownloadURL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
	mbYesNo             = 0x00000004
	mbIconError         = 0x00000010
	mbSetForeground     = 0x00010000
	mbTopmost           = 0x00040000
	idYes               = 6
	webView2BoxStyle    = mbYesNo | mbIconError | mbSetForeground | mbTopmost
)

var procMessageBoxW = windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW")

// checkWebView2Runtime verifies that Microsoft Edge WebView2 Runtime is installed before
// opening windows on Windows, showing a native MessageBoxW with a download link if missing
// (ported from magpie's internal/gui/webview2_windows.go).
func checkWebView2Runtime(app *application.App) bool {
	info := app.Env.Info().PlatformInfo
	if v, ok := info["webview2"].(string); !ok || (v != "" && v != "none" && v != "missing") {
		return true
	}
	log.Printf("byspace: Microsoft Edge WebView2 Runtime is missing; install from %s", webView2DownloadURL)
	title, _ := windows.UTF16PtrFromString("BySpace — WebView2 Runtime Required")
	body, _ := windows.UTF16PtrFromString("BySpace requires the Microsoft Edge WebView2 Runtime to display its window.\n\nOpen the download page now?")
	r, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), webView2BoxStyle)
	if int(r) == idYes {
		verb, _ := windows.UTF16PtrFromString("open")
		urlPtr, _ := windows.UTF16PtrFromString(webView2DownloadURL)
		_ = windows.ShellExecute(0, verb, urlPtr, nil, nil, windows.SW_SHOWNORMAL)
	}
	return false
}
