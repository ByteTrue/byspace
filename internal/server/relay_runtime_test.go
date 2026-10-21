package server

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// Settings can enable, disable or retarget the relay; reporting "applied" without acting on it
// would be a lie, and reconnecting on every save would drop phones that are connected through it.
func TestRelayRuntimeAppliesChanges(t *testing.T) {
	var connects atomic.Int32
	connect := func(context.Context, string) error { connects.Add(1); return nil }
	rt := newRelayRuntime(RelayConfig{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Disabled: no connection.
	rt.Apply(ctx, RelayConfig{Enabled: false, Endpoint: "wss://r"}, connect)
	time.Sleep(50 * time.Millisecond)
	if connects.Load() != 0 {
		t.Fatalf("connected while disabled: %d", connects.Load())
	}

	// Enabled: connects.
	rt.Apply(ctx, RelayConfig{Enabled: true, Endpoint: "wss://r"}, connect)
	deadline := time.Now().Add(2 * time.Second)
	for connects.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if connects.Load() == 0 {
		t.Fatal("enabling the relay did not connect")
	}
	first := connects.Load()

	// Same config again: must not churn the connection.
	rt.Apply(ctx, RelayConfig{Enabled: true, Endpoint: "wss://r"}, connect)
	time.Sleep(80 * time.Millisecond)
	if connects.Load() != first {
		t.Fatalf("re-applying the same config reconnected: %d -> %d", first, connects.Load())
	}

	// Disabled again: stops.
	rt.Apply(ctx, RelayConfig{Enabled: false, Endpoint: "wss://r"}, connect)
	time.Sleep(120 * time.Millisecond)
	after := connects.Load()
	time.Sleep(400 * time.Millisecond)
	if connects.Load() != after {
		t.Fatalf("disabling did not stop reconnects: %d -> %d", after, connects.Load())
	}
}

// Endpoint changes reconnect; the point of the runtime is to follow the config.
func TestRelayRuntimeReconnectsOnEndpointChange(t *testing.T) {
	var connects atomic.Int32
	connect := func(context.Context, string) error { connects.Add(1); return nil }
	rt := newRelayRuntime(RelayConfig{Enabled: true, Endpoint: "wss://a"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rt.Apply(ctx, RelayConfig{Enabled: true, Endpoint: "wss://a"}, connect)
	time.Sleep(60 * time.Millisecond)
	rt.Apply(ctx, RelayConfig{Enabled: true, Endpoint: "wss://b"}, connect)
	deadline := time.Now().Add(2 * time.Second)
	before := connects.Load()
	for connects.Load() <= before && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if connects.Load() <= before {
		t.Fatal("endpoint change did not reconnect")
	}
}
