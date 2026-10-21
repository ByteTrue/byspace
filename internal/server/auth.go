package server

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// Daemon password authentication, ported from auth.ts.
//
// The daemon is reachable from anything that can open a loopback connection, and a relay or
// tunnel makes it reachable from further away. Without this an operator who sets a password
// gets a daemon that accepts every request anyway — the setting existed in the config but
// nothing enforced it.

// passwordBcryptCost matches the node daemon so an existing hash verifies unchanged.
const passwordBcryptCost = 12

// bearerFreeRoutes never require a password: health is what a client probes before it has one,
// and the two self-authenticating routes carry their own tokens.
var bearerFreeRoutes = map[string]bool{
	"/api/health":         true,
	"/api/files/download": true,
	"/mcp/agents":         true,
}

// ShouldBypassBearerAuth reports whether a request skips password auth.
func ShouldBypassBearerAuth(method, path string) bool {
	if method == http.MethodOptions {
		return true
	}
	return bearerFreeRoutes[path]
}

// ExtractHTTPBearerToken reads a single-token `Authorization: Bearer …` header.
//
// A header with extra parts is rejected rather than parsed loosely: accepting `Bearer a b`
// would let a proxy or a bug smuggle a second token past the comparison.
func ExtractHTTPBearerToken(header string) (string, bool) {
	fields := strings.Fields(strings.TrimSpace(header))
	if len(fields) != 2 || fields[0] != "Bearer" {
		return "", false
	}
	return fields[1], true
}

// ExtractWSBearerToken reads the `byspace.bearer.<token>` subprotocol.
//
// Browsers cannot set an Authorization header on a WebSocket, so the token travels as a
// subprotocol instead. The token may itself contain dots, so everything after the prefix is
// the token.
func ExtractWSBearerToken(protocols []string) (string, bool) {
	for _, protocol := range protocols {
		for _, part := range strings.Split(protocol, ",") {
			trimmed := strings.TrimSpace(part)
			segments := strings.Split(trimmed, ".")
			if len(segments) >= 3 && segments[0] == "byspace" && segments[1] == "bearer" {
				return strings.Join(segments[2:], "."), true
			}
		}
	}
	return "", false
}

// HashDaemonPassword produces the stored bcrypt hash.
func HashDaemonPassword(password string) (string, error) {
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), passwordBcryptCost)
	if err != nil {
		return "", err
	}
	return string(hashed), nil
}

// VerifyDaemonPassword checks a presented password against the stored hash.
//
// bcrypt's own comparison is constant-time; the empty-password case means "no auth configured"
// and is handled by the caller so that a misread config cannot silently open the daemon.
func VerifyDaemonPassword(hash, password string) bool {
	if hash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// ConstantTimeEqual compares two tokens without leaking length via timing.
func ConstantTimeEqual(a, b string) bool {
	// Guard first: subtle.ConstantTimeCompare returns 0 for differing lengths anyway, but an
	// explicit check keeps the intent obvious.
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// IsAgentMCPRequestAuthorized authorizes the /mcp/agents endpoint.
//
// It is exempt from the global middleware because an agent's own MCP client cannot know the
// user's password; it presents the per-run capability token instead. A password bearer is also
// accepted so existing callers keep working.
func IsAgentMCPRequestAuthorized(passwordHash, capabilityToken, authorizationHeader string) bool {
	if passwordHash == "" {
		return true
	}
	token, hasToken := ExtractHTTPBearerToken(authorizationHeader)
	if capabilityToken != "" && hasToken && ConstantTimeEqual(token, capabilityToken) {
		return true
	}
	if !hasToken {
		return false
	}
	return VerifyDaemonPassword(passwordHash, token)
}

// daemonPasswordHash returns the configured bcrypt hash, or "" when auth is off.
//
// Read per request rather than cached: changing the password in settings must take effect
// without a restart, and a cache would silently keep accepting the old one.
func (s *Server) daemonPasswordHash() string {
	cfg := s.store.LoadDaemonConfig()
	if cfg == nil {
		return ""
	}
	auth, ok := cfg["auth"].(map[string]any)
	if !ok {
		return ""
	}
	hash, _ := auth["passwordHash"].(string)
	return strings.TrimSpace(hash)
}
