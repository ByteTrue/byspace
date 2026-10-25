package server

import "testing"

func TestBuildPairingOfferFillsTheRelayPortAndDerivesTheAppURL(t *testing.T) {
	s := &Server{serverID: "srv_x", pubKeyB64: "pk", version: "0.21.0-beta.1"}
	cases := []struct {
		name     string
		endpoint string
		useTLS   bool
		appBase  string
		want     string
	}{
		{"beta app host", "app-beta.byspace.cc.cd", true, "", "https://app-beta.byspace.cc.cd/#offer="},
		{"beta app host with port", "app-beta.byspace.cc.cd:443", true, "", "https://app-beta.byspace.cc.cd/#offer="},
		{"stable app host", "app.byspace.cc.cd", true, "", "https://app.byspace.cc.cd/#offer="},
		{"relay host falls back to the channel", "relay.byspace.cc.cd", true, "", "https://app-beta.byspace.cc.cd/#offer="},
		{"self-hosted falls back to the channel", "relay.example.com", false, "", "https://app-beta.byspace.cc.cd/#offer="},
		{"explicit app base wins", "app-beta.byspace.cc.cd", true, "https://custom.example", "https://custom.example/#offer="},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := s.BuildPairingOfferURL(c.endpoint, c.useTLS, c.appBase)
			if len(got) < len(c.want) || got[:len(c.want)] != c.want {
				t.Fatalf("got %s, want prefix %s", got, c.want)
			}
		})
	}
}

func TestBuildPairingOfferStableChannelUsesTheStableApp(t *testing.T) {
	s := &Server{serverID: "srv_x", pubKeyB64: "pk", version: "0.21.0"}
	got := s.BuildPairingOfferURL("relay.byspace.cc.cd", true, "")
	if want := "https://app.byspace.cc.cd/#offer="; got[:len(want)] != want {
		t.Fatalf("got %s, want prefix %s", got, want)
	}
}

func TestNormalizeRelayEndpoint(t *testing.T) {
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

func TestAppBaseURLForKeepsAnExplicitAppHost(t *testing.T) {
	if got := appBaseURLFor("app.byspace.cc.cd:443", "0.21.0-beta.1"); got != "https://app.byspace.cc.cd" {
		t.Errorf("stable host: got %s", got)
	}
	if got := appBaseURLFor("relay.byspace.cc.cd:443", "0.21.0"); got != "https://app.byspace.cc.cd" {
		t.Errorf("relay host on a stable build: got %s", got)
	}
}
