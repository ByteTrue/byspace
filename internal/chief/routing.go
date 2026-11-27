package chief

import (
	"errors"
	"fmt"
	"strings"
)

// Explicit AgentProfile tiers (ordered fast < standard < strong).
const (
	TierFast     = "fast"
	TierStandard = "standard"
	TierStrong   = "strong"
)

// ErrVerifierTierBlocked indicates no valid Verifier profile satisfies Verifier.tier >= Author.tier.
var ErrVerifierTierBlocked = errors.New("verifier_tier_blocked")

// RoutingError captures structured profile routing or tier-policy failures.
type RoutingError struct {
	Code         string `json:"code"`
	Role         string `json:"role,omitempty"`
	AuthorTier   string `json:"authorTier,omitempty"`
	VerifierTier string `json:"verifierTier,omitempty"`
	Message      string `json:"message"`
}

func (e *RoutingError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *RoutingError) Is(target error) bool {
	return target == ErrVerifierTierBlocked && e != nil && e.Code == IncidentVerifierTierBlocked
}

// Profile mirrors AgentProfile in packages/protocol/src/messages.ts with explicit tier.
type Profile struct {
	ID               string         `json:"id"`
	Name             string         `json:"name"`
	Provider         string         `json:"provider"`
	Model            string         `json:"model,omitempty"`
	ModeID           string         `json:"modeId,omitempty"`
	ThinkingOptionID string         `json:"thinkingOptionId,omitempty"`
	FeatureValues    map[string]any `json:"featureValues,omitempty"`
	Tier             string         `json:"tier,omitempty"` // "fast" | "standard" | "strong" (default "standard")
	Notes            string         `json:"notes,omitempty"`
}

// RoleRoutingConfig configures primary and ordered fallback profiles for one role.
type RoleRoutingConfig struct {
	PrimaryProfileID   string   `json:"primaryProfileId,omitempty"`
	FallbackProfileIDs []string `json:"fallbackProfileIds,omitempty"`
}

// StallConfig mirrors ChiefStallConfigSchema in packages/protocol/src/messages.ts.
type StallConfig struct {
	SoftWarningSec  int `json:"softWarningSec,omitempty"`
	HardRecoverySec int `json:"hardRecoverySec,omitempty"`
}

// ChiefConfig mirrors ChiefConfigSchema under daemon.chief in packages/protocol/src/messages.ts.
type ChiefConfig struct {
	DefaultTier string                       `json:"defaultTier,omitempty"`
	Roles       map[string]RoleRoutingConfig `json:"roles,omitempty"`
	Stall       StallConfig                  `json:"stall,omitempty"`
	Landing     LandingPolicy                `json:"landing,omitempty"`
}

// NormalizeTier validates and normalizes an explicit AgentProfile tier.
// Empty/omitted tier defaults to "standard" per confirmed specification.
func NormalizeTier(raw string) (string, bool) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return TierStandard, true
	}
	switch trimmed {
	case TierFast, TierStandard, TierStrong:
		return trimmed, true
	default:
		return "", false
	}
}

// TierRank returns the strict ordering rank (fast=1, standard=2, strong=3, invalid=0).
func TierRank(tier string) int {
	norm, ok := NormalizeTier(tier)
	if !ok {
		return 0
	}
	switch norm {
	case TierFast:
		return 1
	case TierStandard:
		return 2
	case TierStrong:
		return 3
	default:
		return 0
	}
}

// ValidateVerifierTier enforces the hard invariant Verifier.tier >= Author.tier.
func ValidateVerifierTier(authorTier, verifierTier string) error {
	aNorm, aOK := NormalizeTier(authorTier)
	if !aOK {
		return &RoutingError{
			Code:       "invalid_tier",
			Role:       RoleAuthor,
			AuthorTier: authorTier,
			Message:    fmt.Sprintf("invalid author tier %q", authorTier),
		}
	}
	vNorm, vOK := NormalizeTier(verifierTier)
	if !vOK {
		return &RoutingError{
			Code:         "invalid_tier",
			Role:         RoleVerifier,
			VerifierTier: verifierTier,
			Message:      fmt.Sprintf("invalid verifier tier %q", verifierTier),
		}
	}
	if TierRank(vNorm) < TierRank(aNorm) {
		return &RoutingError{
			Code:         IncidentVerifierTierBlocked,
			Role:         RoleVerifier,
			AuthorTier:   aNorm,
			VerifierTier: vNorm,
			Message:      fmt.Sprintf("verifier_tier_blocked: verifier tier %q is lower than author tier %q", vNorm, aNorm),
		}
	}
	return nil
}

// ParseRoutingConfig extracts ChiefConfig and Profile list from daemon config map.
func ParseRoutingConfig(daemonCfg map[string]any) (ChiefConfig, []Profile, error) {
	outCfg := ChiefConfig{
		Roles: make(map[string]RoleRoutingConfig),
		Stall: StallConfig{
			SoftWarningSec:  DefaultSoftStallSeconds,
			HardRecoverySec: DefaultHardStallSeconds,
		},
		Landing: DefaultLandingPolicy(),
	}
	profiles := parseProfiles(daemonCfg["agentProfiles"])

	rawChief, _ := daemonCfg["chief"].(map[string]any)
	if rawChief == nil {
		return outCfg, profiles, nil
	}

	if dt, ok := rawChief["defaultTier"].(string); ok && strings.TrimSpace(dt) != "" {
		outCfg.DefaultTier = strings.TrimSpace(dt)
	}

	if rawRoles, ok := rawChief["roles"].(map[string]any); ok {
		for roleName, rawEntry := range rawRoles {
			entry, ok := rawEntry.(map[string]any)
			if !ok {
				continue
			}
			primary, _ := entry["primaryProfileId"].(string)
			fallbacks := stringSliceFromAny(entry["fallbackProfileIds"])
			outCfg.Roles[strings.ToLower(strings.TrimSpace(roleName))] = RoleRoutingConfig{
				PrimaryProfileID:   strings.TrimSpace(primary),
				FallbackProfileIDs: fallbacks,
			}
		}
	}

	if rawStall, ok := rawChief["stall"].(map[string]any); ok {
		if v, ok := intFromAny(rawStall["softWarningSec"]); ok && v > 0 {
			outCfg.Stall.SoftWarningSec = v
		}
		if v, ok := intFromAny(rawStall["hardRecoverySec"]); ok && v > 0 {
			outCfg.Stall.HardRecoverySec = v
		}
	}
	if v, ok := intFromAny(rawChief["softWarningSec"]); ok && v > 0 {
		outCfg.Stall.SoftWarningSec = v
	}
	if v, ok := intFromAny(rawChief["hardRecoverySec"]); ok && v > 0 {
		outCfg.Stall.HardRecoverySec = v
	}

	if rawLanding, ok := rawChief["landing"].(map[string]any); ok {
		if b, ok := rawLanding["requireHumanApproval"].(bool); ok {
			outCfg.Landing.RequireHumanApproval = b
		}
		if mode, ok := rawLanding["mode"].(string); ok && strings.TrimSpace(mode) != "" {
			outCfg.Landing.Mode = strings.TrimSpace(mode)
		}
		if strategy, ok := rawLanding["strategy"].(string); ok && strings.TrimSpace(strategy) != "" {
			outCfg.Landing.Strategy = strings.TrimSpace(strategy)
		}
	}

	return outCfg, profiles, nil
}

// ResolveRoleProfiles resolves the ordered candidate profiles for a role
// (primary first, then fallbacks), skipping excluded IDs and unavailable providers.
func ResolveRoleProfiles(
	role string,
	cfg ChiefConfig,
	profiles []Profile,
	overrideProfileID string,
	excludedIDs map[string]bool,
	providerReady func(string) bool,
) ([]Profile, error) {
	byRef := indexProfiles(profiles)
	var refs []string
	if strings.TrimSpace(overrideProfileID) != "" {
		refs = []string{strings.TrimSpace(overrideProfileID)}
	} else if roleCfg, ok := cfg.Roles[strings.ToLower(strings.TrimSpace(role))]; ok {
		if roleCfg.PrimaryProfileID != "" {
			refs = append(refs, roleCfg.PrimaryProfileID)
		}
		refs = append(refs, roleCfg.FallbackProfileIDs...)
	}

	seen := make(map[string]bool, len(refs))
	resolved := make([]Profile, 0, len(refs))
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			continue
		}
		prof, ok := byRef[ref]
		if !ok {
			return nil, &RoutingError{
				Code:    "profile_not_found",
				Role:    role,
				Message: fmt.Sprintf("role %s references unknown profile %q", role, ref),
			}
		}
		key := profileKey(prof)
		if seen[key] {
			continue
		}
		seen[key] = true
		normTier, tierOK := NormalizeTier(prof.Tier)
		if !tierOK {
			return nil, &RoutingError{
				Code:    "invalid_tier",
				Role:    role,
				Message: fmt.Sprintf("profile %q has invalid tier %q", key, prof.Tier),
			}
		}
		prof.Tier = normTier
		if excludedIDs[key] || excludedIDs[prof.Name] {
			continue
		}
		if providerReady != nil && !providerReady(prof.Provider) {
			continue
		}
		resolved = append(resolved, prof)
	}
	return resolved, nil
}

// ResolveRolePairForThread resolves an Author + Verifier pair while enforcing
// Verifier.tier >= Author.tier. Refuses silent Verifier downgrade.
func ResolveRolePairForThread(
	cfg ChiefConfig,
	profiles []Profile,
	authorOverrideID string,
	verifierOverrideID string,
	excludedIDs map[string]bool,
	providerReady func(string) bool,
) (Profile, Profile, error) {
	authors, err := ResolveRoleProfiles(RoleAuthor, cfg, profiles, authorOverrideID, excludedIDs, providerReady)
	if err != nil {
		return Profile{}, Profile{}, err
	}
	if len(authors) == 0 {
		return Profile{}, Profile{}, &RoutingError{
			Code:    "no_available_profile",
			Role:    RoleAuthor,
			Message: "no available author profile configured",
		}
	}
	author := authors[0]

	verifiers, err := ResolveRoleProfiles(RoleVerifier, cfg, profiles, verifierOverrideID, excludedIDs, providerReady)
	if err != nil {
		return Profile{}, Profile{}, err
	}
	if len(verifiers) == 0 {
		return Profile{}, Profile{}, &RoutingError{
			Code:       IncidentVerifierTierBlocked,
			Role:       RoleVerifier,
			AuthorTier: author.Tier,
			Message:    "verifier_tier_blocked: no available verifier profile configured",
		}
	}

	var highestRejected string
	for _, candidate := range verifiers {
		if err := ValidateVerifierTier(author.Tier, candidate.Tier); err == nil {
			return author, candidate, nil
		}
		if TierRank(candidate.Tier) > TierRank(highestRejected) {
			highestRejected = candidate.Tier
		}
	}

	return Profile{}, Profile{}, &RoutingError{
		Code:         IncidentVerifierTierBlocked,
		Role:         RoleVerifier,
		AuthorTier:   author.Tier,
		VerifierTier: highestRejected,
		Message:      fmt.Sprintf("verifier_tier_blocked: all eligible verifier profiles (best %q) are below author tier %q", highestRejected, author.Tier),
	}
}

// ResolveFallbackForRole selects the next eligible fallback profile for a role after
// an exhaustion or crash, enforcing Verifier.tier >= Author.tier without silent downgrade.
func ResolveFallbackForRole(
	role string,
	counterpartTier string,
	cfg ChiefConfig,
	profiles []Profile,
	excludedIDs map[string]bool,
	providerReady func(string) bool,
) (Profile, error) {
	candidates, err := ResolveRoleProfiles(role, cfg, profiles, "", excludedIDs, providerReady)
	if err != nil {
		return Profile{}, err
	}
	if len(candidates) == 0 {
		if strings.EqualFold(role, RoleVerifier) {
			return Profile{}, &RoutingError{
				Code:       IncidentVerifierTierBlocked,
				Role:       RoleVerifier,
				AuthorTier: counterpartTier,
				Message:    "verifier_tier_blocked: fallback chain exhausted with no eligible verifier",
			}
		}
		return Profile{}, &RoutingError{
			Code:    "fallback_exhausted",
			Role:    role,
			Message: fmt.Sprintf("fallback chain exhausted for role %s", role),
		}
	}

	normRole := strings.ToLower(strings.TrimSpace(role))
	if normRole == RoleVerifier && strings.TrimSpace(counterpartTier) != "" {
		var bestTier string
		for _, candidate := range candidates {
			if err := ValidateVerifierTier(counterpartTier, candidate.Tier); err == nil {
				return candidate, nil
			}
			if TierRank(candidate.Tier) > TierRank(bestTier) {
				bestTier = candidate.Tier
			}
		}
		return Profile{}, &RoutingError{
			Code:         IncidentVerifierTierBlocked,
			Role:         RoleVerifier,
			AuthorTier:   counterpartTier,
			VerifierTier: bestTier,
			Message:      fmt.Sprintf("verifier_tier_blocked: refusing silent downgrade to %q below author tier %q", bestTier, counterpartTier),
		}
	}

	if normRole == RoleAuthor && strings.TrimSpace(counterpartTier) != "" {
		for _, candidate := range candidates {
			if err := ValidateVerifierTier(candidate.Tier, counterpartTier); err == nil {
				return candidate, nil
			}
		}
		return Profile{}, &RoutingError{
			Code:         IncidentVerifierTierBlocked,
			Role:         RoleAuthor,
			VerifierTier: counterpartTier,
			Message:      fmt.Sprintf("verifier_tier_blocked: author fallback exceeds bound verifier tier %q", counterpartTier),
		}
	}

	return candidates[0], nil
}

func parseProfiles(raw any) []Profile {
	switch typed := raw.(type) {
	case []Profile:
		out := make([]Profile, len(typed))
		for i, p := range typed {
			if norm, ok := NormalizeTier(p.Tier); ok {
				p.Tier = norm
			}
			if p.ID == "" {
				p.ID = p.Name
			}
			out[i] = p
		}
		return out
	case []any:
		out := make([]Profile, 0, len(typed))
		for _, item := range typed {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			out = append(out, profileFromMap("", obj))
		}
		return out
	case map[string]any:
		out := make([]Profile, 0, len(typed))
		for key, item := range typed {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			out = append(out, profileFromMap(key, obj))
		}
		return out
	default:
		return nil
	}
}

func profileFromMap(fallbackID string, obj map[string]any) Profile {
	id, _ := obj["id"].(string)
	name, _ := obj["name"].(string)
	provider, _ := obj["provider"].(string)
	model, _ := obj["model"].(string)
	modeID, _ := obj["modeId"].(string)
	thinkingID, _ := obj["thinkingOptionId"].(string)
	tier, _ := obj["tier"].(string)
	notes, _ := obj["notes"].(string)
	featureValues, _ := obj["featureValues"].(map[string]any)

	id = strings.TrimSpace(id)
	name = strings.TrimSpace(name)
	if id == "" {
		id = strings.TrimSpace(fallbackID)
	}
	if id == "" {
		id = name
	}
	if name == "" {
		name = id
	}
	return Profile{
		ID:               id,
		Name:             name,
		Provider:         strings.TrimSpace(provider),
		Model:            strings.TrimSpace(model),
		ModeID:           strings.TrimSpace(modeID),
		ThinkingOptionID: strings.TrimSpace(thinkingID),
		FeatureValues:    featureValues,
		Tier:             strings.TrimSpace(tier),
		Notes:            notes,
	}
}

func indexProfiles(profiles []Profile) map[string]Profile {
	out := make(map[string]Profile, len(profiles)*2)
	for _, p := range profiles {
		if p.ID != "" {
			out[p.ID] = p
		}
		if p.Name != "" {
			if _, exists := out[p.Name]; !exists {
				out[p.Name] = p
			}
		}
	}
	return out
}

func profileKey(p Profile) string {
	if strings.TrimSpace(p.ID) != "" {
		return strings.TrimSpace(p.ID)
	}
	return strings.TrimSpace(p.Name)
}

func stringSliceFromAny(raw any) []string {
	switch list := raw.(type) {
	case []string:
		out := make([]string, 0, len(list))
		for _, item := range list {
			if s := strings.TrimSpace(item); s != "" {
				out = append(out, s)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(list))
		for _, item := range list {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	default:
		return nil
	}
}

func intFromAny(raw any) (int, bool) {
	switch v := raw.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	default:
		return 0, false
	}
}
