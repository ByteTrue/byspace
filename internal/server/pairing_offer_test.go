package server

import "testing"

func TestBuildPairingOfferUsesTheChannelAppOrigin(t *testing.T) {
	cases := []struct {
		name     string
		version  string
		endpoint string
		appBase  string
		want     string
	}{
		{"beta build", "0.21.0-beta.1", "relay.byspace.cc.cd:443", "", "https://app-beta.byspace.cc.cd/#offer="},
		{"stable build", "0.21.0", "relay.byspace.cc.cd:443", "", "https://app.byspace.cc.cd/#offer="},
		{"beta build pointed at the beta relay", "0.21.0-beta.1", "app-beta.byspace.cc.cd:443", "", "https://app-beta.byspace.cc.cd/#offer="},
		{"stable build pointed at the beta relay", "0.21.0", "app-beta.byspace.cc.cd:443", "", "https://app.byspace.cc.cd/#offer="},
		{"explicit app base wins", "0.21.0-beta.1", "relay.example.com:443", "https://custom.example", "https://custom.example/#offer="},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := &Server{serverID: "srv_x", pubKeyB64: "pk", version: c.version}
			got := s.BuildPairingOfferURL(c.endpoint, true, c.appBase)
			if len(got) < len(c.want) || got[:len(c.want)] != c.want {
				t.Fatalf("got %s, want prefix %s", got, c.want)
			}
		})
	}
}

func TestBuildPairingOfferFillsTheRelayPort(t *testing.T) {
	cases := []struct {
		endpoint string
		useTLS   bool
		want     string
	}{
		{"app-beta.byspace.cc.cd", true, "app-beta.byspace.cc.cd:443"},
		{"app-beta.byspace.cc.cd:443", true, "app-beta.byspace.cc.cd:443"},
		{"127.0.0.1:6778", true, "127.0.0.1:6778"},
		{"relay.example.com", false, "relay.example.com:80"},
		{"wss://relay.example.com", true, "wss://relay.example.com"},
		{"", true, ""},
	}
	for _, c := range cases {
		if got := normalizeRelayEndpoint(c.endpoint, c.useTLS); got != c.want {
			t.Errorf("%q/%v: got %q, want %q", c.endpoint, c.useTLS, got, c.want)
		}
	}
}
