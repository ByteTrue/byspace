package cli

import (
	"strings"
	"testing"
)

// The scheme implies useTls and the scheme has to be read before the port is defaulted, so a
// wss:// URL without a port is TLS on 443 while an http:// one is plain on 80.
func TestParseRelayEndpoint(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantTLS bool
	}{
		{"relay.example.com", "relay.example.com:443", true},
		{"relay.example.com:8080", "relay.example.com:8080", false},
		{"wss://relay.example.com", "relay.example.com:443", true},
		{"ws://relay.example.com", "relay.example.com:80", false},
		{"https://relay.example.com", "relay.example.com:443", true},
		{"http://relay.example.com", "relay.example.com:80", false},
		{"wss://relay.example.com/", "relay.example.com:443", true},
		{"[::1]:8080", "[::1]:8080", false},
		{"ws://[::1]:9000", "[::1]:9000", false},
		{"localhost:443", "localhost:443", true},
	}
	for _, tc := range cases {
		got, err := parseRelayEndpoint(tc.in)
		if err != nil {
			t.Fatalf("%q: %v", tc.in, err)
		}
		if got.endpoint != tc.want || got.useTLS != tc.wantTLS {
			t.Fatalf("%q → %+v, want %s tls=%v", tc.in, got, tc.want, tc.wantTLS)
		}
	}
}

// A bare IPv6 address is ambiguous with host:port, so it is rejected with the fix in the message.
func TestParseRelayEndpointRejectsBadValues(t *testing.T) {
	for _, bad := range []string{
		"", "   ", "host:0", "host:70000", "host:abc", "::1", "http://", "[::1",
	} {
		if _, err := parseRelayEndpoint(bad); err == nil {
			t.Fatalf("%q should have been rejected", bad)
		}
	}
}

// Contradictory flags are rejected rather than resolved by precedence: silently picking one
// leaves the user with a config they did not ask for.
func TestOnboardRejectsContradictions(t *testing.T) {
	if err := runOnboard([]string{"--listen", "127.0.0.1:1", "--port", "2"}, &discardWriter{}); err == nil {
		t.Fatal("--listen with --port must be rejected")
	}
	if err := runOnboard([]string{"--no-relay", "--relay-endpoint", "x:1"}, &discardWriter{}); err == nil {
		t.Fatal("--no-relay with --relay-endpoint must be rejected")
	}
}

// The hook shim must be silent when it is not running inside a BySpace terminal: it fires on
// every prompt in the user's own shell otherwise.
func TestRunHooksSilentOutsideBySpaceTerminal(t *testing.T) {
	t.Setenv("BYSPACE_TERMINAL_ID", "")
	t.Setenv("BYSPACE_ACTIVITY_TOKEN", "")
	t.Setenv("BYSPACE_TERMINAL_ACTIVITY_URL", "")
	w := &discardWriter{}
	if err := runHooks([]string{"pi", "agent_start"}, w); err != nil {
		t.Fatalf("must not error: %v", err)
	}
	if len(w.written) != 0 {
		t.Fatalf("must not print: %q", w.written)
	}
}

// An unknown event is ignored rather than reported as running, which would leave the indicator
// stuck on for a provider whose events we do not understand.
func TestHookEventStatesCoverKnownProviders(t *testing.T) {
	for _, provider := range []string{"pi", "claude", "codex", "opencode"} {
		states, ok := hookEventStates[provider]
		if !ok || len(states) == 0 {
			t.Fatalf("%s has no event mapping", provider)
		}
		for event, state := range states {
			switch state {
			case "running", "idle", "needs-input":
			default:
				t.Fatalf("%s/%s → %q, not an activity state", provider, event, state)
			}
		}
	}
}

type discardWriter struct{ written []byte }

func (w *discardWriter) Write(p []byte) (int, error) {
	w.written = append(w.written, p...)
	return len(p), nil
}

// Registering two flags on one *bool makes the second registration overwrite the first's
// default, which silently turned MCP injection off.
func TestOnboardMCPDefaultsOn(t *testing.T) {
	dir := t.TempDir()
	w := &discardWriter{}
	if err := runOnboard([]string{"--home", dir}, w); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(w.written), "enabled=true injectIntoAgents=true") {
		t.Fatalf("MCP injection should default on:\n%s", w.written)
	}

	if err := runOnboard([]string{"--home", dir, "--no-mcp"}, w); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(w.written), "enabled=false") {
		t.Fatalf("--no-mcp should disable it:\n%s", w.written)
	}
}
