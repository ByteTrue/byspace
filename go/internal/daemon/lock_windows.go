//go:build windows

package daemon

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

const (
	lockfileFailImmediately = 0x00000001
	lockfileExclusiveLock   = 0x00000002
)

var (
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	lockFileEx   = kernel32.NewProc("LockFileEx")
	unlockFileEx = kernel32.NewProc("UnlockFileEx")
)

func lockFile(file *os.File) (func() error, error) {
	overlapped := new(syscall.Overlapped)
	result, _, callErr := lockFileEx.Call(
		file.Fd(),
		lockfileExclusiveLock|lockfileFailImmediately,
		0,
		1,
		0,
		uintptr(unsafe.Pointer(overlapped)),
	)
	if result == 0 {
		if errors.Is(callErr, syscall.Errno(33)) {
			return nil, ErrOwnershipHeld
		}
		return nil, callErr
	}
	return func() error {
		result, _, callErr := unlockFileEx.Call(
			file.Fd(),
			0,
			1,
			0,
			uintptr(unsafe.Pointer(overlapped)),
		)
		if result == 0 {
			return callErr
		}
		return nil
	}, nil
}
