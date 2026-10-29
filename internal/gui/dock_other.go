//go:build !darwin && !nogui

package gui

func setDock(bool, bool)              {}
func registerDockFullscreenObserver() {}
