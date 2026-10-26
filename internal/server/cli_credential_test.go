package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A home with a password must let its own CLI in without the password.
//
// Every command that opens a websocket — `project list`, `schedule list`, `run`, `pair` — failed
// with 401 on a protected home, because the CLI had no way to present the password: it is a bcrypt
// hash on disk, and `BYSPACE_PASSWORD` is not something a user has. Commands that only read files
// (`ls`) worked, which made the failure look random.
func TestCLICredentialAuthorizesAProtectedDaemon(t *testing.T) {
	homeDir := t.TempDir()
	srv := newTestServer(t, homeDir)
	setDaemonPassword(t, srv, "hunter2")

	credential := EnsureCLICredential(homeDir)
	if credential == "" {
		t.Fatal("startup should create the CLI credential")
	}

	// The CLI presents it as a bearer on the upgrade.
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+credential)
	srv.ServeHTTP(recorder, req)
	if recorder.Code == http.StatusUnauthorized {
		t.Fatal("the CLI credential was rejected on a protected daemon")
	}

	// The password itself still works.
	recorder = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("Authorization", "Bearer hunter2")
	srv.ServeHTTP(recorder, req)
	if recorder.Code == http.StatusUnauthorized {
		t.Fatal("the password was rejected")
	}

	// Anything else is denied: the credential must not widen access.
	recorder = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("Authorization", "Bearer not-the-credential")
	srv.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("a wrong bearer got %d, want 401", recorder.Code)
	}
}

// The credential rides as a subprotocol too, because a browser cannot set the header.
func TestCLICredentialAcceptedAsWebSocketSubprotocol(t *testing.T) {
	homeDir := t.TempDir()
	srv := newTestServer(t, homeDir)
	setDaemonPassword(t, srv, "hunter2")
	credential := EnsureCLICredential(homeDir)

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("Sec-WebSocket-Protocol", "byspace.bearer."+credential)
	srv.ServeHTTP(recorder, req)
	if recorder.Code == http.StatusUnauthorized {
		t.Fatal("the subprotocol bearer was rejected")
	}
}

// A home without a password stays open to the browser app.
//
// The CLI credential exists on every home, and only the CLI can read it. Treating its presence as
// "auth is on" would 401 the app on every unprotected daemon.
func TestCLICredentialDoesNotGateAPasswordlessDaemon(t *testing.T) {
	homeDir := t.TempDir()
	srv := newTestServer(t, homeDir)
	if EnsureCLICredential(homeDir) == "" {
		t.Fatal("startup should create the CLI credential")
	}

	recorder := httptest.NewRecorder()
	srv.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/status", nil))
	if recorder.Code == http.StatusUnauthorized {
		t.Fatal("a passwordless daemon must not require the CLI credential")
	}
}

// Rotating the password must not lock the CLI out.
func TestCLICredentialSurvivesAPasswordChange(t *testing.T) {
	homeDir := t.TempDir()
	srv := newTestServer(t, homeDir)
	setDaemonPassword(t, srv, "first")
	credential := EnsureCLICredential(homeDir)

	setDaemonPassword(t, srv, "second")

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+credential)
	srv.ServeHTTP(recorder, req)
	if recorder.Code == http.StatusUnauthorized {
		t.Fatal("the CLI credential stopped working after a password change")
	}
}

func newTestServer(t *testing.T, homeDir string) *Server {
	t.Helper()
	srv, err := New(Options{HomeDir: homeDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

func setDaemonPassword(t *testing.T, srv *Server, plaintext string) {
	t.Helper()
	hash, err := HashDaemonPassword(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.Store().SetDaemonPasswordHash(hash); err != nil {
		t.Fatal(err)
	}
}

// The credential file is readable only by its owner.
//
// Unix only: Windows has no POSIX mode bits, and the file lands with whatever the inherited ACL
// grants. That is inherent to the platform rather than a gap this file can close — a Windows home
// is protected by the user profile ACL, not by 0600.
func TestCLICredentialFileMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no POSIX file modes")
	}
	homeDir := t.TempDir()
	if EnsureCLICredential(homeDir) == "" {
		t.Fatal("expected a credential")
	}
	info, err := os.Stat(filepath.Join(homeDir, CLICredentialFile))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("credential mode = %o, want 600", perm)
	}
}

// The handshake must echo the bearer subprotocol back.
//
// A browser client fails the connection when it offered subprotocols and the server selected none
// ("server sent no subprotocol"). Accepting the upgrade without the echo let the CLI in — it sends
// an Authorization header — while the app on the same daemon stayed disconnected.
func TestWebSocketHandshakeEchoesTheBearerSubprotocol(t *testing.T) {
	homeDir := t.TempDir()
	srv := newTestServer(t, homeDir)
	setDaemonPassword(t, srv, "hunter2")
	credential := EnsureCLICredential(homeDir)

	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, resp, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Authorization": []string{"Bearer " + credential}},
		Subprotocols: []string{"byspace.bearer." + credential},
	})
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("dial failed (%d): %v", status, err)
	}
	defer conn.CloseNow()

	if got := conn.Subprotocol(); got != "byspace.bearer."+credential {
		t.Fatalf("negotiated subprotocol = %q, want the bearer echoed back", got)
	}
}
