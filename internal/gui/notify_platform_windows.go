//go:build windows && !nogui

package gui

import (
	"log"
	"runtime"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
)

// prepareNotificationPlatform joins a single-threaded COM apartment before the notification
// service starts.
//
// Wails' Windows implementation registers a COM class factory on the calling thread
// (CoRegisterClassObject). On an ordinary goroutine that call fails with "CoInitialize has not
// been called", the service reports itself unavailable, and every notification falls back to the
// webview's own browser notification — which Windows labels with the webview origin, not with the
// app (`wails.localhost`).
func prepareNotificationPlatform() bool {
	runtime.LockOSThread()
	err := windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED)
	// S_FALSE means "this thread was already in an apartment", which is fine.
	if err != nil && err != syscall.Errno(1) {
		log.Printf("byspace notifications: CoInitializeEx: %v", err)
		return false
	}
	return true
}

// pumpNotificationPlatform keeps the apartment alive and dispatches click activations.
//
// The class factory registration is tied to the apartment: dropping the thread would revoke it,
// so the caller's goroutine stays on its locked OS thread and runs the message loop. Toast clicks
// arrive as messages on it — that is how OnNotificationResponse fires.
func pumpNotificationPlatform() {
	var msg w32.MSG
	for {
		switch w32.GetMessage(&msg, 0, 0, 0) {
		case 0, -1:
			// WM_QUIT or an error: nothing left to dispatch.
			windows.CoUninitialize()
			return
		default:
			w32.TranslateMessage(&msg)
			w32.DispatchMessage(&msg)
		}
	}
}
