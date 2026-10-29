package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestRelayConfigInfersTLSFromTheEndpoint(t *testing.T) {
	for _, tc := range []struct {
		name     string
		relay    map[string]any
		wantTLS  bool
		wantPort string
	}{
		{
			name:    "hosted host with no useTls is TLS",
			relay:   map[string]any{"enabled": true, "endpoint": "app-beta.byspace.cc.cd"},
			wantTLS: true,
		},
		{
			name:    "explicit 443 is TLS",
			relay:   map[string]any{"enabled": true, "endpoint": "relay.byspace.cc.cd:443"},
			wantTLS: true,
		},
		{
			name:    "explicit non-443 port is plaintext",
			relay:   map[string]any{"enabled": true, "endpoint": "127.0.0.1:6767"},
			wantTLS: false,
		},
		{
			name:    "an explicit useTls wins over the port",
			relay:   map[string]any{"enabled": true, "endpoint": "127.0.0.1:6767", "useTls": true},
			wantTLS: true,
		},
		{
			name:    "a wss url is TLS",
			relay:   map[string]any{"enabled": true, "endpoint": "wss://relay.example.com/ws"},
			wantTLS: true,
		},
		{
			name:    "a ws url is plaintext",
			relay:   map[string]any{"enabled": true, "endpoint": "ws://relay.example.com/ws", "useTls": true},
			wantTLS: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := relayConfigFromStore(map[string]any{"relay": tc.relay})
			// An explicit useTls in the map must survive; only an absent one is inferred.
			if _, set := tc.relay["useTls"]; set {
				if cfg.UseTLS != tc.wantTLS {
					t.Fatalf("UseTLS = %v, want %v", cfg.UseTLS, tc.wantTLS)
				}
				return
			}
			if cfg.UseTLS != tc.wantTLS {
				t.Fatalf("UseTLS for %q = %v, want %v", tc.relay["endpoint"], cfg.UseTLS, tc.wantTLS)
			}
			if cfg.PublicUseTLS != cfg.UseTLS {
				t.Fatalf("PublicUseTLS = %v, want it to follow UseTLS %v", cfg.PublicUseTLS, cfg.UseTLS)
			}
		})
	}
}

// `daemon status` must report the endpoint the daemon is connected to, not the one in config.json.
//
// The CLI probed /health and read the config file for this, so a daemon started with `--relay`
// printed the configured address while dialling somewhere else — a command that exists to report
// runtime state was reporting intent. /health carries the live answer now.
func TestHealthReportsTheLiveRelayEndpoint(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test", DisableWebUI: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })

	// A dial records what it reached, separately from what was configured.
	srv.relay.mu.Lock()
	srv.relay.config = RelayConfig{Enabled: true, Endpoint: "configured.example:443", UseTLS: true}
	srv.relay.mu.Unlock()
	srv.relay.markConnected("reached.example:443")

	recorder := httptest.NewRecorder()
	srv.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /health = %d", recorder.Code)
	}
	var body struct {
		Relay struct {
			Enabled   bool   `json:"enabled"`
			Endpoint  string `json:"endpoint"`
			Connected string `json:"connected"`
		} `json:"relay"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Relay.Endpoint != "configured.example:443" {
		t.Fatalf("endpoint = %q, want the configured one", body.Relay.Endpoint)
	}
	if body.Relay.Connected != "reached.example:443" {
		t.Fatalf("connected = %q, want the endpoint the dial reached", body.Relay.Connected)
	}
}

// A daemon that never reached its relay must say so rather than implying it is up.
func TestHealthOmitsConnectedWhenTheDialNeverSucceeded(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test", DisableWebUI: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })

	srv.relay.mu.Lock()
	srv.relay.config = RelayConfig{Enabled: true, Endpoint: "unreachable.example:443", UseTLS: true}
	srv.relay.mu.Unlock()

	recorder := httptest.NewRecorder()
	srv.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	relay, _ := body["relay"].(map[string]any)
	if _, present := relay["connected"]; present {
		t.Fatalf("relay.connected present for a daemon that never dialled: %#v", relay)
	}
}
