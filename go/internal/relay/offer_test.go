package relay

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestParsePairingOfferURLValidatesCanonicalV3Offer(t *testing.T) {
	offer := testPairingOffer()
	payload, err := json.Marshal(offer)
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	parsed, err := ParsePairingOfferURL("https://app.byspace.cc.cd/#offer=" + encoded + "\n")
	if err != nil {
		t.Fatal(err)
	}
	if parsed != offer {
		t.Fatalf("parsed offer = %+v, want %+v", parsed, offer)
	}

	for _, endpoint := range []string{
		"relay.byspace.cc.cd:443",
		"127.0.0.1:80",
		"[2001:db8::1]:65535",
		"[::ffff:192.0.2.1]:443",
	} {
		candidate := offer
		candidate.Relay.Endpoint = endpoint
		if err := candidate.Validate(); err != nil {
			t.Fatalf("valid endpoint %q: %v", endpoint, err)
		}
	}
}

func TestParsePairingOfferURLRejectsMalformedTrustMaterial(t *testing.T) {
	valid := testPairingOffer()
	invalid := []PairingOfferV3{valid, valid, valid, valid, valid, valid}
	invalid[0].Version = 2
	invalid[1].ServerID = "srv_short"
	invalid[2].DaemonPublicKeyB64 = base64.StdEncoding.EncodeToString(make([]byte, 31))
	invalid[3].DaemonPublicKeyB64 = base64.StdEncoding.EncodeToString(make([]byte, KeySize))
	invalid[4].ClientAuthTokenB64 = strings.TrimSuffix(valid.ClientAuthTokenB64, "=")
	invalid[5].Relay.Endpoint = "relay.byspace.cc.cd"
	for _, offer := range invalid {
		payload, err := json.Marshal(offer)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ParsePairingOfferURL("#offer=" + base64.RawURLEncoding.EncodeToString(payload)); err == nil {
			t.Fatalf("invalid offer was accepted: %+v", offer)
		}
	}

	for _, raw := range []string{
		"https://app.byspace.cc.cd/",
		"#offer=not+base64",
		"#offer=" + base64.RawURLEncoding.EncodeToString([]byte(`{"v":3} {}`)),
		"#offer=" + base64.RawURLEncoding.EncodeToString([]byte(`{"v":3,"unknown":true}`)),
	} {
		if _, err := ParsePairingOfferURL(raw); err == nil {
			t.Fatalf("invalid input %q was accepted", raw)
		}
	}

	for _, endpoint := range []string{
		"relay.byspace.cc.cd",
		"relay..byspace.cc.cd:443",
		"-relay.example:443",
		"1.2.3.999:443",
		"01.2.3.4:443",
		"2001:db8::1:443",
		"[127.0.0.1]:443",
		"[2001:db8::1]:0",
		"relay.example:65536",
		" relay.example:443",
	} {
		candidate := valid
		candidate.Relay.Endpoint = endpoint
		if err := candidate.Validate(); err == nil {
			t.Fatalf("invalid endpoint %q was accepted", endpoint)
		}
	}
}

func testPairingOffer() PairingOfferV3 {
	var offer PairingOfferV3
	offer.Version = 3
	offer.ServerID = "srv_abcdefghijkl"
	publicKey := make([]byte, KeySize)
	publicKey[0] = 9
	offer.DaemonPublicKeyB64 = base64.StdEncoding.EncodeToString(publicKey)
	offer.ClientAuthTokenB64 = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("t", ClientAuthSize)))
	offer.Relay.Endpoint = "relay.byspace.cc.cd:443"
	offer.Relay.UseTLS = true
	return offer
}
