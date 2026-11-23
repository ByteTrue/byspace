//go:build !linux && !windows && !darwin

package filewatch

import "errors"

// ErrUnsupported is returned by Open on a platform whose backend has not been written yet.
var ErrUnsupported = errors.New("filewatch: no observation backend for this platform")

// Open returns the platform observation backend.
func Open() (Observation, error) {
	return nil, ErrUnsupported
}
