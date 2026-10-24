package providers

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// Codex does not inherit a tool allow-list from BySpace: each MCP server declares its own. Without this
// a pre-approved tool still prompts, and a sub-agent with nobody watching hangs on that prompt.
func TestApplyCodexToolPolicy(t *testing.T) {
	config := map[string]any{
		"mcp_servers": map[string]any{
			"byspace": map[string]any{"command": "/usr/local/bin/byspace", "args": []any{"mcp-bridge"}},
		},
	}
	out := ApplyCodexToolPolicy(config, []McpToolRef{
		{Server: "byspace", Tool: "create_agent"},
		{Server: "byspace", Tool: "send_agent_message"},
	})

	servers, ok := out["mcp_servers"].(map[string]any)
	if !ok {
		t.Fatalf("mcp_servers = %T", out["mcp_servers"])
	}
	server, ok := servers["byspace"].(map[string]any)
	if !ok {
		t.Fatalf("byspace server = %T", servers["byspace"])
	}

	tools, _ := server["enabled_tools"].([]string)
	if len(tools) != 2 {
		t.Fatalf("enabled_tools = %v", server["enabled_tools"])
	}
	// `prompt`, not `never`: a pre-approved tool needs no prompt, but everything else still must ask.
	if server["default_tools_approval_mode"] != "prompt" {
		t.Fatalf("approval mode = %v", server["default_tools_approval_mode"])
	}
	approvals, _ := server["tools"].(map[string]any)
	if approvals["create_agent"] != "approved" {
		t.Fatalf("approvals = %v", approvals)
	}
	// The caller's own transport settings survive: without the command the server cannot start.
	if server["command"] != "/usr/local/bin/byspace" {
		t.Fatalf("command was lost: %v", server["command"])
	}
}

// No pre-approvals means no change at all.
func TestApplyCodexToolPolicyNoGrants(t *testing.T) {
	config := map[string]any{"mcp_servers": map[string]any{"a": map[string]any{"command": "x"}}}
	out := ApplyCodexToolPolicy(config, nil)
	servers := out["mcp_servers"].(map[string]any)
	server := servers["a"].(map[string]any)
	if _, has := server["enabled_tools"]; has {
		t.Fatal("a config with no grants was rewritten")
	}
}

// A grant naming no server or no tool is ignored rather than creating an empty server entry.
func TestApplyCodexToolPolicyIgnoresEmptyGrants(t *testing.T) {
	config := map[string]any{}
	out := ApplyCodexToolPolicy(config, []McpToolRef{{Server: "", Tool: "x"}, {Server: "s", Tool: "  "}})
	// The key stays absent: writing `mcp_servers: {}` would replace a valid absence with an empty
	// object the provider may reject.
	if _, has := out["mcp_servers"]; has {
		t.Fatalf("mcp_servers was written: %v", out["mcp_servers"])
	}
}

// The copy keeps Codex's MCP shape out of a config shared with another provider's launch.
func TestApplyCodexToolPolicyDoesNotMutateInput(t *testing.T) {
	original := map[string]any{"mcp_servers": map[string]any{"s": map[string]any{"command": "x"}}}
	ApplyCodexToolPolicy(original, []McpToolRef{{Server: "s", Tool: "t"}})
	server := original["mcp_servers"].(map[string]any)["s"].(map[string]any)
	if _, has := server["enabled_tools"]; has {
		t.Fatal("the caller's config was mutated")
	}
}

// Without the inner config the user's sandbox_mode never reached the process and the BySpace MCP bridge
// was never registered, so the orchestration tools did not exist for a Codex agent.
func TestCodexInnerConfig(t *testing.T) {
	cfg := LaunchConfig{
		ProviderOptions: map[string]any{"sandbox_mode": "workspace-write"},
		MCPServers: []pi.MCPConfig{
			{Name: "byspace", Command: "/bin/byspace", Args: []string{"mcp-bridge"}},
			{Name: "remote", URL: "https://example.test/mcp"},
		},
		PreapprovedTools: []McpToolRef{{Server: "byspace", Tool: "create_agent"}},
	}
	inner := codexInnerConfig(cfg)

	if inner["sandbox_mode"] != "workspace-write" {
		t.Fatalf("provider option lost: %v", inner["sandbox_mode"])
	}
	servers, ok := inner["mcp_servers"].(map[string]any)
	if !ok {
		t.Fatalf("mcp_servers = %T", inner["mcp_servers"])
	}
	local, _ := servers["byspace"].(map[string]any)
	if local["command"] != "/bin/byspace" {
		t.Fatalf("local server = %v", local)
	}
	// Codex distinguishes stdio from remote; sending both keys makes it pick the command.
	if _, has := local["url"]; has {
		t.Fatalf("a stdio server carried a url: %v", local)
	}
	remote, _ := servers["remote"].(map[string]any)
	if remote["url"] != "https://example.test/mcp" {
		t.Fatalf("remote server = %v", remote)
	}
	// The grant is annotated onto the server it names.
	if local["default_tools_approval_mode"] != "prompt" {
		t.Fatalf("approval mode = %v", local["default_tools_approval_mode"])
	}
}
