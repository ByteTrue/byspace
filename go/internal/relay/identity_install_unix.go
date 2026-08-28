//go:build unix

package relay

import "os"

func installIdentityFile(temporaryPath, destinationPath string) error {
	return os.Link(temporaryPath, destinationPath)
}
