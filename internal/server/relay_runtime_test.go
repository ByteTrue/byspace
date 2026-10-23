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

// The stored endpoint is host:port, so it needs a scheme before it can be dialled. Getting this
// wrong meant the daemon silently never connected: url.Parse treated the host as a scheme and the
// dial failed, and the supervisor discarded the error.
func TestRelayWebSocketURLFromStoredEndpoint(t *testing.T) {
	cases := []struct {
		endpoint string
		useTLS   bool
		want     string
	}{
		{"relay.byspace.cc.cd:443", true, "wss://relay.byspace.cc.cd:443/ws"},
		{"127.0.0.1:6778", false, "ws://127.0.0.1:6778/ws"},
		{"wss://relay.example.com/ws", true, "wss://relay.example.com/ws"},
		{"ws://127.0.0.1:5000/ws", false, "ws://127.0.0.1:5000/ws"},
		{"relay.example.com", true, "wss://relay.example.com/ws"},
	}
	for _, tc := range cases {
		if got := relayWebSocketURL(tc.endpoint, tc.useTLS); got != tc.want {
			t.Errorf("relayWebSocketURL(%q, %v) = %q, want %q", tc.endpoint, tc.useTLS, got, tc.want)
		}
	}
}

// A public endpoint exists for daemons the relay reaches on a private address; the pairing offer
// has to carry the address a phone can dial, not the one the daemon dials.
func TestRelayConfigClientEndpointPrefersPublic(t *testing.T) {
	private := RelayConfig{Enabled: true, Endpoint: "127.0.0.1:6778"}
	if got := private.ClientRelayEndpoint(); got != "127.0.0.1:6778" {
		t.Errorf("without a public endpoint got %q", got)
	}
	both := RelayConfig{
		Enabled:        true,
		Endpoint:       "10.0.0.5:6778",
		UseTLS:         false,
		PublicEndpoint: "relay.byspace.cc.cd:443",
		PublicUseTLS:   true,
	}
	if got := both.ClientRelayEndpoint(); got != "relay.byspace.cc.cd:443" {
		t.Errorf("public endpoint not preferred: %q", got)
	}
	if !both.ClientRelayUseTLS() {
		t.Error("public TLS flag not preferred")
	}
}
