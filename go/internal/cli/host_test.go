package cli

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"byspace/internal/relay"
)

func TestHostCLIImportsListsAndRemovesWithoutLeakingSecrets(t *testing.T) {
	home := t.TempDir()
	offer := cliTestPairingOffer()
	url := cliTestOfferURL(t, offer)
	var stdout, stderr bytes.Buffer
	if code := runHost([]string{"import", "--home", home}, strings.NewReader(url), &stdout, &stderr); code != 0 {
		t.Fatalf("host import exit = %d, stderr = %q", code, stderr.String())
	}
	if strings.Contains(stdout.String(), offer.ClientAuthTokenB64) || strings.Contains(stderr.String(), offer.ClientAuthTokenB64) {
		t.Fatal("host import output leaked client authentication token")
	}

	stdout.Reset()
	stderr.Reset()
	if code := runHost([]string{"list", "--home", home, "--json"}, strings.NewReader(""), &stdout, &stderr); code != 0 {
		t.Fatalf("host list exit = %d, stderr = %q", code, stderr.String())
	}
	if strings.Contains(stdout.String(), offer.ClientAuthTokenB64) || strings.Contains(stdout.String(), offer.DaemonPublicKeyB64) {
		t.Fatal("host list output leaked pairing trust material")
	}
	var listed []remoteHostSummary
	if err := json.Unmarshal(stdout.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ServerID != offer.ServerID || listed[0].RelayEndpoint != offer.Relay.Endpoint || !listed[0].UseTLS {
		t.Fatalf("host list = %+v", listed)
	}

	stdout.Reset()
	stderr.Reset()
	if code := runHost([]string{"remove", offer.ServerID, "--home", home}, strings.NewReader(""), &stdout, &stderr); code != 0 {
		t.Fatalf("host remove exit = %d, stderr = %q", code, stderr.String())
	}
	if hosts, err := relay.LoadRemoteHosts(relay.RemoteHostsPath(home)); err != nil || len(hosts) != 0 {
		t.Fatalf("hosts after remove = %+v, err = %v", hosts, err)
	}
}

func TestHostCLIFileImportIsIdempotentAndConflictsFailClosed(t *testing.T) {
	home := t.TempDir()
	offer := cliTestPairingOffer()
	path := filepath.Join(t.TempDir(), "offer.txt")
	if err := os.WriteFile(path, []byte(cliTestOfferURL(t, offer)), 0o600); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		var stdout, stderr bytes.Buffer
		if code := runHost([]string{"import", "--home", home, "--file", path}, strings.NewReader(""), &stdout, &stderr); code != 0 {
			t.Fatalf("idempotent host import exit = %d, stderr = %q", code, stderr.String())
		}
	}

	conflict := offer
	conflict.Relay.Endpoint = "other.example:443"
	var stdout, stderr bytes.Buffer
	if code := runHost([]string{"import", "--home", home}, strings.NewReader(cliTestOfferURL(t, conflict)), &stdout, &stderr); code != 1 {
		t.Fatalf("conflicting host import exit = %d", code)
	}
	if strings.Contains(stderr.String(), offer.ClientAuthTokenB64) || strings.Contains(stderr.String(), cliTestOfferURL(t, conflict)) {
		t.Fatal("conflicting host import error leaked pairing offer")
	}
}

func TestHostCLIRejectsPublicOrSymlinkedOfferFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX mode and symlink assertions")
	}
	offerURL := cliTestOfferURL(t, cliTestPairingOffer())
	directory := t.TempDir()
	publicPath := filepath.Join(directory, "public-offer.txt")
	if err := os.WriteFile(publicPath, []byte(offerURL), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(publicPath, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{publicPath, filepath.Join(directory, "offer-link.txt")} {
		if strings.HasSuffix(path, "offer-link.txt") {
			if err := os.Symlink(publicPath, path); err != nil {
				t.Fatal(err)
			}
		}
		var stdout, stderr bytes.Buffer
		if code := runHost([]string{"import", "--home", t.TempDir(), "--file", path}, strings.NewReader(""), &stdout, &stderr); code != 1 {
			t.Fatalf("public/symlink offer file %q exit = %d, stderr = %q", path, code, stderr.String())
		}
		if strings.Contains(stdout.String(), offerURL) || strings.Contains(stderr.String(), offerURL) {
			t.Fatal("offer file rejection leaked its contents")
		}
	}
}

func TestHostCLIRejectsOfferArgumentsAndOversizedInput(t *testing.T) {
	offerURL := cliTestOfferURL(t, cliTestPairingOffer())
	var stdout, stderr bytes.Buffer
	if code := runHost([]string{"import", offerURL}, strings.NewReader(""), &stdout, &stderr); code != 2 {
		t.Fatalf("positional offer exit = %d", code)
	}
	if strings.Contains(stderr.String(), offerURL) {
		t.Fatal("positional offer error echoed the secret input")
	}

	stdout.Reset()
	stderr.Reset()
	if code := runHost([]string{"import"}, strings.NewReader(strings.Repeat("x", maxPairingOfferBytes+1)), &stdout, &stderr); code != 1 {
		t.Fatalf("oversized offer exit = %d", code)
	}
}

func cliTestPairingOffer() relay.PairingOfferV3 {
	var offer relay.PairingOfferV3
	offer.Version = 3
	offer.ServerID = "srv_abcdefghijkl"
	publicKey := make([]byte, relay.KeySize)
	publicKey[0] = 9
	offer.DaemonPublicKeyB64 = base64.StdEncoding.EncodeToString(publicKey)
	offer.ClientAuthTokenB64 = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("s", relay.ClientAuthSize)))
	offer.Relay.Endpoint = "relay.byspace.cc.cd:443"
	offer.Relay.UseTLS = true
	return offer
}

func cliTestOfferURL(t *testing.T, offer relay.PairingOfferV3) string {
	t.Helper()
	payload, err := json.Marshal(offer)
	if err != nil {
		t.Fatal(err)
	}
	return "https://app.byspace.cc.cd/#offer=" + base64.RawURLEncoding.EncodeToString(payload)
}
