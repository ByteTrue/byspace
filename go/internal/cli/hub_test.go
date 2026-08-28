package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"byspace/internal/agent"
	"byspace/internal/daemon"
	"byspace/internal/hub"
	"github.com/coder/websocket"
)

func TestHubCLILoginConnectRestartStatusAndDisconnect(t *testing.T) {
	const (
		humanCredential = "human-cli-secret"
		enrollmentToken = "one-time-enrollment-token-1234567890"
	)
	connected := make(chan string, 4)
	revoked := make(chan struct{}, 1)
	var authorityMu sync.Mutex
	daemonCredential := ""
	var hubServer *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/cli-authorizations", func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			response.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		writeTestJSON(response, http.StatusCreated, map[string]any{
			"deviceCode": "device-code-with-more-than-thirty-two-characters", "userCode": "ABCD-EFGH",
			"verificationUri": hubServer.URL + "/device", "verificationUriComplete": hubServer.URL + "/device?code=ABCD-EFGH",
			"expiresAt": time.Now().Add(time.Minute).UTC().Format(time.RFC3339), "interval": 1,
		})
	})
	mux.HandleFunc("/api/v1/cli-authorizations/poll", func(response http.ResponseWriter, request *http.Request) {
		writeTestJSON(response, http.StatusOK, map[string]any{
			"status": "authorized", "interval": 1, "credential": humanCredential,
			"organizationId": "11111111-1111-4111-8111-111111111111",
		})
	})
	mux.HandleFunc("/api/v1/daemons/enrollment-tokens", func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+humanCredential {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeTestJSON(response, http.StatusCreated, map[string]any{
			"token": enrollmentToken, "expiresAt": time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
		})
	})
	mux.HandleFunc("/api/daemons/enroll", func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+enrollmentToken {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body struct {
			DaemonID string `json:"daemonId"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body.DaemonID == "" {
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		writeTestJSON(response, http.StatusCreated, map[string]any{
			"daemonId": body.DaemonID, "scopes": []string{"hub.execution.*"},
			"webSocketUrl": strings.Replace(hubServer.URL, "http://", "ws://", 1) + "/api/daemons/socket",
		})
	})
	mux.HandleFunc("/api/daemons/socket", func(response http.ResponseWriter, request *http.Request) {
		credential := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
		daemonID := request.Header.Get("X-Paseo-Daemon-Id")
		if credential == "" || daemonID == "" {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		authorityMu.Lock()
		daemonCredential = credential
		authorityMu.Unlock()
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		connected <- daemonID
		_, _, _ = connection.Read(request.Context())
	})
	mux.HandleFunc("/api/daemons/", func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodDelete || request.Header.Get("Authorization") == "" {
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		revoked <- struct{}{}
		response.WriteHeader(http.StatusNoContent)
	})
	hubServer = httptest.NewServer(mux)
	defer hubServer.Close()

	home := t.TempDir()
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"hub", "login", "--home", home, hubServer.URL}, &stdout, &stderr); code != 0 {
		t.Fatalf("hub login exit = %d, stderr = %q", code, stderr.String())
	}
	assertDoesNotContainHubSecrets(t, stdout.String()+stderr.String(), humanCredential, enrollmentToken)
	stored, err := hub.LoadHumanCredential(home, hubServer.URL)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Credential != humanCredential {
		t.Fatal("Hub CLI credential was not stored")
	}

	stopDaemon := startHubCLITestDaemon(t, home)
	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"hub", "connect", hubServer.URL, "--home", home, "--json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("hub connect exit = %d, stderr = %q", code, stderr.String())
	}
	assertDoesNotContainHubSecrets(t, stdout.String()+stderr.String(), humanCredential, enrollmentToken)
	firstDaemonID := <-connected
	waitForCLIHubStatus(t, home, "connected", firstDaemonID)

	stopDaemon()
	stopDaemon = startHubCLITestDaemon(t, home)
	defer stopDaemon()
	select {
	case restartedDaemonID := <-connected:
		if restartedDaemonID != firstDaemonID {
			t.Fatalf("daemon relationship ID changed across restart: %q != %q", restartedDaemonID, firstDaemonID)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("restarted daemon did not reconnect to Hub")
	}
	waitForCLIHubStatus(t, home, "connected", firstDaemonID)

	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"hub", "disconnect", "--home", home, "--json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("hub disconnect exit = %d, stderr = %q", code, stderr.String())
	}
	select {
	case <-revoked:
	case <-time.After(3 * time.Second):
		t.Fatal("Hub relationship was not revoked")
	}
	authorityMu.Lock()
	privateDaemonCredential := daemonCredential
	authorityMu.Unlock()
	assertDoesNotContainHubSecrets(t, stdout.String()+stderr.String(), humanCredential, enrollmentToken, privateDaemonCredential)
}

func startHubCLITestDaemon(t *testing.T, home string) func() {
	t.Helper()
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<html><head></head></html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := agent.NewManager(map[string]agent.Provider{})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx, daemon.Options{
			Home: home, Listen: "127.0.0.1:0", WorkspaceRoot: t.TempDir(), WebDir: webDir,
			AgentManager: manager,
		})
	}()
	waitForCLITestDaemon(t, home)
	return func() {
		cancel()
		if err := <-done; err != nil {
			t.Errorf("daemon shutdown: %v", err)
		}
		manager.Close(context.Background())
	}
}

func waitForCLIHubStatus(t *testing.T, home, state, daemonID string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var stdout, stderr bytes.Buffer
		code := Run([]string{"hub", "status", "--home", home, "--json"}, &stdout, &stderr)
		if code == 0 {
			var status hub.Status
			if json.Unmarshal(stdout.Bytes(), &status) == nil && status.State == hub.State(state) && status.DaemonID != nil && *status.DaemonID == daemonID {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Hub status did not reach %s", state)
}

func assertDoesNotContainHubSecrets(t *testing.T, output string, secrets ...string) {
	t.Helper()
	for _, secret := range secrets {
		if secret != "" && strings.Contains(output, secret) {
			t.Fatalf("CLI output leaked Hub secret %q: %s", secret, output)
		}
	}
}

func writeTestJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
