package proc

import (
	"errors"
	"testing"
	"time"
)

func useFastProcessTreeShutdownPhase(t *testing.T) {
	t.Helper()
	oldPhase := processTreeShutdownPhase
	processTreeShutdownPhase = 100 * time.Millisecond
	t.Cleanup(func() { processTreeShutdownPhase = oldPhase })
}

func TestProcessIdentityFailsClosed(t *testing.T) {
	oldQuery := queryProcessIdentity
	t.Cleanup(func() { queryProcessIdentity = oldQuery })
	if processIdentityMatches(123, "") {
		t.Fatal("missing original identity was trusted")
	}
	queryProcessIdentity = func(int) (string, bool, error) {
		return "", true, errors.New("query failed")
	}
	if processIdentityMatches(123, "original") {
		t.Fatal("identity query failure was trusted")
	}
	queryProcessIdentity = func(int) (string, bool, error) { return "replacement", true, nil }
	if processIdentityMatches(123, "original") {
		t.Fatal("replacement identity was trusted")
	}
	queryProcessIdentity = func(int) (string, bool, error) { return "", false, nil }
	if !processIdentityMatches(123, "original") {
		t.Fatal("authoritative absent root blocked original-descendant handling")
	}
}

func TestShutdownProcessTreeCompletedRootSendsNoSignal(t *testing.T) {
	oldAlive, oldSignal := processTreeAlive, signalProcessTree
	t.Cleanup(func() { processTreeAlive, signalProcessTree = oldAlive, oldSignal })
	var rootComplete bool
	processTreeAlive = func(_ int, complete bool, _ string) bool { rootComplete = complete; return false }
	var signals []bool
	signalProcessTree = func(_ int, force bool, _ string) { signals = append(signals, force) }
	done := make(chan struct{})
	close(done)
	ShutdownProcessTree(123, done, "")
	if len(signals) != 0 {
		t.Fatalf("completed process tree received signals: %v", signals)
	}
	if !rootComplete {
		t.Fatal("liveness check was not told that the original root completed")
	}
}

func TestShutdownProcessTreeRootCompletionDoesNotSkipLiveTreeForce(t *testing.T) {
	useFastProcessTreeShutdownPhase(t)
	oldAlive, oldSignal := processTreeAlive, signalProcessTree
	t.Cleanup(func() { processTreeAlive, signalProcessTree = oldAlive, oldSignal })
	processTreeAlive = func(int, bool, string) bool { return true }
	var signals []bool
	signalProcessTree = func(_ int, force bool, _ string) { signals = append(signals, force) }
	done := make(chan struct{})
	close(done)
	ShutdownProcessTree(123, done, "original")
	if len(signals) != 2 || signals[0] || !signals[1] {
		t.Fatalf("signals = %v, want graceful then force", signals)
	}
}

func TestShutdownProcessTreeAllowsGracefulDescendantExitAfterRootCompletes(t *testing.T) {
	useFastProcessTreeShutdownPhase(t)
	oldAlive, oldSignal := processTreeAlive, signalProcessTree
	t.Cleanup(func() { processTreeAlive, signalProcessTree = oldAlive, oldSignal })
	checks := 0
	processTreeAlive = func(int, bool, string) bool { checks++; return checks < 3 }
	var signals []bool
	signalProcessTree = func(_ int, force bool, _ string) { signals = append(signals, force) }
	done := make(chan struct{})
	close(done)
	ShutdownProcessTree(123, done, "original")
	if len(signals) != 1 || signals[0] {
		t.Fatalf("signals = %v, want graceful only", signals)
	}
	if checks < 3 {
		t.Fatal("shutdown did not observe the descendant's graceful exit")
	}
}
