package server

import "testing"

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
