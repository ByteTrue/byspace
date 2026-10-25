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
