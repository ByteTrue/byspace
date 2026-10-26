package cli

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/server"
)

// An offer minted without a reachable daemon must name the app origin the home is configured for.
//
// `byspace pair` asks the running daemon for the offer. That needs the websocket, which a
// password-protected daemon refuses without the password, so the common case is the in-process
// fallback. The fallback derived the origin from the CLI version — a hyphen meant the prerelease app
// — which sent a home configured for `app.byspace.cc.cd` a link into a different deployment.
func TestOfflinePairingOfferUsesTheConfiguredAppOrigin(t *testing.T) {
	homeDir := t.TempDir()
	writeHomeConfig(t, homeDir, `{
  "version": 1,
  "daemon": {"relay": {"enabled": true}},
  "app": {"baseUrl": "https://app.byspace.cc.cd"}
}`)

	offer := buildOfflinePairingOffer("0.21.0-beta.4", homeDir, "", true, "")
	origin, relay := decodeOffer(t, offer)

	if origin != "https://app.byspace.cc.cd" {
		t.Fatalf("app origin = %q, want the configured one", origin)
	}
	if relay.Endpoint != "relay.byspace.cc.cd:443" || !relay.UseTLS {
		t.Fatalf("relay = %+v, want the hosted relay over TLS", relay)
	}
}

// A home with no app configured keeps the version-derived default.
func TestOfflinePairingOfferFallsBackToTheVersionDefault(t *testing.T) {
	homeDir := t.TempDir()
	writeHomeConfig(t, homeDir, `{"version": 1}`)

	origin, _ := decodeOffer(t, buildOfflinePairingOffer("0.21.0-beta.4", homeDir, "", true, ""))
	if origin != "https://app-beta.byspace.cc.cd" {
		t.Fatalf("app origin = %q, want the prerelease default for a prerelease build", origin)
	}

	origin, _ = decodeOffer(t, buildOfflinePairingOffer("0.21.0", homeDir, "", true, ""))
	if origin != "https://app.byspace.cc.cd" {
		t.Fatalf("app origin = %q, want the stable default for a stable build", origin)
	}
}

// An explicit flag still wins: the operator asked for those values.
func TestOfflinePairingOfferKeepsExplicitOverrides(t *testing.T) {
	homeDir := t.TempDir()
	writeHomeConfig(t, homeDir, `{
  "version": 1,
  "daemon": {"relay": {"enabled": true, "endpoint": "relay.example:443"}},
  "app": {"baseUrl": "https://app.byspace.cc.cd"}
}`)

	origin, relay := decodeOffer(t, buildOfflinePairingOffer(
		"0.21.0-beta.4", homeDir, "10.0.0.5:8787", false, "https://staging.example",
	))
	if origin != "https://staging.example" {
		t.Fatalf("app origin = %q, want the explicit one", origin)
	}
	if relay.Endpoint != "10.0.0.5:8787" || relay.UseTLS {
		t.Fatalf("relay = %+v, want the explicit one over plaintext", relay)
	}
}

func writeHomeConfig(t *testing.T, homeDir, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(homeDir, "config.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

type offerRelay struct {
	Endpoint string `json:"endpoint"`
	UseTLS   bool   `json:"useTls"`
}

func decodeOffer(t *testing.T, offer string) (string, offerRelay) {
	t.Helper()
	marker := "#offer="
	idx := strings.Index(offer, marker)
	if idx < 0 {
		t.Fatalf("offer %q carries no fragment", offer)
	}
	raw := offer[idx+len(marker):]
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		t.Fatalf("offer fragment is not base64url: %v", err)
	}
	var payload struct {
		Relay offerRelay `json:"relay"`
	}
	if err := json.Unmarshal(decoded, &payload); err != nil {
		t.Fatalf("offer payload is not JSON: %v", err)
	}
	u, err := url.Parse(offer[:idx])
	if err != nil {
		t.Fatalf("offer origin is not a URL: %v", err)
	}
	return u.Scheme + "://" + u.Host, payload.Relay
}

// The CLI must present the home's credential, or every websocket command 401s on a protected home.
//
// It read only `BYSPACE_PASSWORD`, which no user has: the password is a bcrypt hash on disk. The
// result was that `ls` worked (it reads files) while `project list`, `run` and `pair` all failed
// with an upgrade 401 that looks like the daemon being down.
func TestCLIReadsTheHomeCredential(t *testing.T) {
	homeDir := t.TempDir()
	credential := server.EnsureCLICredential(homeDir)
	if credential == "" {
		t.Fatal("expected the server package to mint a credential")
	}
	if got := server.LoadCLICredential(homeDir); got != credential {
		t.Fatalf("LoadCLICredential = %q, want %q", got, credential)
	}

	// An empty home has no credential, and asking must not invent one: `dialDaemonWS` falls back
	// to BYSPACE_PASSWORD only when this answers "".
	if got := server.LoadCLICredential(t.TempDir()); got != "" {
		t.Fatalf("a home without a credential returned %q", got)
	}
}

// An unset --home means the default home, and its config must still be read.
//
// The fallback was handed the empty flag value, so it opened no config at all and derived the origin
// from the version even though the home it was minting for names one.
func TestOfflinePairingOfferResolvesTheDefaultHome(t *testing.T) {
	homeDir := t.TempDir()
	writeHomeConfig(t, homeDir, `{
  "version": 1,
  "daemon": {"relay": {"enabled": true}},
  "app": {"baseUrl": "https://app.byspace.cc.cd"}
}`)
	t.Setenv("BYSPACE_HOME", homeDir)

	origin, _ := decodeOffer(t, buildOfflinePairingOffer("0.21.0-beta.5", "", "", true, ""))
	if origin != "https://app.byspace.cc.cd" {
		t.Fatalf("app origin = %q, want the configured one from the default home", origin)
	}
}
