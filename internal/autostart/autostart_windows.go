//go:build windows

package autostart

import (
	"errors"

	"golang.org/x/sys/windows/registry"
)

const (
	runKey      = `Software\Microsoft\Windows\CurrentVersion\Run`
	name        = "BySpace"
	approvedKey = `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`
)

func record() string { return "" }

func enabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return !errors.Is(err, registry.ErrNotExist)
	}
	defer k.Close()
	if _, _, err = k.GetStringValue(name); err != nil {
		return !errors.Is(err, registry.ErrNotExist)
	}
	return !switchedOff()
}

func switchedOff() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, approvedKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	b, _, err := k.GetBinaryValue(name)
	return err == nil && len(b) > 0 && b[0]&1 == 1
}

func clearApprovedMarker() error {
	a, err := registry.OpenKey(registry.CURRENT_USER, approvedKey, registry.SET_VALUE)
	if err != nil {
		if !errors.Is(err, registry.ErrNotExist) {
			return err
		}
		return nil
	}
	defer a.Close()
	if err := a.DeleteValue(name); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func enable(exe string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if err := k.SetStringValue(name, `"`+exe+`" `+Arg); err != nil {
		return err
	}
	return clearApprovedMarker()
}

func disable() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return err
	}
	defer k.Close()
	if err := k.DeleteValue(name); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func refresh() error { return nil }
func heldBack() bool { return false }
