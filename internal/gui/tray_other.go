//go:build (!darwin || !cgo) && !windows

package gui

import "sync"

var (
	otherTrayMu       sync.Mutex
	otherTrayStopChan chan struct{}
)

func runPlatformTray(_ trayViewState, _ trayCallbacks) error {
	otherTrayMu.Lock()
	otherTrayStopChan = make(chan struct{})
	stopCh := otherTrayStopChan
	otherTrayMu.Unlock()

	<-stopCh
	return nil
}

func updatePlatformTray(_ trayViewState) {}

func stopPlatformTray() {
	otherTrayMu.Lock()
	ch := otherTrayStopChan
	otherTrayStopChan = nil
	otherTrayMu.Unlock()
	if ch != nil {
		close(ch)
	}
}
