package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/store"
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
	"/health":             true,
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
	return store.HashDaemonPassword(password)
}

// VerifyDaemonPassword checks a presented password against the stored hash.
//
// bcrypt's own comparison is constant-time; the empty-password case means "no auth configured"
// and is handled by the caller so that a misread config cannot silently open the daemon.
func VerifyDaemonPassword(hash, password string) bool {
	return store.VerifyDaemonPassword(hash, password)
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

// CLICredentialFile holds the token this host's own CLI presents.
//
// The CLI runs on the machine that owns the home, but it reaches the daemon over a websocket like
// any other client, so a daemon with a password refused every command that was not a plain file
// read: `project list`, `schedule list`, `run`, `pair` all 401'd. Reading the password from an
// environment variable was not a workaround someone would find; `BYSPACE_PASSWORD` is not in any
// home, and the value is a bcrypt hash on disk.
//
// A file rather than an environment variable because it has to survive a shell that never set one.
// `0o600` inside the home is the same protection the password hash itself gets: anything that can
// read this can already rewrite config.json.
const CLICredentialFile = "cli-credential"

// LoadCLICredential reads the CLI token for a home, or "" when there is none.
func LoadCLICredential(homeDir string) string {
	raw, err := os.ReadFile(filepath.Join(homeDir, CLICredentialFile))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

// EnsureCLICredential returns the home's CLI token, creating it on first use.
//
// Rotating the password does not invalidate it: this is a separate credential for a different
// principal (the CLI on this host), which is what `docs/permissions.md` asks for — credentials are
// proven per principal and rotated independently.
func EnsureCLICredential(homeDir string) string {
	if existing := LoadCLICredential(homeDir); existing != "" {
		return existing
	}
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	if err := home.WriteAtomic(filepath.Join(homeDir, CLICredentialFile), []byte(token+"\n"), 0o600); err != nil {
		return ""
	}
	return token
}

// daemonPasswordHash returns the configured bcrypt hash, or "" when auth is off.
//
// Read per request rather than cached: changing the password in settings must take effect
// without a restart, and a cache would silently keep accepting the old one.
func (s *Server) daemonPasswordHash() string {
	return s.store.DaemonPasswordHash()
}

// cliCredentialAccepted reports whether a presented token is this host's CLI credential.
func (s *Server) cliCredentialAccepted(homeDir, presented string) bool {
	if presented == "" {
		return false
	}
	expected := LoadCLICredential(homeDir)
	if expected == "" {
		return false
	}
	return ConstantTimeEqual(presented, expected)
}

// authorizedByDaemonCredential checks a bearer against both the password and the CLI credential.
func (s *Server) authorizedByDaemonCredential(homeDir, presented string) bool {
	if s.cliCredentialAccepted(homeDir, presented) {
		return true
	}
	if hash := s.daemonPasswordHash(); hash != "" {
		return VerifyDaemonPassword(hash, presented)
	}
	return false
}
