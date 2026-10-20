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

// ReadScripts extracts the `scripts` map from <cwd>/byspace.json.
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
