package cli

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"byspace/internal/agent"
	"byspace/internal/daemon"
	"byspace/internal/relay"
	"github.com/coder/websocket"
)

func TestRunPairRequestsStableAuthenticatedOfferFromDaemon(t *testing.T) {
	controlReady := make(chan struct{}, 1)
	relayServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/ws" || request.URL.Query().Get("role") != "server" || request.URL.Query().Get("connectionId") != "" {
			http.Error(writer, "unexpected Relay route", http.StatusBadRequest)
			return
		}
		socket, err := websocket.Accept(writer, request, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		select {
		case controlReady <- struct{}{}:
		default:
		}
		_ = socket.Write(request.Context(), websocket.MessageText, []byte(`{"type":"sync","connectionIds":[]}`))
		_, _, _ = socket.Read(request.Context())
	}))
	defer relayServer.Close()
	relayURL := "ws" + strings.TrimPrefix(relayServer.URL, "http")

	home := t.TempDir()
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<html><head></head></html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := agent.NewManager(map[string]agent.Provider{})
	daemonCtx, stopDaemon := context.WithCancel(context.Background())
	daemonDone := make(chan error, 1)
	go func() {
		daemonDone <- daemon.Run(daemonCtx, daemon.Options{
			Home: home, Listen: "127.0.0.1:0", WorkspaceRoot: t.TempDir(), WebDir: webDir,
			RelayURL: relayURL, AgentManager: manager,
		})
	}()
	waitForCLITestDaemon(t, home)
	select {
	case <-controlReady:
	case <-time.After(3 * time.Second):
		t.Fatal("daemon did not connect to test Relay")
	}
	defer func() {
		stopDaemon()
		if err := <-daemonDone; err != nil {
			t.Errorf("daemon shutdown: %v", err)
		}
	}()

	identityInfo, err := os.Stat(relay.IdentityPath(home))
	if err != nil {
		t.Fatalf("daemon did not own Relay identity: %v", err)
	}
	args := []string{"pair", "--home", home, "--relay-url", relayURL, "--json"}
	var stdout, stderr bytes.Buffer
	if code := Run(args, &stdout, &stderr); code != 0 {
		t.Fatalf("pair exit = %d, stderr = %q", code, stderr.String())
	}
	if after, err := os.Stat(relay.IdentityPath(home)); err != nil || !after.ModTime().Equal(identityInfo.ModTime()) {
		t.Fatal("pair command modified daemon identity state")
	}
	var result pairingOfferPayload
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.RelayEnabled || result.Offer.Version != 3 || result.Offer.Relay.Endpoint == "" {
		t.Fatalf("unexpected offer: %+v", result)
	}
	if len(result.Offer.ClientAuthTokenB64) == 0 || len(result.Offer.DaemonPublicKeyB64) == 0 {
		t.Fatal("pairing offer omitted E2EE capabilities")
	}
	parsed, err := url.Parse(result.URL)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(parsed.Fragment, "offer="))
	if err != nil {
		t.Fatal(err)
	}
	var fromURL relayPairingOffer
	if err := json.Unmarshal(payload, &fromURL); err != nil {
		t.Fatal(err)
	}
	if fromURL != result.Offer {
		t.Fatal("offer URL payload differs from JSON offer")
	}

	stdout.Reset()
	stderr.Reset()
	if code := Run(args, &stdout, &stderr); code != 0 {
		t.Fatalf("second pair exit = %d, stderr = %q", code, stderr.String())
	}
	var second pairingOfferPayload
	if err := json.Unmarshal(stdout.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.Offer != result.Offer {
		t.Fatal("pairing offer changed across daemon RPC invocations")
	}

	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"pair", "--home", home, "--relay-url", "wss://wrong.example"}, &stdout, &stderr); code != 1 {
		t.Fatalf("mismatched Relay pair exit = %d", code)
	}
	if !strings.Contains(stderr.String(), "not") {
		t.Fatalf("mismatched Relay stderr = %q", stderr.String())
	}
}

func TestRunPairRequiresRunningRelayEnabledDaemon(t *testing.T) {
	home := t.TempDir()
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"pair", "--home", home}, &stdout, &stderr); code != 1 {
		t.Fatalf("pair exit = %d", code)
	}
	if _, err := os.Stat(relay.IdentityPath(home)); !os.IsNotExist(err) {
		t.Fatalf("pair created identity without daemon: %v", err)
	}
}
