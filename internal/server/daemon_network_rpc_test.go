package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// The settings toggle has to become a persisted `daemon.listen`, or it is only a stored boolean
// that the next start ignores. Before this, a home could say allowLanAccess:true while the daemon
// still bound 127.0.0.1 — the switch looked on and nothing was reachable.
func TestSetDaemonConfigTogglesLANThroughDaemonListen(t *testing.T) {
	t.Setenv("BYSPACE_LISTEN", "")
	homeDir := t.TempDir()
	srv, err := New(Options{HomeDir: homeDir, Version: "test", ListenAddr: "127.0.0.1:6777"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	setDaemonPassword(t, srv, "hunter2")
	credential := EnsureCLICredential(homeDir)

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", &websocket.DialOptions{
		HTTPHeader:   http.Header{"Authorization": []string{"Bearer " + credential}},
		Subprotocols: []string{"byspace.bearer." + credential},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_network","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")

	patch := func(config map[string]any) map[string]any {
		t.Helper()
		frame, _ := json.Marshal(map[string]any{"type": "session", "message": map[string]any{
			"type":      "set_daemon_config_request",
			"requestId": "req_network",
			"config":    config,
		}})
		if err := ws.Write(ctx, websocket.MessageText, frame); err != nil {
			t.Fatal(err)
		}
		return readUntilSessionType(t, ctx, ws, "set_daemon_config_response", "")
	}

	// 0. Without a password, opening LAN access is refused: every device on the network could
	// drive agents. Clear the seeded password first to reach that state.
	response := patch(map[string]any{"auth": map[string]any{"password": nil}})
	if got := response["error"]; got != nil {
		t.Fatalf("clearing the password with LAN off failed: %v", got)
	}
	response = patch(map[string]any{"network": map[string]any{"allowLanAccess": true}})
	if response["error"] == nil {
		t.Fatal("enabling LAN without a password must be refused")
	}
	if got := srv.Store().PersistedListenAddr(); got != "" {
		t.Fatalf("the refused patch persisted daemon.listen = %q", got)
	}
	response = patch(map[string]any{"auth": map[string]any{"password": "hunter2"}})
	if got := response["error"]; got != nil {
		t.Fatalf("setting a password failed: %v", got)
	}

	// 1. Enabling LAN writes the wildcard listen while keeping the bound port.
	response = patch(map[string]any{"network": map[string]any{"allowLanAccess": true}})
	if got := response["error"]; got != nil {
		t.Fatalf("enabling LAN failed: %v", got)
	}
	if got := srv.Store().PersistedListenAddr(); got != "0.0.0.0:6777" {
		t.Fatalf("daemon.listen = %q, want 0.0.0.0:6777", got)
	}
	network := response["config"].(map[string]any)["network"].(map[string]any)
	if network["allowLanAccess"] != true || network["tcpPort"] != float64(6777) {
		t.Fatalf("view = %v, want LAN on at port 6777", network)
	}

	// 2. Clearing the password while LAN is open would leave the daemon exposed.
	response = patch(map[string]any{"auth": map[string]any{"password": nil}})
	if response["error"] == nil {
		t.Fatal("clearing the password with LAN access on must be refused")
	}
	if srv.Store().DaemonPasswordHash() == "" {
		t.Fatal("the refused patch cleared the password anyway")
	}

	// 3. Turning LAN off and clearing the password together is allowed.
	response = patch(map[string]any{
		"network": map[string]any{"allowLanAccess": false},
		"auth":    map[string]any{"password": nil},
	})
	if got := response["error"]; got != nil {
		t.Fatalf("closing LAN and clearing the password failed: %v", got)
	}
	if got := srv.Store().PersistedListenAddr(); got != "127.0.0.1:6777" {
		t.Fatalf("daemon.listen = %q, want 127.0.0.1:6777", got)
	}
	auth := response["config"].(map[string]any)["auth"].(map[string]any)
	if auth["passwordSet"] != false {
		t.Fatalf("auth = %v, want passwordSet false", auth)
	}
}
