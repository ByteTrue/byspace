package store

import (
	"fmt"
	"strings"
)

// Daemon config validation, following daemon-config-store.ts.
//
// The settings page writes this structure wholesale, so a malformed entry is accepted silently and
// then fails at the point of use — an agent profile with no provider, a provider with no binary —
// where the error says nothing about the settings that caused it. Validating on write is what puts
// the message next to the edit.
//
// Unknown keys are allowed on purpose: this build does not know every field a newer client may
// send, and rejecting them would make the daemon refuse a config the UI itself produced.

// ValidateDaemonConfig checks the parts the daemon acts on.
func ValidateDaemonConfig(patch map[string]any) error {
	if patch == nil {
		return nil
	}

	if raw, ok := patch["agentProfiles"]; ok && raw != nil {
		if err := validateAgentProfiles(raw); err != nil {
			return err
		}
	}
	if raw, ok := patch["providers"]; ok && raw != nil {
		if err := validateProviders(raw); err != nil {
			return err
		}
	}
	if raw, ok := patch["autoArchiveAfterMerge"]; ok && raw != nil {
		if _, isBool := raw.(bool); !isBool {
			return fmt.Errorf("autoArchiveAfterMerge: must be a boolean")
		}
	}
	if raw, ok := patch["network"]; ok && raw != nil {
		if err := validateNetwork(raw); err != nil {
			return err
		}
	}
	if raw, ok := patch["relay"]; ok && raw != nil {
		if err := validateRelay(raw); err != nil {
			return err
		}
	}
	return nil
}

// validateAgentProfiles checks each profile has the fields that select a provider.
func validateAgentProfiles(raw any) error {
	profiles, isList := raw.([]any)
	if !isList {
		// The settings page also sends a keyed object; accept either.
		keyed, isObject := raw.(map[string]any)
		if !isObject {
			return fmt.Errorf("agentProfiles: must be a list or an object")
		}
		for name := range keyed {
			if strings.TrimSpace(name) == "" {
				return fmt.Errorf("agentProfiles: profile name cannot be empty")
			}
		}
		return nil
	}

	seen := make(map[string]bool, len(profiles))
	for index, entry := range profiles {
		profile, isObject := entry.(map[string]any)
		if !isObject {
			return fmt.Errorf("agentProfiles[%d]: must be an object", index)
		}
		name, _ := profile["name"].(string)
		if strings.TrimSpace(name) == "" {
			return fmt.Errorf("agentProfiles[%d]: name is required", index)
		}
		if seen[name] {
			// A duplicate id silently shadows the earlier profile, and the user edits one and
			// watches the other take effect.
			return fmt.Errorf("agentProfiles: duplicate profile name %q", name)
		}
		seen[name] = true
		if provider, ok := profile["provider"]; ok {
			providerName, isString := provider.(string)
			if !isString || strings.TrimSpace(providerName) == "" {
				return fmt.Errorf("agentProfiles[%d] (%s): provider must be a non-empty string", index, name)
			}
		}
	}
	return nil
}

// validateProviders checks each custom provider names a way to start it.
func validateProviders(raw any) error {
	providers, isObject := raw.(map[string]any)
	if !isObject {
		return fmt.Errorf("providers: must be an object keyed by provider id")
	}
	for id, entry := range providers {
		config, isObject := entry.(map[string]any)
		if !isObject {
			return fmt.Errorf("providers.%s: must be an object", id)
		}
		// A provider with neither a binary nor a base ACP agent cannot be launched; catching it
		// here means the providers page says so instead of the agent failing to start.
		// `command` is an argv list on the wire (`z.array(z.string().min(1)).min(1)`), so reading it
		// as a plain string rejected every edit that only set a command — the app sent
		// `command: ["node", "./agent.mjs"]` and the daemon answered "needs one of command,
		// extends or baseUrl". A bare string is still accepted for configs written by hand.
		command := commandValue(config["command"])
		extends, _ := config["extends"].(string)
		baseURL, _ := config["baseUrl"].(string)
		if command == "" && strings.TrimSpace(extends) == "" && strings.TrimSpace(baseURL) == "" {
			return fmt.Errorf("providers.%s: needs one of command, extends or baseUrl", id)
		}
	}
	return nil
}

// commandValue extracts the executable from a provider `command` field, which the wire schema
// declares as a non-empty argv list but which hand-written configs may still express as a string.
func commandValue(raw any) string {
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value)
	case []any:
		if len(value) == 0 {
			return ""
		}
		first, _ := value[0].(string)
		return strings.TrimSpace(first)
	case []string:
		if len(value) == 0 {
			return ""
		}
		return strings.TrimSpace(value[0])
	}
	return ""
}

func validateNetwork(raw any) error {
	network, isObject := raw.(map[string]any)
	if !isObject {
		return fmt.Errorf("network: must be an object")
	}
	if value, ok := network["tcpPort"]; ok && value != nil {
		port, isNumber := toFloatValue(value)
		if !isNumber || port < 1 || port > 65535 {
			return fmt.Errorf("network.tcpPort: must be a port number")
		}
	}
	if value, ok := network["allowLanAccess"]; ok && value != nil {
		if _, isBool := value.(bool); !isBool {
			return fmt.Errorf("network.allowLanAccess: must be a boolean")
		}
	}
	return nil
}

func validateRelay(raw any) error {
	relay, isObject := raw.(map[string]any)
	if !isObject {
		return fmt.Errorf("relay: must be an object")
	}
	if value, ok := relay["enabled"]; ok && value != nil {
		if _, isBool := value.(bool); !isBool {
			return fmt.Errorf("relay.enabled: must be a boolean")
		}
	}
	if value, ok := relay["endpoint"]; ok && value != nil {
		endpoint, isString := value.(string)
		if !isString {
			return fmt.Errorf("relay.endpoint: must be a string")
		}
		trimmed := strings.TrimSpace(endpoint)
		if trimmed != "" && !strings.Contains(trimmed, ":") {
			// The relay client needs host and port; a bare host silently connects to nothing.
			return fmt.Errorf("relay.endpoint: expected host:port, got %q", endpoint)
		}
	}
	return nil
}

func toFloatValue(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	default:
		return 0, false
	}
}
