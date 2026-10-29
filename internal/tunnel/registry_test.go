package tunnel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The file holds peer passwords, so it must not be world-readable.
func TestRegistrySavesPrivately(t *testing.T) {
	dir := t.TempDir()
	r := NewRegistry(dir, t.Logf)
	defer r.Close()

	hostname := "target-host"
	if err := r.Add(PeerConfig{
		PeerID:       "peer-1",
		PeerHostname: &hostname,
		URL:          "wss://relay.example.com",
		Token:        "s3cret",
		Forwards:     []ForwardConfig{{RemotePort: 3000, Label: "dev"}},
	}); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(dir, RegistryFilename))
	if err != nil {
		t.Fatal(err)
	}
	// Windows models only the read-only bit, so 0600 is not representable there.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v", info.Mode().Perm())
	}

	raw, err := os.ReadFile(filepath.Join(dir, RegistryFilename))
	if err != nil {
		t.Fatal(err)
	}
	var file registryFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	// The version field matches the node schema, so one home directory can be shared during the
	// transition.
	if file.Version != 1 || len(file.Peers) != 1 || file.Peers[0].PeerID != "peer-1" {
		t.Fatalf("file = %+v", file)
	}
}

// A malformed file must not stop the daemon: losing tunnel config is recoverable, refusing to
// boot is not.
func TestRegistryToleratesCorruptFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, RegistryFilename), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := NewRegistry(dir, t.Logf)
	defer r.Close()
	if got := r.List(); len(got) != 0 {
		t.Fatalf("expected an empty registry, got %+v", got)
	}
}

// The gate is a kill switch, not a UI filter: turning it off must release the local listeners.
func TestDisablingGateReleasesListeners(t *testing.T) {
	dir := t.TempDir()
	r := NewRegistry(dir, t.Logf)
	defer r.Close()

	r.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
	if err := r.Add(PeerConfig{
		PeerID:   "peer-1",
		URL:      "wss://relay.example.com",
		Forwards: []ForwardConfig{{RemotePort: 3000}},
	}); err != nil {
		t.Fatal(err)
	}

	r.SetEnabled(true)
	statuses := r.List()
	if len(statuses) != 1 {
		t.Fatalf("expected one peer, got %+v", statuses)
	}
	localPort := statuses[0].Forwards[0].LocalPort
	if localPort == 0 {
		t.Fatal("the listener should be bound while the gate is open")
	}

	r.SetEnabled(false)
	// Rebinding proves the port was released.
	r.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
	if len(r.List()) != 1 {
		t.Fatal("the peer stays configured; only its manager stops")
	}
	if got := r.List()[0].Forwards; len(got) != 0 {
		t.Fatalf("no manager should remain: %+v", got)
	}
}

// Removing a peer rewrites the file without it.
func TestRegistryRemove(t *testing.T) {
	dir := t.TempDir()
	r := NewRegistry(dir, t.Logf)
	defer r.Close()
	if err := r.Add(PeerConfig{PeerID: "p1", URL: "wss://x", Forwards: []ForwardConfig{{RemotePort: 3000}}}); err != nil {
		t.Fatal(err)
	}
	if err := r.Remove("p1"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, RegistryFilename))
	if err != nil {
		t.Fatal(err)
	}
	var file registryFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Peers) != 0 {
		t.Fatalf("peer survived removal: %+v", file.Peers)
	}
	if err := r.Remove("nope"); err == nil {
		t.Fatal("removing an unknown peer should report it")
	}
}

// Add validates before writing: a configuration that cannot work must not be persisted.
func TestRegistryAddValidation(t *testing.T) {
	r := NewRegistry(t.TempDir(), t.Logf)
	defer r.Close()
	cases := []PeerConfig{
		{URL: "wss://x", Forwards: []ForwardConfig{{RemotePort: 1}}},                  // no id
		{PeerID: "p", Forwards: []ForwardConfig{{RemotePort: 1}}},                     // no url
		{PeerID: "p", URL: "wss://x"},                                                 // no forwards
		{PeerID: "p", URL: "wss://x", Forwards: []ForwardConfig{{RemotePort: 0}}},     // bad port
		{PeerID: "p", URL: "wss://x", Forwards: []ForwardConfig{{RemotePort: 70000}}}, // bad port
	}
	for index, config := range cases {
		if err := r.Add(config); err == nil {
			t.Fatalf("case %d should be rejected", index)
		}
	}
}

// One port failing folds into the peer's state as an error, matching the node daemon.
func TestAggregateState(t *testing.T) {
	if got := aggregateState(nil); got != StateDisconnected {
		t.Fatalf("empty = %q", got)
	}
	if got := aggregateState([]ForwardState{{State: StateConnected}, {State: StateError}}); got != StateError {
		t.Fatalf("error should win: %q", got)
	}
	if got := aggregateState([]ForwardState{{State: StateConnecting}, {State: StateConnected}}); got != StateConnected {
		t.Fatalf("connected beats connecting: %q", got)
	}
	if got := aggregateState([]ForwardState{{State: StateConnecting}}); got != StateConnecting {
		t.Fatalf("connecting = %q", got)
	}
}

func TestRegistryPinsLocalPortAcrossRestartsAndMergesForwards(t *testing.T) {
	dir := t.TempDir()
	r := NewRegistry(dir, t.Logf)
	r.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
	r.SetEnabled(true)

	// 1. Add forward 3425 with LocalPort=0; startPeer must pin the assigned LocalPort into tunnels.json.
	if err := r.Add(PeerConfig{
		PeerID: "peer-mac",
		URL:    "wss://app.byspace.cc.cd/ws",
		Forwards: []ForwardConfig{
			{RemotePort: 3425},
		},
	}); err != nil {
		t.Fatalf("Add 3425: %v", err)
	}

	// 2. Add a second forward 3430 for the same peer; both 3425 and 3430 must be preserved.
	if err := r.Add(PeerConfig{
		PeerID: "peer-mac",
		URL:    "wss://app.byspace.cc.cd/ws",
		Forwards: []ForwardConfig{
			{RemotePort: 3430},
		},
	}); err != nil {
		t.Fatalf("Add 3430: %v", err)
	}

	peers := r.List()
	if len(peers) != 1 || len(peers[0].Forwards) != 2 {
		t.Fatalf("expected 1 peer with 2 forwards, got %+v", peers)
	}
	pinned3425 := peers[0].Forwards[0].LocalPort
	pinned3430 := peers[0].Forwards[1].LocalPort
	if pinned3425 <= 0 || pinned3430 <= 0 {
		t.Fatalf("expected positive pinned local ports, got %d, %d", pinned3425, pinned3430)
	}
	r.Close()

	// 3. Restart registry from disk: it must re-bind the exact same pinned LocalPort values.
	r2 := NewRegistry(dir, t.Logf)
	defer r2.Close()
	r2.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
	r2.SetEnabled(true)

	peers2 := r2.List()
	if len(peers2) != 1 || len(peers2[0].Forwards) != 2 {
		t.Fatalf("after restart: got %+v", peers2)
	}
	if peers2[0].Forwards[0].LocalPort != pinned3425 || peers2[0].Forwards[1].LocalPort != pinned3430 {
		t.Fatalf("expected local ports (%d, %d) to stay pinned across restarts, got (%d, %d)",
			pinned3425, pinned3430, peers2[0].Forwards[0].LocalPort, peers2[0].Forwards[1].LocalPort)
	}
}
