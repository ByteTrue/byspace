package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// ReadSetupCommands extracts the `setup` command list from <cwd>/byspace.json.
// Both `"setup": "npm install"` and `"setup": ["a", "b"]` shapes are accepted, matching the
// service-proxy/workspace-script config forms already used elsewhere in byspace.json.
func ReadSetupCommands(cwd string) []string {
	if strings.TrimSpace(cwd) == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(cwd, "byspace.json"))
	if err != nil {
		return nil
	}
	var cfg struct {
		Setup json.RawMessage `json:"setup"`
	}
	if json.Unmarshal(raw, &cfg) != nil || len(cfg.Setup) == 0 {
		return nil
	}
	var single string
	if json.Unmarshal(cfg.Setup, &single) == nil {
		if strings.TrimSpace(single) == "" {
			return nil
		}
		return []string{single}
	}
	var many []string
	if json.Unmarshal(cfg.Setup, &many) == nil {
		out := make([]string, 0, len(many))
		for _, cmd := range many {
			if strings.TrimSpace(cmd) != "" {
				out = append(out, cmd)
			}
		}
		return out
	}
	return nil
}

// ScriptConfig is one entry from byspace.json's `scripts` map.
//
// Two forms exist: a bare command (`"dev": "vite"`) which runs and is watched, and an object
// with `"type": "service"` plus a `port`, which additionally gets a proxy route and a health
// check. Only the command and port matter here; the proxy lives in the service-proxy subsystem.
type ScriptConfig struct {
	Command string
	Type    string // "" (plain script) or "service"
	Port    int    // requested port for a service script; 0 means "allocate"
	// PortRange constrains allocation to a window ("3000-3010"); a firewall or container
	// port map makes an arbitrary port useless.
	PortRange string
	// PortScript is a command that prints the port to use, for projects where an external
	// service already advertises one.
	PortScript string
}

// IsService reports whether this entry asks for a proxied, health-checked service.
func (c ScriptConfig) IsService() bool { return c.Type == "service" }

// ReadScriptConfigs extracts the `scripts` map with its service metadata.
func ReadScriptConfigs(cwd string) map[string]ScriptConfig {
	if strings.TrimSpace(cwd) == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(cwd, "byspace.json"))
	if err != nil {
		return nil
	}
	var cfg struct {
		Scripts map[string]json.RawMessage `json:"scripts"`
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return nil
	}
	out := make(map[string]ScriptConfig, len(cfg.Scripts))
	for name, value := range cfg.Scripts {
		var command string
		if json.Unmarshal(value, &command) == nil && strings.TrimSpace(command) != "" {
			out[name] = ScriptConfig{Command: command}
			continue
		}
		var obj struct {
			Command    string `json:"command"`
			Type       string `json:"type"`
			Port       int    `json:"port"`
			PortRange  string `json:"portRange"`
			PortScript string `json:"portScript"`
		}
		if json.Unmarshal(value, &obj) == nil && strings.TrimSpace(obj.Command) != "" {
			out[name] = ScriptConfig{
				Command:    obj.Command,
				Type:       obj.Type,
				Port:       obj.Port,
				PortRange:  obj.PortRange,
				PortScript: obj.PortScript,
			}
		}
	}
	return out
}

// ReadScripts extracts just the commands from <cwd>/byspace.json.
//
// Shape follows the workspace-script config already used by the service proxy:
// `"scripts": {"dev": "vite", "test": "vitest run"}`.
func ReadScripts(cwd string) map[string]string {
	if strings.TrimSpace(cwd) == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(cwd, "byspace.json"))
	if err != nil {
		return nil
	}
	var cfg struct {
		Scripts map[string]json.RawMessage `json:"scripts"`
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return nil
	}
	out := make(map[string]string, len(cfg.Scripts))
	for name, value := range cfg.Scripts {
		var command string
		if json.Unmarshal(value, &command) == nil && strings.TrimSpace(command) != "" {
			out[name] = command
			continue
		}
		// `"scripts": {"dev": {"command": "vite"}}`
		var obj struct {
			Command string `json:"command"`
		}
		if json.Unmarshal(value, &obj) == nil && strings.TrimSpace(obj.Command) != "" {
			out[name] = obj.Command
		}
	}
	return out
}
