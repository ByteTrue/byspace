package store

import (
	"fmt"
	"math"
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

var validProfileTiers = map[string]int{
	"fast":     1,
	"standard": 2,
	"strong":   3,
}

var validChiefMissionTiers = map[string]bool{
	"L0": true,
	"L1": true,
	"L2": true,
}

var validChiefLandingModes = map[string]bool{
	"merge_local": true,
	"open_pr":     true,
}

var validChiefLandingStrategies = map[string]bool{
	"squash": true,
	"merge":  true,
	"rebase": true,
}

var chiefRoleKeys = []string{"chief", "author", "verifier", "integrator"}

// ValidateDaemonConfig checks the parts the daemon acts on.
func ValidateDaemonConfig(patch map[string]any) error {
	return ValidateDaemonConfigForProviders(patch, nil)
}

// ValidateDaemonConfigForProviders is ValidateDaemonConfig with the provider ids this daemon serves.
//
// The set has to come from the caller: a development build registers `mock`, and the settings page
// offers a switch for it exactly like the built-ins. Without it that switch was rejected as
// "providers.mock: needs one of command, extends or baseUrl" and the user saw a provider they could
// not turn off.
func ValidateDaemonConfigForProviders(patch map[string]any, served map[string]bool) error {
	return validateDaemonConfigMap(patch, served, false)
}

// ValidateEffectiveDaemonConfig merges patch over existing using daemon config merge semantics
// before running full validation, including cross-field chief.roles profile existence and the hard
// Verifier.tier >= Author.tier invariant.
//
// Validating only the patch misses two bypasses: editing `chief.roles` without resending
// `agentProfiles`, and downgrading an `agentProfiles` entry's `tier` (or removing a profile) without
// resending `chief`.
func ValidateEffectiveDaemonConfig(existing, patch map[string]any, served map[string]bool) error {
	effective := mergeEffectiveDaemonConfig(existing, patch)
	return validateDaemonConfigMap(effective, served, true)
}

func validateDaemonConfigMap(cfg map[string]any, served map[string]bool, requireChiefProfileRefs bool) error {
	if cfg == nil {
		return nil
	}

	var (
		profileTiers map[string]string
		hasProfiles  bool
	)
	if raw, ok := cfg["agentProfiles"]; ok && raw != nil {
		var err error
		profileTiers, err = validateAgentProfiles(raw)
		if err != nil {
			return err
		}
		hasProfiles = true
	}
	if raw, ok := cfg["providers"]; ok && raw != nil {
		if err := validateProviders(raw, served); err != nil {
			return err
		}
	}
	if raw, ok := cfg["autoArchiveAfterMerge"]; ok && raw != nil {
		if _, isBool := raw.(bool); !isBool {
			return fmt.Errorf("autoArchiveAfterMerge: must be a boolean")
		}
	}
	if raw, ok := cfg["network"]; ok && raw != nil {
		if err := validateNetwork(raw); err != nil {
			return err
		}
	}
	if raw, ok := cfg["relay"]; ok && raw != nil {
		if err := validateRelay(raw); err != nil {
			return err
		}
	}
	if raw, ok := cfg["chief"]; ok && raw != nil {
		checkRefs := requireChiefProfileRefs || hasProfiles
		if err := validateChiefConfig(raw, profileTiers, checkRefs); err != nil {
			return err
		}
	}
	return nil
}

func mergeEffectiveDaemonConfig(existing, patch map[string]any) map[string]any {
	base := cloneConfigMap(existing)
	if base == nil {
		base = map[string]any{}
	}
	if patch != nil {
		base = mergeConfigPatch(base, cloneConfigMap(patch))
	}
	return dropRemovedProviders(base)
}

func cloneConfigMap(src map[string]any) map[string]any {
	if src == nil {
		return nil
	}
	out := make(map[string]any, len(src))
	for k, v := range src {
		out[k] = cloneConfigValue(v)
	}
	return out
}

func cloneConfigValue(val any) any {
	switch typed := val.(type) {
	case map[string]any:
		return cloneConfigMap(typed)
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = cloneConfigValue(item)
		}
		return out
	case []string:
		return append([]string(nil), typed...)
	default:
		return val
	}
}

func validateAgentProfiles(raw any) (map[string]string, error) {
	profiles, isList := raw.([]any)
	if !isList {
		// The settings page also sends a keyed object; accept either.
		keyed, isObject := raw.(map[string]any)
		if !isObject {
			return nil, fmt.Errorf("agentProfiles: must be a list or an object")
		}
		tiers := make(map[string]string, len(keyed)*2)
		for name, entry := range keyed {
			trimmedName := strings.TrimSpace(name)
			if trimmedName == "" {
				return nil, fmt.Errorf("agentProfiles: profile name cannot be empty")
			}
			profile, isMap := entry.(map[string]any)
			if !isMap {
				return nil, fmt.Errorf("agentProfiles.%s: must be an object", name)
			}
			tier, err := validateProfileTierField(profile, fmt.Sprintf("agentProfiles.%s", name))
			if err != nil {
				return nil, err
			}
			if idRaw, ok := profile["id"]; ok && idRaw != nil {
				idStr, isString := idRaw.(string)
				if !isString {
					return nil, fmt.Errorf("agentProfiles.%s: id must be a string", name)
				}
				if trimmedID := strings.TrimSpace(idStr); trimmedID != "" {
					tiers[trimmedID] = tier
				}
			}
			if pNameRaw, ok := profile["name"]; ok && pNameRaw != nil {
				pNameStr, isString := pNameRaw.(string)
				if !isString {
					return nil, fmt.Errorf("agentProfiles.%s: name must be a string", name)
				}
				if trimmedPName := strings.TrimSpace(pNameStr); trimmedPName != "" {
					if _, exists := tiers[trimmedPName]; !exists {
						tiers[trimmedPName] = tier
					}
				}
			}
			if _, exists := tiers[trimmedName]; !exists {
				tiers[trimmedName] = tier
			}
		}
		return tiers, nil
	}

	seenNames := make(map[string]bool, len(profiles))
	seenIDs := make(map[string]bool, len(profiles))
	tiers := make(map[string]string, len(profiles)*2)
	for index, entry := range profiles {
		profile, isObject := entry.(map[string]any)
		if !isObject {
			return nil, fmt.Errorf("agentProfiles[%d]: must be an object", index)
		}
		name, _ := profile["name"].(string)
		if strings.TrimSpace(name) == "" {
			return nil, fmt.Errorf("agentProfiles[%d]: name is required", index)
		}
		if seenNames[name] {
			// A duplicate id silently shadows the earlier profile, and the user edits one and
			// watches the other take effect.
			return nil, fmt.Errorf("agentProfiles: duplicate profile name %q", name)
		}
		seenNames[name] = true

		var trimmedID string
		if idRaw, ok := profile["id"]; ok && idRaw != nil {
			idStr, isString := idRaw.(string)
			if !isString {
				return nil, fmt.Errorf("agentProfiles[%d] (%s): id must be a string", index, name)
			}
			trimmedID = strings.TrimSpace(idStr)
			if trimmedID != "" {
				if seenIDs[trimmedID] {
					return nil, fmt.Errorf("agentProfiles: duplicate profile id %q", trimmedID)
				}
				seenIDs[trimmedID] = true
			}
		}

		if provider, ok := profile["provider"]; ok {
			providerName, isString := provider.(string)
			if !isString || strings.TrimSpace(providerName) == "" {
				return nil, fmt.Errorf("agentProfiles[%d] (%s): provider must be a non-empty string", index, name)
			}
		}

		tier, err := validateProfileTierField(profile, fmt.Sprintf("agentProfiles[%d] (%s)", index, name))
		if err != nil {
			return nil, err
		}
		if trimmedID != "" {
			tiers[trimmedID] = tier
		}
		trimmedName := strings.TrimSpace(name)
		if _, exists := tiers[trimmedName]; !exists {
			tiers[trimmedName] = tier
		}
	}
	return tiers, nil
}

func validateProfileTierField(profile map[string]any, prefix string) (string, error) {
	rawTier, ok := profile["tier"]
	if !ok || rawTier == nil {
		return "standard", nil
	}
	tier, isString := rawTier.(string)
	if !isString || validProfileTiers[tier] == 0 {
		return "", fmt.Errorf("%s: tier must be one of fast, standard, strong", prefix)
	}
	return tier, nil
}

func validateChiefConfig(raw any, profileTiers map[string]string, checkProfileRefs bool) error {
	chief, isObject := raw.(map[string]any)
	if !isObject {
		return fmt.Errorf("chief: must be an object")
	}

	if rawTier, ok := chief["defaultTier"]; ok && rawTier != nil {
		tier, isString := rawTier.(string)
		if !isString || !validChiefMissionTiers[tier] {
			return fmt.Errorf("chief.defaultTier: must be one of L0, L1, L2")
		}
	}

	if rawStall, ok := chief["stall"]; ok && rawStall != nil {
		if err := validateChiefStall(rawStall); err != nil {
			return err
		}
	}

	if rawLanding, ok := chief["landing"]; ok && rawLanding != nil {
		if err := validateChiefLanding(rawLanding); err != nil {
			return err
		}
	}

	if rawRoles, ok := chief["roles"]; ok && rawRoles != nil {
		if err := validateChiefRoles(rawRoles, profileTiers, checkProfileRefs); err != nil {
			return err
		}
	}

	return nil
}

func validateChiefStall(raw any) error {
	stall, isObject := raw.(map[string]any)
	if !isObject {
		return fmt.Errorf("chief.stall: must be an object")
	}
	soft := 600
	hard := 1200
	if val, ok := stall["softWarningSec"]; ok && val != nil {
		parsed, ok := toPositiveIntValue(val)
		if !ok {
			return fmt.Errorf("chief.stall.softWarningSec: must be a positive integer")
		}
		soft = parsed
	}
	if val, ok := stall["hardRecoverySec"]; ok && val != nil {
		parsed, ok := toPositiveIntValue(val)
		if !ok {
			return fmt.Errorf("chief.stall.hardRecoverySec: must be a positive integer")
		}
		hard = parsed
	}
	if hard < soft {
		return fmt.Errorf("chief.stall.hardRecoverySec: must be >= softWarningSec (%d < %d)", hard, soft)
	}
	return nil
}

func validateChiefLanding(raw any) error {
	landing, isObject := raw.(map[string]any)
	if !isObject {
		return fmt.Errorf("chief.landing: must be an object")
	}
	if val, ok := landing["requireHumanApproval"]; ok && val != nil {
		if _, isBool := val.(bool); !isBool {
			return fmt.Errorf("chief.landing.requireHumanApproval: must be a boolean")
		}
	}
	if val, ok := landing["mode"]; ok && val != nil {
		mode, isString := val.(string)
		if !isString || !validChiefLandingModes[mode] {
			return fmt.Errorf("chief.landing.mode: must be one of merge_local, open_pr")
		}
	}
	if val, ok := landing["strategy"]; ok && val != nil {
		strategy, isString := val.(string)
		if !isString || !validChiefLandingStrategies[strategy] {
			return fmt.Errorf("chief.landing.strategy: must be one of squash, merge, rebase")
		}
	}
	return nil
}

func validateChiefRoles(raw any, profileTiers map[string]string, checkProfileRefs bool) error {
	roles, isObject := raw.(map[string]any)
	if !isObject {
		return fmt.Errorf("chief.roles: must be an object")
	}

	primaries := make(map[string]string, len(chiefRoleKeys))
	for _, role := range chiefRoleKeys {
		rawEntry, present := roles[role]
		if !present || rawEntry == nil {
			continue
		}
		entry, isObj := rawEntry.(map[string]any)
		if !isObj {
			return fmt.Errorf("chief.roles.%s: must be an object", role)
		}
		primaryRaw, hasPrimary := entry["primaryProfileId"]
		primary, isString := primaryRaw.(string)
		primary = strings.TrimSpace(primary)
		if !hasPrimary || !isString || primary == "" {
			return fmt.Errorf("chief.roles.%s.primaryProfileId: must be a non-empty string", role)
		}
		fallbacks, err := validateProfileIDList(entry["fallbackProfileIds"], fmt.Sprintf("chief.roles.%s.fallbackProfileIds", role))
		if err != nil {
			return err
		}

		if checkProfileRefs {
			if _, ok := profileTiers[primary]; !ok {
				return fmt.Errorf("chief.roles.%s.primaryProfileId: unknown profile %q", role, primary)
			}
			for i, fb := range fallbacks {
				if _, ok := profileTiers[fb]; !ok {
					return fmt.Errorf("chief.roles.%s.fallbackProfileIds[%d]: unknown profile %q", role, i, fb)
				}
			}
		}
		primaries[role] = primary
	}

	if checkProfileRefs {
		authorID, hasAuthor := primaries["author"]
		verifierID, hasVerifier := primaries["verifier"]
		if hasAuthor && hasVerifier {
			authorTier := profileTiers[authorID]
			verifierTier := profileTiers[verifierID]
			if validProfileTiers[verifierTier] < validProfileTiers[authorTier] {
				return fmt.Errorf("chief.roles.verifier: profile %q (tier %s) cannot be lower than author profile %q (tier %s)", verifierID, verifierTier, authorID, authorTier)
			}
		}
	}
	return nil
}

func validateProfileIDList(raw any, fieldPath string) ([]string, error) {
	if raw == nil {
		return nil, nil
	}
	switch list := raw.(type) {
	case []string:
		out := make([]string, 0, len(list))
		for i, item := range list {
			trimmed := strings.TrimSpace(item)
			if trimmed == "" {
				return nil, fmt.Errorf("%s[%d]: must be a non-empty string", fieldPath, i)
			}
			out = append(out, trimmed)
		}
		return out, nil
	case []any:
		out := make([]string, 0, len(list))
		for i, item := range list {
			str, isString := item.(string)
			trimmed := strings.TrimSpace(str)
			if !isString || trimmed == "" {
				return nil, fmt.Errorf("%s[%d]: must be a non-empty string", fieldPath, i)
			}
			out = append(out, trimmed)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("%s: must be a list of profile ids", fieldPath)
	}
}

func toPositiveIntValue(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, v > 0
	case int64:
		return int(v), v > 0
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 || v != math.Trunc(v) {
			return 0, false
		}
		return int(v), true
	default:
		return 0, false
	}
}

// builtinProviderIDs are the providers the product ships. A custom provider needs a way to be
// launched; a built-in one already has its own and only ever appears here to carry overrides
// (enabled, models, params).
var builtinProviderIDs = map[string]bool{
	"claude": true, "codex": true, "opencode": true, "pi": true,
}

// canLaunchProvider reports whether a provider entry names a way to start it, or is one the daemon
// already serves by its own means.
func canLaunchProvider(id string, config map[string]any, served map[string]bool) bool {
	if builtinProviderIDs[id] || served[id] {
		return true
	}
	// `command` is an argv list on the wire (`z.array(z.string().min(1)).min(1)`), so reading it as
	// a plain string rejected every edit that only set a command — the app sent
	// `command: ["node", "./agent.mjs"]` and the daemon answered "needs one of command, extends or
	// baseUrl". A bare string is still accepted for configs written by hand.
	if commandValue(config["command"]) != "" {
		return true
	}
	extends, _ := config["extends"].(string)
	baseURL, _ := config["baseUrl"].(string)
	return strings.TrimSpace(extends) != "" || strings.TrimSpace(baseURL) != ""
}

// validateProviders checks each custom provider names a way to start it.
//
// Built-in ids are exempt, matching `ProviderOverridesSchema` in packages/protocol: it requires
// `extends` and `label` only for a provider that is not one of the six. Requiring them here too is
// what made the settings switch a no-op — toggling Claude off sends `{claude: {enabled: false}}`,
// the patch was rejected with "needs one of command, extends or baseUrl", and the UI showed the
// switch snapping back with nothing logged anywhere the user would look.
func validateProviders(raw any, served map[string]bool) error {
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
		if !canLaunchProvider(id, config, served) {
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
