package relay

import (
	"os"

	"byspace/internal/privatepath"
)

func securePrivateDirectory(path string) error {
	return privatepath.SecureDirectory(path)
}

func securePrivateFile(path string) error {
	return privatepath.SecureFile(path)
}

func validatePrivateDirectory(path string) (os.FileInfo, error) {
	return privatepath.ValidateDirectory(path)
}

func ValidatePrivateFile(path string) (os.FileInfo, error) {
	return privatepath.ValidateFile(path)
}
