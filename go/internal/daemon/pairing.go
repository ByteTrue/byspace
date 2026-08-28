package daemon

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strings"

	"byspace/internal/relay"
)

const defaultPairingAppURL = "https://app.byspace.cc.cd/"

type pairingOfferResult struct {
	Offer        relay.PairingOfferV3
	URL          string
	RelayEnabled bool
}

func buildPairingOffer(appURL, expectedRelayURL string, runtime *relayRuntime) (pairingOfferResult, error) {
	if runtime == nil {
		return pairingOfferResult{}, nil
	}
	if expectedRelayURL != "" {
		expected, err := ParseRelayURL(expectedRelayURL)
		if err != nil {
			return pairingOfferResult{}, err
		}
		if !sameRelayOrigin(expected, runtime.endpoint) {
			return pairingOfferResult{}, fmt.Errorf("daemon is connected to Relay %s, not %s", runtime.endpoint.Redacted(), expected.Redacted())
		}
	}
	parsedApp, err := parsePairingAppURL(appURL)
	if err != nil {
		return pairingOfferResult{}, err
	}
	relayPort := runtime.endpoint.Port()
	if relayPort == "" {
		if runtime.endpoint.Scheme == "wss" {
			relayPort = "443"
		} else {
			relayPort = "80"
		}
	}
	offer := relay.PairingOfferV3{
		Version:            3,
		ServerID:           runtime.serverID,
		DaemonPublicKeyB64: runtime.identity.PublicKeyBase64(),
		ClientAuthTokenB64: runtime.identity.ClientAuthTokenBase64(),
	}
	offer.Relay.Endpoint = net.JoinHostPort(runtime.endpoint.Hostname(), relayPort)
	offer.Relay.UseTLS = runtime.endpoint.Scheme == "wss"
	payload, err := json.Marshal(offer)
	if err != nil {
		return pairingOfferResult{}, fmt.Errorf("encode pairing offer: %w", err)
	}
	parsedApp.Fragment = "offer=" + base64.RawURLEncoding.EncodeToString(payload)
	return pairingOfferResult{Offer: offer, URL: parsedApp.String(), RelayEnabled: runtime.Ready()}, nil
}

func parsePairingAppURL(raw string) (*url.URL, error) {
	if strings.TrimSpace(raw) == "" {
		raw = defaultPairingAppURL
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("app URL must be an absolute http:// or https:// URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("app URL must not contain userinfo, a query, or a fragment")
	}
	return parsed, nil
}
