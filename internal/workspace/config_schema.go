package workspace

import (
	"fmt"
	"strings"
)

// ProjectConfigError codes the editor round-trips, mirroring byspace-config-file.ts.
const (
	// ConfigErrInvalidConfig is the protocol's only validation code; the schema carries no
	// message field, so the detail goes to the daemon log rather than the wire.
	ConfigErrInvalidConfig    = "invalid_project_config"
	ConfigErrRevisionConflict = "stale_project_config"
	ConfigErrWriteFailed      = "write_failed"
	ConfigErrProjectNotFound  = "project_not_found"
)

// ValidateProjectConfig checks the shape of a byspace.json before it is written.
//
// The daemon reads this file to run setup commands and scripts, so a wrong shape is not merely
// cosmetic: `"setup": "npm ci"` (a string where an array belongs) makes setup silently do
// nothing, and `"scripts": {"dev": "vite"}` (a string where an object belongs) makes the script
// disappear from the picker. Writing it unchecked moves that failure to the next run, far from
// the edit that caused it.
func ValidateProjectConfig(config map[string]any) error {
	if config == nil {
		return nil
	}

	if raw, ok := config["setup"]; ok {
		switch value := raw.(type) {
		case nil:
		case string:
			// A single command is a common shorthand; the node schema accepts it.
			if strings.TrimSpace(value) == "" {
				return fmt.Errorf("setup: a string value must not be empty")
			}
		case []any:
			for i, item := range value {
				if _, isString := item.(string); !isString {
					return fmt.Errorf("setup[%d]: must be a string", i)
				}
			}
		default:
			return fmt.Errorf("setup: must be a string or an array of strings")
		}
	}

	if raw, ok := config["scripts"]; ok {
		if raw != nil {
			scripts, isObject := raw.(map[string]any)
			if !isObject {
				return fmt.Errorf("scripts: must be an object keyed by script name")
			}
			for name, entry := range scripts {
				if err := validateScriptEntry(name, entry); err != nil {
					return err
				}
			}
		}
	}

	if raw, ok := config["port"]; ok && raw != nil {
		if _, isNumber := toNumber(raw); !isNumber {
			return fmt.Errorf("port: must be a number")
		}
	}
	return nil
}

// validateScriptEntry checks one scripts value: a command string or an options object.
func validateScriptEntry(name string, entry any) error {
	switch value := entry.(type) {
	case string:
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("scripts.%s: command must not be empty", name)
		}
		return nil
	case map[string]any:
		command, hasCommand := value["command"]
		if !hasCommand {
			return fmt.Errorf("scripts.%s: missing command", name)
		}
		if cmd, isString := command.(string); !isString || strings.TrimSpace(cmd) == "" {
			return fmt.Errorf("scripts.%s.command: must be a non-empty string", name)
		}
		if rawType, ok := value["type"]; ok && rawType != nil {
			typeName, isString := rawType.(string)
			if !isString || (typeName != "script" && typeName != "service") {
				return fmt.Errorf("scripts.%s.type: must be \"script\" or \"service\"", name)
			}
		}
		return nil
	default:
		return fmt.Errorf("scripts.%s: must be a command string or an options object", name)
	}
}

func toNumber(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case float32:
		return float64(v), true
	default:
		return 0, false
	}
}
