package providers

import (
	"encoding/json"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestClaudeLaunchForwardsMCPAndSystemPrompt(t *testing.T) {
	args := claudeLaunchArgs(LaunchConfig{
		SystemPrompt: "BySpace instructions",
		MCPServers: map[string]sdk.MCPServerConfig{
			"stdio": {Type: "stdio", Command: "server", Args: []string{"--flag"}, Env: map[string]string{"TOKEN": "secret"}, AlwaysLoad: true},
			"http":  {Type: "http", URL: "https://example.test/mcp", Headers: map[string]string{"X-Token": "secret"}},
			"sse":   {Type: "sse", URL: "https://example.test/sse"},
		},
	})
	var rawConfig string
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--mcp-config" {
			rawConfig = args[i+1]
		}
		if args[i] == "--append-system-prompt" && args[i+1] != "BySpace instructions" {
			t.Fatalf("system prompt = %q", args[i+1])
		}
	}
	if rawConfig == "" {
		t.Fatalf("launch args have no MCP config: %v", args)
	}
	var payload struct {
		Servers map[string]sdk.MCPServerConfig `json:"mcpServers"`
	}
	if err := json.Unmarshal([]byte(rawConfig), &payload); err != nil {
		t.Fatal(err)
	}
	if got := payload.Servers["stdio"]; got.Command != "server" || !got.AlwaysLoad || got.Env["TOKEN"] != "secret" {
		t.Fatalf("stdio MCP = %#v", got)
	}
	if got := payload.Servers["http"]; got.URL != "https://example.test/mcp" || got.Headers["X-Token"] != "secret" {
		t.Fatalf("http MCP = %#v", got)
	}
	if got := payload.Servers["sse"]; got.Type != "sse" || got.URL != "https://example.test/sse" {
		t.Fatalf("sse MCP = %#v", got)
	}
}
