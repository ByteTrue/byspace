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

// The bundled web UI must load on a password-protected daemon.
//
// The reference implementation mounts it before the bearer middleware for exactly this reason: a
// browser opened at http://127.0.0.1:6777 has nowhere to get a password, so gating the shell meant
// the page answered `{"error":"Unauthorized"}` instead of the app. Only the API and the socket stay
// protected, and the static handler refuses those paths itself.
func TestWebUIIsServedBeforeAuth(t *testing.T) {
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<!doctype html><title>app</title>"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test", WebDir: webDir})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	setDaemonPassword(t, srv, "hunter2")

	recorder := httptest.NewRecorder()
	srv.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET / = %d, want 200: the app shell must load without a password", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "<title>app</title>") {
		t.Fatalf("body = %q, want the index document", recorder.Body.String())
	}

	// The API behind it stays protected.
	recorder = httptest.NewRecorder()
	srv.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/status", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("GET /api/status = %d, want 401", recorder.Code)
	}

	// So does the socket.
	wsRecorder := httptest.NewRecorder()
	srv.ServeHTTP(wsRecorder, httptest.NewRequest(http.MethodGet, "/ws", nil))
	if wsRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("GET /ws = %d, want 401", wsRecorder.Code)
	}
}

func TestWebUILoopbackAutoInjectsCLICredentialOnlyForDirectLoopback(t *testing.T) {
	homeDir := t.TempDir()
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<!doctype html><head><title>app</title></head><body>ok</body>"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{HomeDir: homeDir, Version: "test", WebDir: webDir})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	credential := EnsureCLICredential(homeDir)

	// Direct loopback request gets the local CLI credential injected for zero-prompt Local Web login.
	loopbackReq := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6777/", nil)
	loopbackReq.RemoteAddr = "127.0.0.1:54321"
	loopbackReq.Host = "127.0.0.1:6777"
	loopbackRec := httptest.NewRecorder()
	srv.ServeHTTP(loopbackRec, loopbackReq)
	if loopbackRec.Code != http.StatusOK {
		t.Fatalf("loopback GET / = %d, want 200", loopbackRec.Code)
	}
	if !strings.Contains(loopbackRec.Body.String(), `"password":"`+credential+`"`) {
		t.Fatalf("loopback index.html missing injected CLI credential: %s", loopbackRec.Body.String())
	}

	// Non-loopback LAN request must never receive the local CLI credential.
	lanReq := httptest.NewRequest(http.MethodGet, "http://192.168.1.50:6777/", nil)
	lanReq.RemoteAddr = "192.168.1.99:54321"
	lanReq.Host = "192.168.1.50:6777"
	lanRec := httptest.NewRecorder()
	srv.ServeHTTP(lanRec, lanReq)
	if lanRec.Code != http.StatusOK {
		t.Fatalf("LAN GET / = %d, want 200", lanRec.Code)
	}
	if strings.Contains(lanRec.Body.String(), credential) {
		t.Fatalf("LAN index.html leaked CLI credential: %s", lanRec.Body.String())
	}
}

func TestDesktopSettingsEndpointRequiresDirectLoopbackAndLoopbackOrigin(t *testing.T) {
	homeDir := t.TempDir()
	srv := newTestServer(t, homeDir)
	srv.SetDesktopSettingsHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"desktop":true}`))
	}))

	// Direct loopback request succeeds.
	okReq := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6777/_byspace/desktop/settings", nil)
	okReq.RemoteAddr = "127.0.0.1:54321"
	okReq.Host = "127.0.0.1:6777"
	okReq.Header.Set("Origin", "http://127.0.0.1:6777")
	okRec := httptest.NewRecorder()
	srv.ServeHTTP(okRec, okReq)
	if okRec.Code != http.StatusOK {
		t.Fatalf("loopback GET /_byspace/desktop/settings = %d, want 200", okRec.Code)
	}

	// Cross-site Origin on loopback is rejected (CSRF protection).
	csrfReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:6777/_byspace/desktop/settings", nil)
	csrfReq.RemoteAddr = "127.0.0.1:54321"
	csrfReq.Host = "127.0.0.1:6777"
	csrfReq.Header.Set("Origin", "https://evil.example")
	csrfRec := httptest.NewRecorder()
	srv.ServeHTTP(csrfRec, csrfReq)
	if csrfRec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin POST /_byspace/desktop/settings = %d, want 403", csrfRec.Code)
	}

	// Non-loopback client is rejected.
	lanReq := httptest.NewRequest(http.MethodGet, "http://192.168.1.50:6777/_byspace/desktop/settings", nil)
	lanReq.RemoteAddr = "192.168.1.99:54321"
	lanReq.Host = "192.168.1.50:6777"
	lanRec := httptest.NewRecorder()
	srv.ServeHTTP(lanRec, lanReq)
	if lanRec.Code != http.StatusForbidden {
		t.Fatalf("LAN GET /_byspace/desktop/settings = %d, want 403", lanRec.Code)
	}
}
