package server

import "testing"

// A home that has toggled LAN access stores only `daemon.listen`; the block is a view of it.
// Without the derived fields the client's schema rejected the whole config frame, so every
// Settings save failed with "Response validation failed for set_daemon_config_response".
func TestNetworkViewReportsTheListenTarget(t *testing.T) {
	cases := []struct {
		listen      string
		wantLAN     bool
		wantTCPPort any
	}{
		{"0.0.0.0:6777", true, 6777},
		{"127.0.0.1:6777", false, 6777},
		{"192.168.1.5:6777", true, 6777},
		{"localhost:6777", false, 6777},
		{"/tmp/byspace.sock", false, nil},
		{`\\.\pipe\byspace`, false, nil},
		{"", false, nil},
	}
	for _, tc := range cases {
		cfg := withDaemonNetworkView(map[string]any{
			// A stale value written by an older build must not win over the listen target.
			"network": map[string]any{"allowLanAccess": !tc.wantLAN},
		}, tc.listen)
		network := cfg["network"].(map[string]any)
		if network["tcpPort"] != tc.wantTCPPort {
			t.Errorf("listen %q: tcpPort = %v, want %v", tc.listen, network["tcpPort"], tc.wantTCPPort)
		}
		if network["allowLanAccess"] != tc.wantLAN {
			t.Errorf("listen %q: allowLanAccess = %v, want %v", tc.listen, network["allowLanAccess"], tc.wantLAN)
		}
	}
}

// The toggle is persisted as an address, keeping the port this daemon bound.
func TestLANPatchTranslatesToThePersistedListen(t *testing.T) {
	t.Setenv("BYSPACE_LISTEN", "")
	s := &Server{listenAddr: "127.0.0.1:6777"}

	on, err := s.daemonListenForLAN(true)
	if err != nil || on != "0.0.0.0:6777" {
		t.Fatalf("enable = %q, %v; want 0.0.0.0:6777", on, err)
	}
	off, err := s.daemonListenForLAN(false)
	if err != nil || off != "127.0.0.1:6777" {
		t.Fatalf("disable = %q, %v; want 127.0.0.1:6777", off, err)
	}
}

// A socket has no LAN to expose, and an environment-owned address would make the saved value a
// lie on the next start. Both are refused with a reason instead of silently storing nothing.
func TestLANPatchRefusesAddressesItCannotOwn(t *testing.T) {
	t.Setenv("BYSPACE_LISTEN", "")
	if _, err := (&Server{listenAddr: "/tmp/byspace.sock"}).daemonListenForLAN(true); err == nil {
		t.Fatal("a socket listener must refuse LAN access")
	}
	t.Setenv("BYSPACE_LISTEN", "127.0.0.1:6777")
	if _, err := (&Server{listenAddr: "127.0.0.1:6777"}).daemonListenForLAN(true); err == nil {
		t.Fatal("BYSPACE_LISTEN must refuse a listen rewrite")
	}
}

// A save that does not touch the address still shows the saved intent, so the toggle does not
// flip back before the restart that applies it.
func TestListenIntentPrefersTheSavedAddress(t *testing.T) {
	t.Setenv("BYSPACE_LISTEN", "")
	s := &Server{listenAddr: "127.0.0.1:6777"}
	if got := s.listenIntent("0.0.0.0:6777"); got != "0.0.0.0:6777" {
		t.Fatalf("listenIntent = %q, want the saved address", got)
	}
	if got := s.listenIntent(""); got != "127.0.0.1:6777" {
		t.Fatalf("listenIntent = %q, want the bound address", got)
	}
	t.Setenv("BYSPACE_LISTEN", "0.0.0.0:7000")
	if got := s.listenIntent("0.0.0.0:6777"); got != "127.0.0.1:6777" {
		t.Fatalf("listenIntent = %q, want the environment-owned address", got)
	}
}

// `network` is a view: only the toggle is writable, and the rest of the block must not reach the
// persisted config.
func TestTakeDaemonNetworkPatch(t *testing.T) {
	enable := true
	config := map[string]any{
		"network": map[string]any{"allowLanAccess": true, "tcpPort": 6777},
		"relay":   map[string]any{"enabled": true},
	}
	got, ok := takeDaemonNetworkPatch(config)
	if !ok || got == nil || *got != enable {
		t.Fatalf("takeDaemonNetworkPatch = %v, %v; want true", got, ok)
	}
	if _, present := config["network"]; present {
		t.Fatal("the view block must be removed from the patch")
	}
	if config["relay"] == nil {
		t.Fatal("other settings must survive")
	}
}
