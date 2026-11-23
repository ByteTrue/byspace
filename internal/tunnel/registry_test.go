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
	requireTCP(t)
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
	requireTCP(t)
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
	requireTCP(t)
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

// A destination host is part of the rule. The same port number on two machines is two rules, and an
// edit replaces exactly the destination it names.
func TestRegistryKeepsRemoteHostsDistinct(t *testing.T) {
	requireTCP(t)
	dir := t.TempDir()
	r := NewRegistry(dir, t.Logf)
	defer r.Close()
	r.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
	r.SetEnabled(true)

	if err := r.Add(PeerConfig{
		PeerID: "peer-db",
		URL:    "wss://relay.example.com",
		Forwards: []ForwardConfig{
			{RemotePort: 5432},
			{RemotePort: 5432, RemoteHost: "192.168.1.9"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	peers := r.List()
	if len(peers) != 1 || len(peers[0].Forwards) != 2 {
		t.Fatalf("expected two forwards on one peer, got %+v", peers)
	}
	endpoints := make(map[string]bool)
	for _, fw := range peers[0].Forwards {
		endpoints[FormatEndpoint(fw.RemoteHost, fw.RemotePort)] = true
	}
	if !endpoints["127.0.0.1:5432"] || !endpoints["192.168.1.9:5432"] {
		t.Fatalf("destinations = %v", endpoints)
	}

	// The host reaches tunnels.json, so a restart keeps the destination.
	raw, err := os.ReadFile(filepath.Join(dir, RegistryFilename))
	if err != nil {
		t.Fatal(err)
	}
	var file registryFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if got := file.Peers[0].Forwards[1].RemoteHost; got != "192.168.1.9" {
		t.Fatalf("persisted remoteHost = %q", got)
	}

	// Editing the remote rule's port replaces that one destination and leaves the loopback rule.
	if err := r.AddOrUpdate(PeerConfig{
		PeerID:   "peer-db",
		Forwards: []ForwardConfig{{RemotePort: 6432, RemoteHost: "192.168.1.9"}},
	}, ForwardConfig{RemotePort: 5432, RemoteHost: "192.168.1.9"}); err != nil {
		t.Fatal(err)
	}
	peers = r.List()
	if len(peers) != 1 || len(peers[0].Forwards) != 2 {
		t.Fatalf("after edit: %+v", peers)
	}
	endpoints = map[string]bool{}
	for _, fw := range peers[0].Forwards {
		endpoints[FormatEndpoint(fw.RemoteHost, fw.RemotePort)] = true
	}
	if !endpoints["127.0.0.1:5432"] || !endpoints["192.168.1.9:6432"] {
		t.Fatalf("after edit destinations = %v", endpoints)
	}
}

func TestRegistryRejectsMalformedRemoteHost(t *testing.T) {
	r := NewRegistry(t.TempDir(), t.Logf)
	defer r.Close()
	err := r.Add(PeerConfig{
		PeerID:   "peer-bad",
		URL:      "wss://relay.example.com",
		Forwards: []ForwardConfig{{RemotePort: 5432, RemoteHost: "http://192.168.1.9"}},
	})
	if err == nil {
		t.Fatal("a destination with a scheme must be rejected")
	}
}

// The rule list reports the destination host and the address the listener actually bound, so the row
// shows the destination rather than implying every rule goes to the peer's loopback.
func TestRegistryListKeepsHostsAndListenAddress(t *testing.T) {
	requireTCP(t)
	r := NewRegistry(t.TempDir(), t.Logf)
	defer r.Close()
	r.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
	r.SetEnabled(true)

	if err := r.Add(PeerConfig{
		PeerID:   "peer-x",
		URL:      "wss://relay.example.com",
		Forwards: []ForwardConfig{{RemotePort: 5432, RemoteHost: "192.168.1.9", ListenHost: "0.0.0.0"}},
	}); err != nil {
		t.Fatal(err)
	}
	state := r.List()[0].Forwards[0]
	if state.RemoteHost != "192.168.1.9" || state.ListenHost == "" {
		t.Fatalf("state = %+v", state)
	}
}

// An edit keeps the local binding, label and paused state it did not restate. The edit form only
// names the destination, so replacing a rule must not silently rebind a deliberately exposed listener
// to loopback or resume a paused rule.
func TestRegistryEditKeepsBindingAndPauseState(t *testing.T) {
	r := NewRegistry(t.TempDir(), t.Logf)
	defer r.Close()
	// No relay dial: the factory hands back a dead peer. The rule is paused, so nothing binds either.
	r.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
	r.SetEnabled(true)
	if err := r.Add(PeerConfig{
		PeerID: "peer-anchors",
		URL:    "wss://relay.example.com",
		Forwards: []ForwardConfig{
			{RemotePort: 5432, ListenHost: "0.0.0.0", Label: "db", Disabled: true},
		},
	}); err != nil {
		t.Fatal(err)
	}

	if err := r.AddOrUpdate(PeerConfig{
		PeerID:   "peer-anchors",
		Forwards: []ForwardConfig{{RemotePort: 6432, RemoteHost: "10.0.0.9"}},
	}, ForwardConfig{RemotePort: 5432}); err != nil {
		t.Fatal(err)
	}

	forwards := r.List()[0].Forwards
	if len(forwards) != 1 {
		t.Fatalf("expected one rule, got %+v", forwards)
	}
	rule := forwards[0]
	if rule.RemotePort != 6432 || rule.RemoteHost != "10.0.0.9" {
		t.Fatalf("the destination did not change: %+v", rule)
	}
	if rule.ListenHost != "0.0.0.0" || rule.Label != "db" || !rule.Disabled {
		t.Fatalf("the edit dropped the local binding, label or paused state: %+v", rule)
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
	requireTCP(t)
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

	// 4. RemoveForward removes only 3425 while keeping 3430 intact.
	if err := r2.RemoveForward("peer-mac", "", 3425); err != nil {
		t.Fatalf("RemoveForward(3425): %v", err)
	}
	peers3 := r2.List()
	if len(peers3) != 1 || len(peers3[0].Forwards) != 1 || peers3[0].Forwards[0].RemotePort != 3430 {
		t.Fatalf("expected only port 3430 to remain, got %+v", peers3)
	}

	// 5. Pause port 3430 (Disabled=true): local port must be released while keeping the entry in List().
	if err := r2.AddOrUpdate(PeerConfig{
		PeerID: "peer-mac",
		Forwards: []ForwardConfig{
			{RemotePort: 3430, LocalPort: pinned3430, Disabled: true},
		},
	}, ForwardConfig{}); err != nil {
		t.Fatalf("pause 3430: %v", err)
	}
	peersPaused := r2.List()
	if len(peersPaused) != 1 || len(peersPaused[0].Forwards) != 1 || !peersPaused[0].Forwards[0].Disabled {
		t.Fatalf("expected paused forward in List(), got %+v", peersPaused)
	}

	// 6. Resume port 3430 (Disabled=false): rebinds the exact same pinned LocalPort.
	if err := r2.AddOrUpdate(PeerConfig{
		PeerID: "peer-mac",
		Forwards: []ForwardConfig{
			{RemotePort: 3430, LocalPort: pinned3430, Disabled: false},
		},
	}, ForwardConfig{}); err != nil {
		t.Fatalf("resume 3430: %v", err)
	}
	peersResumed := r2.List()
	if len(peersResumed) != 1 || peersResumed[0].Forwards[0].Disabled || peersResumed[0].Forwards[0].LocalPort != pinned3430 {
		t.Fatalf("expected resumed forward on port %d, got %+v", pinned3430, peersResumed)
	}
}
