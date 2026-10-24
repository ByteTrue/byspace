package providers

import "strings"

// McpToolRef names one BySpace tool a user pre-approved.
type McpToolRef struct {
	Server string `json:"server"`
	Tool   string `json:"tool"`
}

// ApplyCodexToolPolicy injects pre-approved tools into a Codex `mcp_servers` config.
//
// Ported from codex/options.ts. Codex does not inherit a tool allow-list from BySpace: each MCP server
// declares its own. Without this, a user who pre-approved `create_agent` still gets a permission prompt
// for it in Codex, and every BySpace tool is unavailable until they click through — which for a
// sub-agent with no one watching means the tool call simply hangs.
//
// The approval mode is set to `prompt` rather than `never`: a pre-approved tool needs no prompt, but a
// tool the user did not pre-approve must still ask. `never` would grant everything.
func ApplyCodexToolPolicy(config map[string]any, preapproved []McpToolRef) map[string]any {
	if len(preapproved) == 0 {
		return config
	}

	servers := readAnyRecord(config["mcp_servers"])
	grantsByServer := make(map[string][]string, len(preapproved))
	for _, grant := range preapproved {
		server := strings.TrimSpace(grant.Server)
		tool := strings.TrimSpace(grant.Tool)
		if server == "" || tool == "" {
			continue
		}
		grantsByServer[server] = append(grantsByServer[server], tool)
	}
	if len(grantsByServer) == 0 {
		// Nothing to grant, so nothing to rewrite — including the empty-map case, where writing
		// `mcp_servers: {}` would replace a valid absence with an empty object Codex may reject.
		return config
	}

	for server, tools := range grantsByServer {
		serverConfig := readAnyRecord(servers[server])
		approvals := make(map[string]any, len(tools))
		for _, tool := range tools {
			approvals[tool] = "approved"
		}
		// The generated keys come last so they win over anything the caller set, while the caller's
		// own transport settings (command, args) survive.
		patched := make(map[string]any, len(serverConfig)+3)
		for key, value := range serverConfig {
			patched[key] = value
		}
		patched["enabled_tools"] = tools
		patched["default_tools_approval_mode"] = "prompt"
		patched["tools"] = approvals
		servers[server] = patched
	}

	// A new map rather than writing into the caller's: `providerOptions` can be shared between a stored
	// agent and a launch, and mutating it would leave Codex's MCP shape in the saved config.
	out := make(map[string]any, len(config)+1)
	for key, value := range config {
		out[key] = value
	}
	out["mcp_servers"] = servers
	return out
}

// readAnyRecord returns a shallow copy of a JSON object, or an empty map.
//
// A copy rather than the original: the caller's config may be shared with another provider's launch, and
// writing through it would leak Codex's MCP shape into a config that is not Codex's.
func readAnyRecord(value any) map[string]any {
	record, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	out := make(map[string]any, len(record))
	for key, entry := range record {
		// One level of copying for nested objects: `mcp_servers` maps server name to a server config,
		// and a shallow copy would let the generated `enabled_tools` land in the caller's own map.
		if nested, ok := entry.(map[string]any); ok {
			copied := make(map[string]any, len(nested))
			for nestedKey, nestedValue := range nested {
				copied[nestedKey] = nestedValue
			}
			out[key] = copied
			continue
		}
		out[key] = entry
	}
	return out
}
