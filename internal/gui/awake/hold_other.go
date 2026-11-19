//go:build !darwin && !linux && !windows

package awake

import "errors"

func takeHold(bool) (func(), error) {
	return nil, errors.New("sleep inhibition not supported on this platform")
}
