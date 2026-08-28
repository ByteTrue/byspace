//go:build !unix && !windows

package relay

import "os"

func installIdentityFile(temporaryPath, destinationPath string) error {
	return os.Link(temporaryPath, destinationPath)
}
