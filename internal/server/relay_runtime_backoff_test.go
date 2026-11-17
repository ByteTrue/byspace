package server

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// Equal jitter must spread a delay over [d/2, d], not return it unchanged. Daemons that lost the
// same relay would otherwise reconnect on the same tick and hammer it as one fleet.
func TestRelayBackoffJitterSpreadsDelay(t *testing.T) {
	const d = 1000 * time.Millisecond
	seen := make(map[time.Duration]bool)
	for i := 0; i < 200; i++ {
		got := relayJitter(d)
		if got < d/2 || got > d {
			t.Fatalf("relayJitter(%v) = %v, want within [%v, %v]", d, got, d/2, d)
		}
		seen[got] = true
	}
	if len(seen) < 2 {
		t.Fatal("relayJitter returned a single value across 200 calls; no spread")
	}
}

// A connection that lived past the stability threshold resets the backoff; a short one does not.
//
// ConnectRelay blocks for the whole connection life and returns only when it dies, so the old loop
// counted lifetime reconnects as consecutive failures and never reset: a long-running daemon waited
// the full 30s cap after any blip. This drives the real supervise loop with a connect that blocks for
// a programmed lifetime, and the sleep seam capturing the delay the policy chose. The seams are
// instance fields, so this cannot race the supervise goroutines other tests leave running.
func TestRelaySuperviseBackoffResetsAfterStableConnection(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rt := newRelayRuntime(RelayConfig{Enabled: true, Endpoint: "wss://r"})
	// Wide margins: time.After is a lower bound, so a scheduling stall on a loaded runner must not
	// turn a "short" connection into a "stable" one and silently reset the sequence under test.
	rt.stableAfter = 500 * time.Millisecond
	rt.jitter = func(d time.Duration) time.Duration { return d } // observe the raw policy delay
	var mu sync.Mutex
	var delays []time.Duration
	rt.sleep = func(ctx context.Context, d time.Duration) bool {
		mu.Lock()
		delays = append(delays, d)
		n := len(delays)
		mu.Unlock()
		if n >= 4 {
			cancel() // stop the loop deterministically once the sequence is captured
		}
		return ctx.Err() == nil
	}

	// Short, short, stable, short. The stable connection (>= 500ms) must reset the delay to base.
	lifetimes := make(chan time.Duration, 4)
	lifetimes <- 10 * time.Millisecond
	lifetimes <- 10 * time.Millisecond
	lifetimes <- 800 * time.Millisecond
	lifetimes <- 10 * time.Millisecond
	close(lifetimes)
	connect := func(ctx context.Context, _ string) error {
		life, ok := <-lifetimes
		if !ok {
			life = 0
		}
		select {
		case <-time.After(life):
		case <-ctx.Done():
		}
		return errors.New("connection died")
	}

	done := make(chan struct{})
	go func() { rt.supervise(ctx, rt.config, connect); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("supervise did not stop after the fourth delay")
	}

	mu.Lock()
	got := append([]time.Duration(nil), delays...)
	mu.Unlock()
	if len(got) < 4 {
		t.Fatalf("recorded %d delays, want at least 4: %v", len(got), got)
	}
	// Linear base 1s. Unstable drops grow: 1s, 2s. The stable drop resets to 1s, then 2s again.
	want := []time.Duration{time.Second, 2 * time.Second, time.Second, 2 * time.Second}
	for i, w := range want {
		if got[i] != w {
			t.Fatalf("delay[%d] = %v, want %v (full sequence %v); backoff did not reset after the stable connection", i, got[i], w, got[:4])
		}
	}
}
