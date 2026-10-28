package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The gate must come from config.
//
// `tunnelsEnabled` was declared and never assigned, so it was permanently false: every inbound
// tunnel open was refused and the outbound registry was told the gate was shut. Enabling tunnels in
// settings wrote the key, reported it as reloadable, and changed nothing.
func TestTunnelGateComesFromConfig(t *testing.T) {
	cases := []struct {
		name   string
		config map[string]any
		want   bool
	}{
		{"absent means off", map[string]any{}, false},
		{"tunnel section without enabled", map[string]any{"tunnel": map[string]any{}}, false},
		{"enabled false", map[string]any{"tunnel": map[string]any{"enabled": false}}, false},
		{"enabled true", map[string]any{"tunnel": map[string]any{"enabled": true}}, true},
		// A malformed value is off rather than a crash: the daemon must start.
		{"enabled is not a bool", map[string]any{"tunnel": map[string]any{"enabled": "yes"}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tunnelEnabledFromConfig(tc.config); got != tc.want {
				t.Fatalf("tunnelEnabledFromConfig = %v, want %v", got, tc.want)
			}
		})
	}
}

// ApplyTunnelConfig must put the config value into the live gate, both ways.
func TestApplyTunnelConfigOpensAndClosesTheGate(t *testing.T) {
	homeDir := t.TempDir()
	srv := newTestServer(t, homeDir)

	writeTunnelConfig(t, srv, true)
	srv.ApplyTunnelConfig()
	if !srv.tunnelRegistry().IsEnabled() {
		t.Fatal("the gate is still closed after enabling it in config")
	}

	writeTunnelConfig(t, srv, false)
	srv.ApplyTunnelConfig()
	if srv.tunnelRegistry().IsEnabled() {
		t.Fatal("the gate is still open after disabling it in config")
	}
}

// writeTunnelConfig saves the daemon config with the tunnel gate set.
func writeTunnelConfig(t *testing.T, srv *Server, enabled bool) {
	t.Helper()
	config := srv.store.LoadDaemonConfig()
	tunnel, _ := config["tunnel"].(map[string]any)
	if tunnel == nil {
		tunnel = map[string]any{}
	}
	tunnel["enabled"] = enabled
	srv.store.SaveDaemonConfig(map[string]any{"tunnel": tunnel})
}

// A daemon that boots with the gate open must actually dial its peers.
//
// This is the second half of the same bug: even with the gate right, nothing called Start, so the
// listeners came up and no peer was ever contacted. The observable difference is that the port
// rows leave "connecting" for a manager that exists.
func TestApplyTunnelConfigStartsTheConfiguredPeers(t *testing.T) {
	homeDir := t.TempDir()
	// One peer that cannot be dialled: the point is that the registry tried, which only happens
	// once the manager exists.
	peers := []byte(`{"v":1,"peers":[{"peerId":"srv_peer","url":"wss://relay.example.test","forwards":[{"remotePort":5432}]}]}`)
	if err := writeFile0600(homeDir, "tunnels.json", peers); err != nil {
		t.Fatal(err)
	}

	srv := newTestServer(t, homeDir)
	writeTunnelConfig(t, srv, true)
	srv.ApplyTunnelConfig()

	registry := srv.tunnelRegistry()
	if !registry.IsEnabled() {
		t.Fatal("the gate did not open")
	}

	// The manager is created by startPeer even when the dial later fails, so its presence proves
	// Start ran rather than the gate merely being open.
	if got := len(registry.List()); got != 1 {
		t.Fatalf("registry lists %d peers, want the configured one", got)
	}
	statuses := registry.List()
	payload, _ := json.Marshal(statuses)
	if len(payload) == 0 {
		t.Fatal("empty peer status")
	}
}

// writeFile0600 writes a fixture file the way the daemon would.
func writeFile0600(dir, name string, body []byte) error {
	return os.WriteFile(filepath.Join(dir, name), body, 0o600)
}
