package providers

import (
	"fmt"
	"sort"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// normalizeACPMCPServers converts the shared launch configuration to ACP's array shapes. Map keys
// and environment/header entries are sorted so request fixtures and logs are deterministic.
func normalizeACPMCPServers(servers map[string]sdk.MCPServerConfig) ([]any, error) {
	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]any, 0, len(names))
	for _, name := range names {
		server := servers[name]
		switch server.Type {
		case "", "stdio":
			envNames := make([]string, 0, len(server.Env))
			for key := range server.Env {
				envNames = append(envNames, key)
			}
			sort.Strings(envNames)
			env := make([]any, 0, len(envNames))
			for _, key := range envNames {
				env = append(env, map[string]any{"name": key, "value": server.Env[key]})
			}
			args := server.Args
			if args == nil {
				args = []string{}
			}
			result = append(result, map[string]any{
				"name": name, "command": server.Command, "args": args, "env": env,
			})
		case "http", "sse":
			headerNames := make([]string, 0, len(server.Headers))
			for key := range server.Headers {
				headerNames = append(headerNames, key)
			}
			sort.Strings(headerNames)
			headers := make([]any, 0, len(headerNames))
			for _, key := range headerNames {
				headers = append(headers, map[string]any{"name": key, "value": server.Headers[key]})
			}
			result = append(result, map[string]any{
				"type": server.Type, "name": name, "url": server.URL, "headers": headers,
			})
		default:
			return nil, fmt.Errorf("ACP MCP server %q has unsupported type %q", name, server.Type)
		}
	}
	return result, nil
}
