package tunnel

import (
	"testing"
	"time"
)

// Equal jitter must spread a delay over [d/2, d], not return the delay unchanged. A fleet of
// daemons that lost the same relay would otherwise reconnect on the same tick and hammer it.
// The reset-after-a-proven-connection policy is covered by TestRunResetsBackoffAfterAProvenConnection
// in relaypeer_test.go; this file owns the jitter the backoff applies on top of that policy.
func TestReconnectJitterSpreadsDelay(t *testing.T) {
	const d = 1000 * time.Millisecond
	seen := make(map[time.Duration]bool)
	for i := 0; i < 200; i++ {
		got := reconnectJitter(d)
		if got < d/2 || got > d {
			t.Fatalf("reconnectJitter(%v) = %v, want within [%v, %v]", d, got, d/2, d)
		}
		seen[got] = true
	}
	if len(seen) < 2 {
		t.Fatal("reconnectJitter returned a single value across 200 calls; no spread")
	}
}
