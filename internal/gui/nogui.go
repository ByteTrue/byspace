//go:build nogui

package gui

import "errors"

func Run(_ string, _ bool, _ string) error {
	return errors.New("built without desktop UI (-tags nogui)")
}
