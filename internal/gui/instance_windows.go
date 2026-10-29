//go:build windows && !nogui

package gui

func acquireOrHandOverGUILock(_ string, _ bool, _ string) bool {
	return false
}
