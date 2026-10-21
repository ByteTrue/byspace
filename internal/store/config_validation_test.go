package store

import (
	"strings"
	"testing"
)

// The settings page writes this structure wholesale; a malformed entry accepted silently then
// fails at the point of use, where the message says nothing about the settings that caused it.
func TestValidateDaemonConfigAcceptsValid(t *testing.T) {
	valid := []map[string]any{
		{},
		{"autoArchiveAfterMerge": true},
		{"agentProfiles": []any{
			map[string]any{"name": "fast", "provider": "pi", "model": "x"},
			map[string]any{"name": "careful", "provider": "claude"},
		}},
		{"agentProfiles": map[string]any{"fast": map[string]any{"provider": "pi"}}},
		{"providers": map[string]any{
			"zai":    map[string]any{"command": "/usr/local/bin/zai"},
			"cursor": map[string]any{"extends": "acp"},
			"custom": map[string]any{"baseUrl": "https://api.example"},
		}},
		{"network": map[string]any{"tcpPort": float64(6778), "allowLanAccess": false}},
		{"relay": map[string]any{"enabled": true, "endpoint": "relay.example.com:443"}},
		// Unknown keys are allowed: a newer client may send fields this build does not know, and
		// rejecting them would refuse a config the UI itself produced.
		{"somethingFromTheFuture": map[string]any{"x": 1}},
	}
	for i, cfg := range valid {
		if err := ValidateDaemonConfig(cfg); err != nil {
			t.Fatalf("case %d should be valid: %v", i, err)
		}
	}
}

func TestValidateDaemonConfigRejectsBadShapes(t *testing.T) {
	invalid := []map[string]any{
		{"autoArchiveAfterMerge": "yes"},
		{"agentProfiles": "nope"},
		{"agentProfiles": []any{map[string]any{"provider": "pi"}}},                         // no name
		{"agentProfiles": []any{map[string]any{"name": ""}}},                               // empty name
		{"agentProfiles": []any{map[string]any{"name": "a"}, map[string]any{"name": "a"}}}, // duplicate
		{"agentProfiles": []any{map[string]any{"name": "a", "provider": ""}}},              // empty provider
		{"providers": "nope"},
		{"providers": map[string]any{"x": "nope"}},
		{"providers": map[string]any{"x": map[string]any{}}}, // no way to launch
		{"network": map[string]any{"tcpPort": float64(0)}},
		{"network": map[string]any{"tcpPort": float64(70000)}},
		{"network": map[string]any{"allowLanAccess": "yes"}},
		{"relay": map[string]any{"enabled": "yes"}},
		{"relay": map[string]any{"endpoint": "no-port"}},
	}
	for i, cfg := range invalid {
		if err := ValidateDaemonConfig(cfg); err == nil {
			t.Fatalf("case %d should have been rejected: %#v", i, cfg)
		}
	}
}

// A duplicate profile id silently shadows the earlier one: the user edits one and watches the
// other take effect.
func TestValidateDaemonConfigNamesTheDuplicate(t *testing.T) {
	err := ValidateDaemonConfig(map[string]any{
		"agentProfiles": []any{
			map[string]any{"name": "fast"}, map[string]any{"name": "fast"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "fast") {
		t.Fatalf("message should name the duplicate: %v", err)
	}
}

// The relay client needs host and port; a bare host silently connects to nothing.
func TestValidateDaemonConfigRelayEndpointNeedsPort(t *testing.T) {
	err := ValidateDaemonConfig(map[string]any{"relay": map[string]any{"endpoint": "relay.example.com"}})
	if err == nil || !strings.Contains(err.Error(), "host:port") {
		t.Fatalf("message should say what is expected: %v", err)
	}
}
