package pi

import (
	"os"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestExtensionRegistersUserMCPServers(t *testing.T) {
	path, cleanup, err := WriteIntegrationExtension(ExtensionOptions{MCPServers: map[string]sdk.MCPServerConfig{
		"local":  {Type: "stdio", Command: "server", Args: []string{"--flag"}, Env: map[string]string{"TOKEN": "secret"}},
		"remote": {Type: "http", URL: "https://example.test/mcp", Headers: map[string]string{"X-Token": "secret"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	body, _ := os.ReadFile(path)
	source := string(body)
	for _, want := range []string{"pi.registerMcpServer", `"command":"server"`, `"url":"https://example.test/mcp"`, `"TOKEN":"secret"`} {
		if !strings.Contains(source, want) {
			t.Fatalf("extension is missing %q", want)
		}
	}
	if _, _, err := WriteIntegrationExtension(ExtensionOptions{MCPServers: map[string]sdk.MCPServerConfig{
		"bad name": {Type: "stdio", Command: "server"},
	}}); err == nil {
		t.Fatal("invalid MCP server name was accepted")
	}
	if _, _, err := WriteIntegrationExtension(ExtensionOptions{MCPServers: map[string]sdk.MCPServerConfig{
		"events": {Type: "sse", URL: "https://example.test/sse"},
	}}); err == nil {
		t.Fatal("SSE was accepted by pi built-in MCP")
	}
}
