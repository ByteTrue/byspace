package pi

import (
	"os"
	"strings"
	"testing"
)

// The extension is the only route to pi's entry capture and tree navigation, so rewind and
// message-id mapping depend on this file being written and loadable.
func TestWriteIntegrationExtension(t *testing.T) {
	path, cleanup, err := WriteIntegrationExtension(ExtensionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()

	body, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("extension not written: %v", readErr)
	}
	source := string(body)
	for _, want := range []string{
		"byspace_tree",
		"byspace_capture",
		EntryCaptureMarker,
		CommandResultMarker,
		"navigateTree",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("extension is missing %q", want)
		}
	}

	// cleanup must remove the temp directory so a long-lived daemon does not leak one per agent.
	cleanup()
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("cleanup did not remove %s", path)
	}
}

// BYSPACE_PI_EXTENSION_PATH lets an operator point at a patched bridge; it must win over the
// generated one.
func TestWriteIntegrationExtensionHonoursOverride(t *testing.T) {
	dir := t.TempDir()
	override := dir + "/custom.mjs"
	if err := os.WriteFile(override, []byte("export default () => {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BYSPACE_PI_EXTENSION_PATH", override)

	path, cleanup, err := WriteIntegrationExtension(ExtensionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if path != override {
		t.Fatalf("override ignored: got %q", path)
	}
}

// pi has no launch flag for MCP: servers arrive through this extension's registerMcpServer
// calls. Without the injection the agent never saw the daemon's orchestration tools.
func TestExtensionRegistersMCPServers(t *testing.T) {
	path, cleanup, err := WriteIntegrationExtension(ExtensionOptions{
		MCPServers: []MCPConfig{
			{Name: "byspace", Command: "/usr/local/bin/byspace", Args: []string{"mcp-bridge"}},
			{Name: "remote", URL: "https://mcp.example/mcp", Headers: map[string]string{"X-Key": "v"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()

	body, _ := os.ReadFile(path)
	source := string(body)
	for _, want := range []string{
		`"byspace"`,
		`"mcp-bridge"`,
		`"https://mcp.example/mcp"`,
		`"X-Key"`,
		"registerMcpServer",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("extension is missing %q", want)
		}
	}
	// The placeholder must be substituted, or the extension throws at load time.
	if strings.Contains(source, "__BYSPACE_MCP_SERVERS__") {
		t.Fatal("the MCP placeholder was not replaced")
	}
}

// A stdio server needs a command; a remote one needs a URL. An entry missing both is dropped
// rather than emitted as an invalid config that would make registration throw.
func TestExtensionSkipsIncompleteMCPEntries(t *testing.T) {
	path, cleanup, err := WriteIntegrationExtension(ExtensionOptions{
		MCPServers: []MCPConfig{{Name: "empty"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	body, _ := os.ReadFile(path)
	if strings.Contains(string(body), `"empty"`) {
		t.Fatal("an entry with neither command nor url must be dropped")
	}
}

// The daemon-side prompt is appended to the provider's own, never replacing it.
func TestExtensionAppendsSystemPrompt(t *testing.T) {
	path, cleanup, err := WriteIntegrationExtension(ExtensionOptions{SystemPrompt: "永远使用中文回复"})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	body, _ := os.ReadFile(path)
	source := string(body)
	if !strings.Contains(source, "before_agent_start") {
		t.Fatal("the system prompt must be injected on before_agent_start")
	}
	if !strings.Contains(source, "永远使用中文回复") {
		t.Fatal("the prompt text is missing")
	}
}
