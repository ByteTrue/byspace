//go:build !windows

package privatepath

import (
	"errors"
	"os"
)

func SecureDirectory(path string) error {
	return os.Chmod(path, 0o700)
}

func SecureFile(path string) error {
	return os.Chmod(path, 0o600)
}

func ValidateDirectory(path string) (os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("directory must be private with 0700 permissions")
	}
	return info, nil
}

func ValidateFile(path string) (os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("file must be a private regular file with 0600 permissions")
	}
	return info, nil
}
