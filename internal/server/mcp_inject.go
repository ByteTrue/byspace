package server

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/store"
)

// builtinMCPServerName is the name the app and the MCP bridge agree on.
const builtinMCPServerName = "byspace"

// piMCPServersFor builds the MCP servers one agent should see.
//
// pi has no launch flag for MCP: servers arrive through the generated extension's
// `pi.registerMcpServer` calls. Without this injection the agent had no orchestration tools at
// all — `byspace mcp-bridge`, the `/mcp/agents` endpoint and the 37 tools behind them existed
// and nothing ever connected them.
//
// Order matters: the built-in bridge is added first so a user config of the same name cannot
// shadow it, and the user's own servers follow.
func (s *Server) piMCPServersFor(rec store.AgentRecord) []pi.MCPConfig {
	cfg := s.store.LoadDaemonConfig()
	if cfg != nil {
		if mcp, ok := cfg["mcp"].(map[string]any); ok {
			if enabled, ok := mcp["enabled"].(bool); ok && !enabled {
				return s.userMCPServers(rec)
			}
			if inject, ok := mcp["injectIntoAgents"].(bool); ok && !inject {
				return s.userMCPServers(rec)
			}
		}
	}

	out := make([]pi.MCPConfig, 0, 2)
	if bridge, ok := s.builtinMCPBridge(); ok {
		out = append(out, bridge)
	}
	return append(out, s.userMCPServers(rec)...)
}

// builtinMCPBridge describes how to launch our own stdio bridge.
//
// Self-bootstrapping: the daemon re-executes its own binary rather than shelling out to a
// script, so the bridge is the same build as the daemon and cannot drift from it.
func (s *Server) builtinMCPBridge() (pi.MCPConfig, bool) {
	exe, err := os.Executable()
	if err != nil {
		return pi.MCPConfig{}, false
	}
	if resolved, resolveErr := filepath.EvalSymlinks(exe); resolveErr == nil {
		exe = resolved
	}
	args := []string{"mcp-bridge", "--addr", s.listenAddr}
	if token := s.capabilityTokenValue(); token != "" {
		args = append(args, "--token", token)
	}
	return pi.MCPConfig{
		Name:    builtinMCPServerName,
		Command: exe,
		Args:    args,
	}, true
}

// userMCPServers reads the agent's configured servers out of its provider options.
func (s *Server) userMCPServers(rec store.AgentRecord) []pi.MCPConfig {
	if rec.Config == nil || rec.Config.ProviderOptions == nil {
		return nil
	}
	raw, ok := rec.Config.ProviderOptions["mcpServers"]
	if !ok {
		return nil
	}
	asMap, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	out := make([]pi.MCPConfig, 0, len(asMap))
	for name, value := range asMap {
		entry, ok := value.(map[string]any)
		if !ok || name == builtinMCPServerName {
			// A user config reusing our name would register twice and throw.
			continue
		}
		cfg := pi.MCPConfig{Name: name}
		if cmd, ok := entry["command"].(string); ok {
			cfg.Command = cmd
		}
		if url, ok := entry["url"].(string); ok {
			cfg.URL = url
		}
		if args, ok := entry["args"].([]any); ok {
			for _, a := range args {
				if str, ok := a.(string); ok {
					cfg.Args = append(cfg.Args, str)
				}
			}
		}
		if env, ok := entry["env"].(map[string]any); ok {
			cfg.Env = make(map[string]string, len(env))
			for k, v := range env {
				if str, ok := v.(string); ok {
					cfg.Env[k] = str
				}
			}
		}
		out = append(out, cfg)
	}
	return out
}

// systemPromptFor composes the daemon-side prompt appended to the provider's own.
func (s *Server) systemPromptFor(rec store.AgentRecord) string {
	var parts []string
	if rec.Config != nil && rec.Config.SystemPrompt != nil && *rec.Config.SystemPrompt != "" {
		parts = append(parts, *rec.Config.SystemPrompt)
	}
	if cfg := s.store.LoadDaemonConfig(); cfg != nil {
		if appendPrompt, ok := cfg["appendSystemPrompt"].(string); ok && strings.TrimSpace(appendPrompt) != "" {
			parts = append(parts, appendPrompt)
		}
	}
	return strings.Join(parts, "\n\n")
}

// capabilityTokenValue returns the per-run token an agent's MCP bridge presents.
func (s *Server) capabilityTokenValue() string { return s.capabilityToken }
