package daemon

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"byspace/internal/relay"
)

func TestBuildPairingOfferUsesActiveDaemonRelayConfiguration(t *testing.T) {
	endpoint, err := ParseRelayURL("wss://relay.byspace.cc.cd")
	if err != nil {
		t.Fatal(err)
	}
	identity, err := relay.LoadOrCreateIdentity(relay.IdentityPath(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	runtime := &relayRuntime{endpoint: endpoint, serverID: "srv_test", identity: identity}

	notReady, err := buildPairingOffer("", "", runtime)
	if err != nil {
		t.Fatal(err)
	}
	if notReady.RelayEnabled || notReady.Offer.Relay.Endpoint != "relay.byspace.cc.cd:443" {
		t.Fatalf("unexpected not-ready offer: %+v", notReady)
	}
	runtime.ready.Store(true)
	result, err := buildPairingOffer("https://custom.example/pair", "wss://relay.byspace.cc.cd:443", runtime)
	if err != nil {
		t.Fatal(err)
	}
	if !result.RelayEnabled || result.Offer.ServerID != "srv_test" {
		t.Fatalf("unexpected ready offer: %+v", result)
	}
	parsed, err := url.Parse(result.URL)
	if err != nil {
		t.Fatal(err)
	}
	encoded := strings.TrimPrefix(parsed.Fragment, "offer=")
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var offer relay.PairingOfferV3
	if err := json.Unmarshal(payload, &offer); err != nil {
		t.Fatal(err)
	}
	if offer != result.Offer {
		t.Fatal("pairing URL does not contain returned offer")
	}
}

func TestBuildPairingOfferRejectsMismatchedRelayAndInvalidAppURL(t *testing.T) {
	endpoint, err := ParseRelayURL("wss://relay.byspace.cc.cd")
	if err != nil {
		t.Fatal(err)
	}
	runtime := &relayRuntime{endpoint: endpoint}
	for _, test := range []struct {
		appURL   string
		relayURL string
	}{
		{appURL: "file:///tmp/app"},
		{appURL: "https://user@example.com/"},
		{appURL: "https://app.example/?secret=1"},
		{relayURL: "wss://wrong.example"},
	} {
		if _, err := buildPairingOffer(test.appURL, test.relayURL, runtime); err == nil {
			t.Fatalf("accepted app=%q relay=%q", test.appURL, test.relayURL)
		}
	}
}
