// Package autostart manages launching BySpace automatically at user login in
// system-tray mode (ported from magpie's internal/autostart).
package autostart

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const Arg = "tray"

type State string

const (
	Off           State = "off"
	On            State = "on"
	NeedsAllowing State = "allow"
)

func Enabled() State {
	if !enabled() {
		return Off
	}
	if heldBack() {
		return NeedsAllowing
	}
	return On
}

func Set(on bool) error {
	if !on {
		return disable()
	}
	exe, err := self()
	if err != nil {
		return err
	}
	return enable(exe)
}

func Refresh() error { return refresh() }

func self() (string, error) {
	if p := os.Getenv("APPIMAGE"); p != "" {
		return p, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if p, evalErr := filepath.EvalSymlinks(exe); evalErr == nil {
		exe = p
	}
	if strings.Contains(exe, "/AppTranslocation/") {
		return "", errors.New("move BySpace.app to /Applications first, then enable Open at login")
	}
	return exe, nil
}
