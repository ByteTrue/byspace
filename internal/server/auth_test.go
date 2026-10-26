package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

// A header with extra parts is rejected rather than parsed loosely: accepting "Bearer a b"
// would let a proxy or a bug smuggle a second token past the comparison.
func TestExtractHTTPBearerToken(t *testing.T) {
	cases := map[string]struct {
		token string
		ok    bool
	}{
		"Bearer abc123":     {"abc123", true},
		"Bearer   abc123  ": {"abc123", true},
		"bearer abc123":     {"", false}, // scheme is case-sensitive per the node implementation
		"Bearer":            {"", false},
		"Bearer a b":        {"", false},
		"Basic abc":         {"", false},
		"":                  {"", false},
	}
	for header, want := range cases {
		got, ok := ExtractHTTPBearerToken(header)
		if got != want.token || ok != want.ok {
			t.Fatalf("ExtractHTTPBearerToken(%q) = %q,%v want %q,%v", header, got, ok, want.token, want.ok)
		}
	}
}

// Browsers cannot set an Authorization header on a WebSocket, so the token travels as a
// subprotocol and may itself contain dots.
func TestExtractWSBearerToken(t *testing.T) {
	token, ok := ExtractWSBearerToken([]string{"byspace.bearer.a.b.c"})
	if !ok || token != "a.b.c" {
		t.Fatalf("got %q,%v", token, ok)
	}
	if _, ok := ExtractWSBearerToken([]string{"other", "byspace.bearer"}); ok {
		t.Fatal("a two-segment protocol is not a token")
	}
}

// Health and the two self-authenticating routes must stay reachable before a client has a
// password, or the app could never discover the daemon it needs to authenticate against.
//
// /health belongs here next to /api/health for the same reason: `byspace daemon start` and the
// container health check probe it before they have a token. Leaving it out made a daemon with a
// password configured look like one that never came up.
func TestShouldBypassBearerAuth(t *testing.T) {
	bypass := []struct{ method, path string }{
		{"OPTIONS", "/ws"},
		{"GET", "/health"},
		{"GET", "/api/health"},
		{"GET", "/api/files/download"},
		{"POST", "/mcp/agents"},
	}
	for _, c := range bypass {
		if !ShouldBypassBearerAuth(c.method, c.path) {
			t.Fatalf("%s %s must bypass auth", c.method, c.path)
		}
	}
	if ShouldBypassBearerAuth("GET", "/ws") || ShouldBypassBearerAuth("POST", "/api/terminal-activity") {
		t.Fatal("those routes require auth")
	}
}

// A daemon with a password must still answer /health without one.
//
// The list above is easy to satisfy while the middleware still rejects the request — the bug this
// guards was exactly that shape: the bypass list was right about /api/health and wrong about
// /health, and the readiness probe that `daemon start` uses asks /health. So drive the real
// handler rather than the predicate.
func TestHealthStaysReachableWithAPasswordConfigured(t *testing.T) {
	srv, err := New(Options{HomeDir: filepath.Join(t.TempDir(), "home"), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	hash, err := HashDaemonPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.Store().SetDaemonPasswordHash(hash); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	srv.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("/health = %d with a password configured, want 200 so a readiness probe can answer",
			recorder.Code)
	}

	// Everything else must still be gated, or the exemption has quietly turned into open access.
	denied := httptest.NewRecorder()
	srv.ServeHTTP(denied, httptest.NewRequest(http.MethodGet, "/api/status", nil))
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("/api/status = %d without a token, want 401", denied.Code)
	}
}

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := HashDaemonPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyDaemonPassword(hash, "correct horse battery staple") {
		t.Fatal("correct password rejected")
	}
	if VerifyDaemonPassword(hash, "wrong") {
		t.Fatal("wrong password accepted")
	}
	// An empty hash means auth is off; Verify must say "no", never "yes".
	if VerifyDaemonPassword("", "") {
		t.Fatal("empty hash must not verify")
	}
}

// The MCP endpoint is exempt from the global middleware, so it authorizes itself: a per-run
// capability token, or a valid password bearer.
func TestIsAgentMCPRequestAuthorized(t *testing.T) {
	hash, err := HashDaemonPassword("pw")
	if err != nil {
		t.Fatal(err)
	}
	if !IsAgentMCPRequestAuthorized("", "", "") {
		t.Fatal("no password configured means open")
	}
	if !IsAgentMCPRequestAuthorized(hash, "cap-token", "Bearer cap-token") {
		t.Fatal("the capability token should authorize")
	}
	if !IsAgentMCPRequestAuthorized(hash, "cap-token", "Bearer pw") {
		t.Fatal("the password should also authorize")
	}
	if IsAgentMCPRequestAuthorized(hash, "cap-token", "Bearer nope") {
		t.Fatal("a wrong token must not authorize")
	}
	if IsAgentMCPRequestAuthorized(hash, "cap-token", "") {
		t.Fatal("a missing header must not authorize")
	}
}
