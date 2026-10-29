//go:build windows

package awake

import (
	"runtime"
	"syscall"
)

const (
	esSystemRequired  = 0x00000001
	esDisplayRequired = 0x00000002
	esContinuous      = 0x80000000
)

var setThreadExecutionState = syscall.NewLazyDLL("kernel32.dll").NewProc("SetThreadExecutionState")

func takeHold(display bool) (func(), error) {
	if err := setThreadExecutionState.Find(); err != nil {
		return nil, err
	}
	done, set := make(chan struct{}), make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		if r, _, err := setThreadExecutionState.Call(executionState(display)); r == 0 {
			set <- err
			return
		}
		set <- nil
		<-done
		_, _, _ = setThreadExecutionState.Call(esContinuous)
	}()
	if err := <-set; err != nil {
		return nil, err
	}
	return func() { close(done) }, nil
}

func executionState(display bool) uintptr {
	st := uintptr(esContinuous | esSystemRequired)
	if display {
		st |= esDisplayRequired
	}
	return st
}
