//go:build nogui

package cli

import (
	"errors"
	"io"
)

func runGUI(_ string, _ bool, _ string) error {
	return errors.New("built without desktop UI (-tags nogui); use `byspace web` or `byspace serve`")
}

func runDefaultNoArgs(version string, stdout io.Writer) error {
	return runServe(version, nil, stdout)
}
