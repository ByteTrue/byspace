//go:build !windows && !nogui

package gui

// prepareNotificationPlatform is a no-op outside Windows: macOS asks for authorization and Linux
// uses the session bus, neither of which needs a COM apartment on the calling thread.
func prepareNotificationPlatform() bool { return true }

// pumpNotificationPlatform is a no-op outside Windows: nothing dispatches activations through the
// calling thread there.
func pumpNotificationPlatform() {}
