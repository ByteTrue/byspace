package server

import "testing"

// LoadDaemonConfig unwraps the `daemon` object, so the relay block sits at the top level. Reading
// cfg["daemon"]["relay"] returns the zero value, which made a configured relay look disabled —
// the cause of "enabling the relay in settings does nothing".
func TestRelayConfigFromStoreReadsUnwrappedConfig(t *testing.T) {
	cfg := map[string]any{
		"relay": map[string]any{"enabled": true, "endpoint": "wss://relay.example", "useTls": true},
	}
	got := relayConfigFromStore(cfg)
	if !got.Enabled || got.Endpoint != "wss://relay.example" || !got.UseTLS {
		t.Fatalf("unwrapped config not read: %+v", got)
	}
}

// A raw on-disk shape (still nested) must also work, because some call sites pass the file
// contents rather than the merged config.
func TestRelayConfigFromStoreReadsNestedConfig(t *testing.T) {
	cfg := map[string]any{
		"daemon": map[string]any{"relay": map[string]any{"enabled": true, "endpoint": "wss://n"}},
	}
	got := relayConfigFromStore(cfg)
	if !got.Enabled || got.Endpoint != "wss://n" {
		t.Fatalf("nested config not read: %+v", got)
	}
}

func TestRelayConfigFromStoreAbsent(t *testing.T) {
	if got := relayConfigFromStore(map[string]any{}); got.Enabled || got.Endpoint != "" {
		t.Fatalf("expected zero value, got %+v", got)
	}
	if got := relayConfigFromStore(nil); got.Enabled {
		t.Fatalf("nil config must be disabled, got %+v", got)
	}
}

// `"relay": {"enabled": true}` with no endpoint means the hosted relay.
//
// The endpoint is optional in the config schema, so this is the shape every existing home has —
// including the one this was found on. Leaving Endpoint empty made the node and Go daemons behave
// differently for the same file: node falls back to DEFAULT_RELAY_ENDPOINT and connects, while the
// Go daemon stayed silent and remote access was dead with nothing in the log.
func TestRelayConfigFromStoreDefaultsTheHostedEndpoint(t *testing.T) {
	got := relayConfigFromStore(map[string]any{"relay": map[string]any{"enabled": true}})
	if got.Endpoint != hostedRelayEndpoint {
		t.Fatalf("endpoint = %q, want the hosted relay", got.Endpoint)
	}
	if !got.UseTLS {
		t.Fatal("the hosted relay is only reachable over TLS")
	}
	if got.ClientRelayEndpoint() != hostedRelayEndpoint || !got.ClientRelayUseTLS() {
		t.Fatalf("client pair = %q/%v, want the hosted relay over TLS",
			got.ClientRelayEndpoint(), got.ClientRelayUseTLS())
	}
}

// A configured endpoint still wins, and disabled stays disabled.
func TestRelayConfigFromStoreKeepsExplicitEndpoint(t *testing.T) {
	got := relayConfigFromStore(map[string]any{
		"relay": map[string]any{"enabled": true, "endpoint": "10.0.0.5:8787"},
	})
	if got.Endpoint != "10.0.0.5:8787" {
		t.Fatalf("endpoint = %q, want the configured one", got.Endpoint)
	}

	disabled := relayConfigFromStore(map[string]any{"relay": map[string]any{"enabled": false}})
	if disabled.Enabled || disabled.Endpoint != "" {
		t.Fatalf("disabled relay = %+v, want nothing dialled", disabled)
	}
}

// A public endpoint distinct from the internal one survives the default: the whole point is that
// the daemon reaches the relay privately while clients are told a public address.
func TestRelayConfigFromStoreKeepsPublicEndpointDistinct(t *testing.T) {
	got := relayConfigFromStore(map[string]any{
		"relay": map[string]any{
			"enabled":        true,
			"endpoint":       "10.0.0.5:8787",
			"publicEndpoint": "relay.byspace.cc.cd:443",
			"publicUseTls":   true,
		},
	})
	if got.ClientRelayEndpoint() != "relay.byspace.cc.cd:443" || !got.ClientRelayUseTLS() {
		t.Fatalf("client pair = %q/%v, want the public one", got.ClientRelayEndpoint(), got.ClientRelayUseTLS())
	}
	if got.Endpoint != "10.0.0.5:8787" {
		t.Fatalf("internal endpoint = %q, want the configured one", got.Endpoint)
	}
}
