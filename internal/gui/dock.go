package gui

type dockMove struct {
	policy bool
	again  bool
	front  bool
}

// DockStep computes the macOS Dock activation-policy transition (ported from magpie's dock.go):
// when joining the Dock to the front, again=true triggers activateAgain so BySpace is placed
// first in Command-Tab's order (#1381 / #1651).
func DockStep(regular, on, front bool) dockMove {
	if regular == on {
		return dockMove{}
	}
	return dockMove{policy: true, again: on && front, front: front}
}

// ShouldShowInDock reports whether the app should appear in the macOS Dock given settings,
// whether the main window is currently visible, and whether it is in full screen.
func ShouldShowInDock(s DesktopSettings, windowShown, fullscreen bool) bool {
	if fullscreen {
		return true
	}
	if !s.HideFromDock {
		return true
	}
	return windowShown
}
