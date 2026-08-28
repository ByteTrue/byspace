//go:build windows

package relay

import "os"

func installIdentityFile(temporaryPath, destinationPath string) error {
	return os.Rename(temporaryPath, destinationPath)
}
