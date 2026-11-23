package server

import (
	"reflect"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/store"
)

func TestAgentLaunchPreservesConfiguredMCPServers(t *testing.T) {
	servers := map[string]sdk.MCPServerConfig{
		"local": {
			Type: "stdio", Command: "mcp-server", Args: []string{"--cwd", "."},
			Env: map[string]string{"TOKEN": "secret"}, AlwaysLoad: true,
		},
		"remote": {
			Type: "http", URL: "https://mcp.example.test", Headers: map[string]string{"Authorization": "Bearer token"},
		},
	}
	rec := store.AgentRecord{Config: &store.AgentConfig{MCPServers: servers}}
	if got := mcpServersOf(rec); !reflect.DeepEqual(got, servers) {
		t.Fatalf("launch MCP servers = %#v, want %#v", got, servers)
	}
	if got := mcpServersOf(store.AgentRecord{}); got != nil {
		t.Fatalf("empty launch MCP servers = %#v, want nil", got)
	}
}
