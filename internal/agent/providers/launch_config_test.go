package providers

import (
	"reflect"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestCodexInnerConfigPreservesMCPAndProviderOptions(t *testing.T) {
	got := codexInnerConfig(LaunchConfig{
		ProviderOptions: map[string]any{"sandbox_mode": "workspace-write"},
		MCPServers: map[string]sdk.MCPServerConfig{
			"local": {Type: "stdio", Command: "server", Args: []string{"--flag"}, Env: map[string]string{"TOKEN": "secret"}, AlwaysLoad: true},
			"http":  {Type: "http", URL: "https://mcp.example.test", Headers: map[string]string{"X-Token": "secret"}},
			"sse":   {Type: "sse", URL: "https://mcp.example.test/sse"},
		},
	})
	if got["sandbox_mode"] != "workspace-write" {
		t.Fatalf("provider option lost: %#v", got)
	}
	servers, ok := got["mcp_servers"].(map[string]any)
	if !ok || len(servers) != 3 {
		t.Fatalf("mcp_servers = %#v", got["mcp_servers"])
	}
	local := servers["local"].(map[string]any)
	if local["command"] != "server" || local["type"] != nil || local["alwaysLoad"] != nil {
		t.Fatalf("stdio MCP shape = %#v", local)
	}
	for _, name := range []string{"http", "sse"} {
		remote := servers[name].(map[string]any)
		if remote["url"] == "" || remote["type"] != nil {
			t.Fatalf("remote MCP shape %s = %#v", name, remote)
		}
	}
}

func TestCodexAppServerArgsPreserveConfiguredCommandTail(t *testing.T) {
	got := codexAppServerArgs([]string{"/tmp/fake-codex.mjs", "--flag"})
	want := []string{"/tmp/fake-codex.mjs", "--flag", "app-server"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
}

func TestResolveModelIdentitySplitsOnce(t *testing.T) {
	provider, model, err := ResolveModelIdentity("opencode", "openrouter/anthropic/claude", nil)
	if err != nil || provider != "openrouter" || model != "anthropic/claude" {
		t.Fatalf("identity = %q %q %v", provider, model, err)
	}
	provider, model, err = ResolveModelIdentity("opencode", "model-a", map[string]any{"model_provider": "custom"})
	if err != nil || provider != "custom" || model != "model-a" {
		t.Fatalf("option identity = %q %q %v", provider, model, err)
	}
	if _, _, err := ResolveModelIdentity("opencode", "/missing-provider", nil); err == nil {
		t.Fatal("expected malformed provider/model to fail")
	}
}
