package providers

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// This file ports the provider-profile model semantics from
// archive/packages/server/src/server/agent/provider-registry.ts.
//
// Two things in that file are load-bearing and were missing here:
//
//   - `models` on a provider override *replaces* the provider's catalog; `additionalModels` is
//     merged on top. Ignoring them meant a provider the user configured with a fixed model list
//     offered only the generic "<id> Default" row, so the picker could never select what the
//     config named — and an agent created with such a model failed to start.
//   - `extends` names the provider whose runtime settings this one inherits. Treating every
//     custom provider as a generic ACP agent made a `extends: "pi"` profile launch the wrong
//     protocol, so a pi-profile provider never spoke pi's RPC.
//
// The merge rules are copied deliberately, including the isDefault and isSelectable edge cases:
// a profile model that is not marked default must not silently unset the base default, and a
// compatibility model that was hidden can be re-enabled by naming it.

// configStringField reads a trimmed string out of a raw config object.
func configStringField(cfg map[string]any, key string) string {
	if cfg == nil {
		return ""
	}
	value, ok := cfg[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

// configBoolField reads a bool out of a raw config object, falling back when absent.
func configBoolField(cfg map[string]any, key string, fallback bool) bool {
	if cfg == nil {
		return fallback
	}
	value, ok := cfg[key].(bool)
	if !ok {
		return fallback
	}
	return value
}

// configCommandArgv returns the argv a provider override's `command` names.
//
// The protocol declares `command` as a non-empty string array whose first element is the binary
// and whose remaining elements are arguments. Reading only the first element dropped the script a
// test fixture passes (`[node, fake-pi-rpc.mjs]`), which then made the provider start `node` with
// pi's flags and exit immediately.
func configCommandArgv(cfg map[string]any) []string {
	if cfg == nil {
		return nil
	}
	switch command := cfg["command"].(type) {
	case []any:
		out := make([]string, 0, len(command))
		for _, entry := range command {
			text, ok := entry.(string)
			if !ok || strings.TrimSpace(text) == "" {
				return nil
			}
			out = append(out, strings.TrimSpace(text))
		}
		return out
	case []string:
		out := make([]string, 0, len(command))
		for _, entry := range command {
			if strings.TrimSpace(entry) == "" {
				return nil
			}
			out = append(out, strings.TrimSpace(entry))
		}
		return out
	case string:
		// Older configs wrote `command` as a bare path; the protocol now requires an array, but a
		// saved string should still launch rather than silently fall back to the provider's binary.
		if trimmed := strings.TrimSpace(command); trimmed != "" {
			return []string{trimmed}
		}
	}
	return nil
}

// catalogModelsFromConfig parses a `models` or `additionalModels` array.
//
// The provider field is stamped here rather than trusted from the config: the client keys the
// picker by `provider` + `id`, and a profile entry has no reason to repeat the provider id.
func catalogModelsFromConfig(raw any, providerID string) []sdk.CatalogModel {
	list, ok := raw.([]any)
	if !ok || len(list) == 0 {
		return nil
	}
	out := make([]sdk.CatalogModel, 0, len(list))
	for _, entry := range list {
		model, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		id := configStringField(model, "id")
		if id == "" {
			continue
		}
		label := configStringField(model, "label")
		if label == "" {
			label = id
		}
		catalog := sdk.CatalogModel{
			ID:          id,
			Label:       label,
			Description: configStringField(model, "description"),
			Provider:    providerID,
			IsDefault:   configBoolField(model, "isDefault", false),
			// A model the config names is offered by definition. Leaving IsSelectable at its zero value
			// sent `isSelectable: false` on the wire (the field is `omitempty`, so only an explicit true
			// survives), and the picker filters those out — the provider drilled down to an empty list.
			IsSelectable: true,
		}
		if options := thinkingOptionsFromConfig(model["thinkingOptions"]); len(options) > 0 {
			catalog.ThinkingOptions = options
			for _, option := range options {
				if option.IsDefault {
					catalog.DefaultThinkingOptionID = option.ID
					break
				}
			}
		}
		out = append(out, catalog)
	}
	return out
}

// thinkingOptionsFromConfig parses a profile model's thinkingOptions array.
func thinkingOptionsFromConfig(raw any) []sdk.ThinkingOption {
	list, ok := raw.([]any)
	if !ok || len(list) == 0 {
		return nil
	}
	out := make([]sdk.ThinkingOption, 0, len(list))
	for _, entry := range list {
		option, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		id := configStringField(option, "id")
		if id == "" {
			continue
		}
		label := configStringField(option, "label")
		if label == "" {
			label = id
		}
		out = append(out, sdk.ThinkingOption{
			ID:          id,
			Label:       label,
			Description: configStringField(option, "description"),
			IsDefault:   configBoolField(option, "isDefault", false),
		})
	}
	return out
}

// mergeCatalogModelAdditions merges by id, with the additions winning field by field.
//
// Ported from mergeModelAdditions in provider-registry.ts, including two rules that look
// arbitrary until you need them: an addition marked default demotes every other model's default
// flag (otherwise two rows claim to be the default), and an addition without `isSelectable`
// re-enables a base model that had been hidden (that is how a compatibility entry becomes
// selectable again).
func mergeCatalogModelAdditions(base []sdk.CatalogModel, additions []sdk.CatalogModel) []sdk.CatalogModel {
	if len(additions) == 0 {
		return base
	}
	merged := make([]sdk.CatalogModel, len(base))
	copy(merged, base)

	hasAdditionalDefault := false
	for _, addition := range additions {
		if addition.IsDefault {
			hasAdditionalDefault = true
		}
		index := -1
		for i := range merged {
			if merged[i].ID == addition.ID {
				index = i
				break
			}
		}
		if index == -1 {
			merged = append(merged, addition)
			continue
		}
		existing := merged[index]
		reEnabled := !existing.IsSelectable
		replacement := addition
		if reEnabled {
			replacement.IsSelectable = true
		}
		merged[index] = replacement
	}

	if !hasAdditionalDefault {
		return merged
	}
	additionalDefaultIDs := make(map[string]bool, len(additions))
	for _, addition := range additions {
		if addition.IsDefault {
			additionalDefaultIDs[addition.ID] = true
		}
	}
	for i := range merged {
		if !additionalDefaultIDs[merged[i].ID] {
			merged[i].IsDefault = false
		}
	}
	return merged
}

// MergeProviderModels applies a provider override's `models` and `additionalModels`.
//
// A non-empty `models` list replaces the catalog outright (provider-registry.ts sets
// profileModelsAreAdditive to false for every override), which is what makes a profile with a
// fixed model list usable without the provider being installed; otherwise both lists are merged
// on top of the runtime catalog.
//
// Results always carry the override's provider id, mirroring mapModel(provider, model).
func MergeProviderModels(providerID string, cfg map[string]any, runtimeModels []sdk.CatalogModel) []sdk.CatalogModel {
	profileModels := catalogModelsFromConfig(cfg["models"], providerID)
	additionalModels := catalogModelsFromConfig(cfg["additionalModels"], providerID)

	if len(profileModels) > 0 {
		return mergeCatalogModelAdditions(profileModels, additionalModels)
	}
	base := make([]sdk.CatalogModel, 0, len(runtimeModels))
	for _, model := range runtimeModels {
		stamped := model
		stamped.Provider = providerID
		if stamped.Label == "" {
			stamped.Label = stamped.ID
		}
		base = append(base, stamped)
	}
	return mergeCatalogModelAdditions(base, append(profileModels, additionalModels...))
}

// ResolveProviderSpecWithConfig resolves a provider id plus its config override into a spec.
//
// `extends` selects the runtime a derived provider inherits — protocol, binary, launch args,
// modes and feature list all come from the base. Without this a profile pointing at pi ran the
// generic ACP transport and never spoke pi's RPC, so the provider's models were listed but agents
// created on it could not start.
func ResolveProviderSpecWithConfig(providerID string, cfg map[string]any) ProviderSpec {
	spec := GetProviderSpec(providerID)
	extends := configStringField(cfg, "extends")
	if extends == "" || extends == "acp" || extends == providerID {
		return applySpecOverrides(spec, providerID, cfg)
	}
	base := GetProviderSpec(extends)
	// A base that resolved to the generic ACP fallback carries nothing worth inheriting; keep the
	// provider's own id and let it behave as a plain ACP agent.
	if base.ID != extends {
		return applySpecOverrides(spec, providerID, cfg)
	}
	derived := base
	derived.ID = providerID
	if derived.Binary == "" || derived.Binary == extends {
		derived.Binary = providerID
	}
	return applySpecOverrides(derived, providerID, cfg)
}

// applySpecOverrides stamps the cosmetic and launch overrides a config entry carries.
func applySpecOverrides(spec ProviderSpec, providerID string, cfg map[string]any) ProviderSpec {
	spec.ID = providerID
	if label := configStringField(cfg, "label"); label != "" {
		spec.Label = label
	} else if spec.Label == "" {
		spec.Label = providerID
	}
	if description := configStringField(cfg, "description"); description != "" {
		spec.Description = description
	}
	if argv := configCommandArgv(cfg); len(argv) > 0 {
		spec.Binary = argv[0]
	}
	return spec
}

// ProviderSpecForLaunch resolves the spec and the argv a config entry asks for.
//
// The returned argv is the full launch command including the binary, because a profile's command
// may be `[interpreter, script]` and the script is not an optional extra — passing only the
// interpreter made such a provider start the wrong program with pi's flags.
func ProviderSpecForLaunch(providerID string, cfg map[string]any) (ProviderSpec, []string) {
	spec := ResolveProviderSpecWithConfig(providerID, cfg)
	argv := configCommandArgv(cfg)
	spec.Models = MergeProviderModels(spec.ID, cfg, spec.Models)
	return spec, argv
}

// IsConfiguredProvider reports whether the daemon config declares this provider id.
//
// loadAgent refuses a record whose provider this build does not register. A provider the user
// added exists only in config, so a resume of its agents would otherwise be rejected as
// "unavailable provider" — an agent that was just created successfully and cannot be reloaded.
func IsConfiguredProvider(cfg map[string]any, providerID string) bool {
	providers, ok := cfg["providers"].(map[string]any)
	if !ok {
		return false
	}
	_, present := providers[providerID]
	return present
}
