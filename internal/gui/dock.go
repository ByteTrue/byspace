package gui

type dockMove struct {
	policy bool
	again  bool
	front  bool
}

// DockStep computes the macOS Dock activation-policy transition (ported from magpie's dock.go).
func DockStep(regular, on, front bool) dockMove {
	if regular == on {
		return dockMove{}
	}
	return dockMove{policy: true, again: on && front, front: front}
}

// ShouldShowInDock reports whether the app should appear in the macOS Dock given settings
// ("show" | "window" | "hide"), whether the main window is currently visible, and full screen.
func ShouldShowInDock(s DesktopSettings, windowShown, fullscreen bool) bool {
	if fullscreen {
		return true
	}
	switch s.EffectiveDockMode() {
	case "hide":
		return false
	case "window":
		return windowShown
	default:
		return true
	}
}
