package proc

import "time"

var processTreeShutdownPhase = 2 * time.Second

var signalProcessTree = signalOwnedProcessTree
var processTreeAlive = processTreeAlivePlatform

// ShutdownProcessTree gives the whole tree a bounded graceful phase, then force-kills whatever
// remains. The caller retains ownership of exec.Cmd.Wait; done reports process/PTY completion.
func ShutdownProcessTree(pid int, done <-chan struct{}, identity string) {
	if pid <= 0 {
		return
	}
	rootComplete := channelClosed(done)
	if !processTreeAlive(pid, rootComplete, identity) {
		return
	}
	signalProcessTree(pid, false, identity)
	if waitForProcessTreeExit(pid, done, rootComplete, identity, processTreeShutdownPhase) {
		return
	}
	signalProcessTree(pid, true, identity)
	_ = waitForProcessTreeExit(pid, done, rootComplete, identity, processTreeShutdownPhase)
}

func channelClosed(done <-chan struct{}) bool {
	if done == nil {
		return false
	}
	select {
	case <-done:
		return true
	default:
		return false
	}
}

func waitForProcessTreeExit(pid int, done <-chan struct{}, rootComplete bool, identity string, timeout time.Duration) bool {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		if !processTreeAlive(pid, rootComplete, identity) {
			return true
		}
		select {
		case <-done:
			rootComplete = true
			done = nil
		case <-ticker.C:
		case <-timer.C:
			return false
		}
	}
}
