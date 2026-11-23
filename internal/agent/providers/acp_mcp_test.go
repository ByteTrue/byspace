package providers

import (
	"reflect"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestNormalizeACPMCPServers(t *testing.T) {
	got, err := normalizeACPMCPServers(map[string]sdk.MCPServerConfig{
		"stdio": {Type: "stdio", Command: "server", Args: []string{"--flag"}, Env: map[string]string{"Z": "last", "A": "first"}},
		"http":  {Type: "http", URL: "https://example.test/mcp", Headers: map[string]string{"Authorization": "Bearer token"}, AlwaysLoad: true},
		"sse":   {Type: "sse", URL: "https://example.test/sse"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []any{
		map[string]any{"type": "http", "name": "http", "url": "https://example.test/mcp", "headers": []any{map[string]any{"name": "Authorization", "value": "Bearer token"}}},
		map[string]any{"type": "sse", "name": "sse", "url": "https://example.test/sse", "headers": []any{}},
		map[string]any{"name": "stdio", "command": "server", "args": []string{"--flag"}, "env": []any{map[string]any{"name": "A", "value": "first"}, map[string]any{"name": "Z", "value": "last"}}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalized = %#v, want %#v", got, want)
	}
}

func TestNormalizeACPMCPServersEmptyIsArray(t *testing.T) {
	got, err := normalizeACPMCPServers(nil)
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("empty = %#v, %v; want non-nil empty array", got, err)
	}
}

func TestACPResumeMethodPrefersLoad(t *testing.T) {
	method, err := acpResumeMethod(map[string]any{
		"loadSession":         true,
		"sessionCapabilities": map[string]any{"resume": map[string]any{}},
	})
	if err != nil || method != "session/load" {
		t.Fatalf("method = %q, %v", method, err)
	}
	method, err = acpResumeMethod(map[string]any{"sessionCapabilities": map[string]any{"resume": map[string]any{}}})
	if err != nil || method != "session/resume" {
		t.Fatalf("resume method = %q, %v", method, err)
	}
	if _, err = acpResumeMethod(nil); err == nil {
		t.Fatal("expected unsupported resume error")
	}
}
