package store

import (
	"strings"
	"testing"
)

func baseChiefConfigForValidationTests() map[string]any {
	return map[string]any{
		"agentProfiles": []any{
			map[string]any{"id": "p-fast", "name": "Fast Coder", "provider": "pi", "tier": "fast"},
			map[string]any{"id": "p-std", "name": "Standard Coder", "provider": "codex"},
			map[string]any{"id": "p-strong", "name": "Strong Reviewer", "provider": "claude", "tier": "strong"},
		},
		"providers": map[string]any{
			"custom": map[string]any{"command": []any{"custom-agent"}},
		},
		"chief": map[string]any{
			"defaultTier": "L1",
			"roles": map[string]any{
				"chief":      map[string]any{"primaryProfileId": "p-strong"},
				"author":     map[string]any{"primaryProfileId": "p-std", "fallbackProfileIds": []any{"p-fast"}},
				"verifier":   map[string]any{"primaryProfileId": "p-strong", "fallbackProfileIds": []any{"p-std"}},
				"integrator": map[string]any{"primaryProfileId": "p-strong"},
			},
			"stall": map[string]any{
				"softWarningSec":  600,
				"hardRecoverySec": 1200,
			},
			"landing": map[string]any{
				"requireHumanApproval": true,
				"mode":                 "merge_local",
				"strategy":             "squash",
			},
		},
	}
}

func TestValidateEffectiveDaemonConfigAcceptsValidMergedPatches(t *testing.T) {
	existing := baseChiefConfigForValidationTests()

	cases := []struct {
		name   string
		patch  map[string]any
		served map[string]bool
	}{
		{
			name:  "nil patch against valid existing",
			patch: nil,
		},
		{
			name:  "partial provider toggle preserves existing launch command",
			patch: map[string]any{"providers": map[string]any{"custom": map[string]any{"enabled": false}}},
		},
		{
			name:  "equal verifier and author standard tiers via omitted tier default",
			patch: map[string]any{"chief": map[string]any{"roles": map[string]any{"verifier": map[string]any{"primaryProfileId": "p-std"}}}},
		},
		{
			name:  "clearing verifier role with null",
			patch: map[string]any{"chief": map[string]any{"roles": map[string]any{"verifier": nil}}},
		},
		{
			name:  "clearing entire chief block with null",
			patch: map[string]any{"chief": nil},
		},
		{
			name: "name-based profile ref when id is omitted",
			patch: map[string]any{
				"agentProfiles": []any{
					map[string]any{"name": "Author", "provider": "pi", "tier": "fast"},
					map[string]any{"name": "Verifier", "provider": "claude"},
				},
				"chief": map[string]any{
					"roles": map[string]any{
						"chief":      nil,
						"integrator": nil,
						"author":     map[string]any{"primaryProfileId": "Author", "fallbackProfileIds": []any{}},
						"verifier":   map[string]any{"primaryProfileId": "Verifier", "fallbackProfileIds": []any{}},
					},
				},
			},
		},
		{
			name: "open_pr rebase landing and custom stall thresholds",
			patch: map[string]any{
				"chief": map[string]any{
					"defaultTier": "L2",
					"stall":       map[string]any{"softWarningSec": 300, "hardRecoverySec": 900},
					"landing":     map[string]any{"requireHumanApproval": false, "mode": "open_pr", "strategy": "rebase"},
				},
			},
		},
		{
			name:   "served scripted provider toggle",
			patch:  map[string]any{"providers": map[string]any{"mock": map[string]any{"enabled": false}}},
			served: map[string]bool{"mock": true},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateEffectiveDaemonConfig(existing, tc.patch, tc.served); err != nil {
				t.Fatalf("expected valid merged config, got %v", err)
			}
		})
	}
}

func TestValidateEffectiveDaemonConfigRejectsPartialChiefAndProfileBypasses(t *testing.T) {
	existing := baseChiefConfigForValidationTests()

	t.Run("partial chief patch downgrading verifier below author", func(t *testing.T) {
		patch := map[string]any{
			"chief": map[string]any{
				"roles": map[string]any{
					"verifier": map[string]any{"primaryProfileId": "p-fast"},
				},
			},
		}
		err := ValidateEffectiveDaemonConfig(existing, patch, nil)
		if err == nil || !strings.Contains(err.Error(), "verifier") {
			t.Fatalf("expected verifier tier error, got %v", err)
		}
	})

	t.Run("partial chief patch upgrading author above verifier", func(t *testing.T) {
		base := baseChiefConfigForValidationTests()
		base["chief"].(map[string]any)["roles"].(map[string]any)["verifier"] = map[string]any{"primaryProfileId": "p-std"}
		patch := map[string]any{
			"chief": map[string]any{
				"roles": map[string]any{
					"author": map[string]any{"primaryProfileId": "p-strong"},
				},
			},
		}
		err := ValidateEffectiveDaemonConfig(base, patch, nil)
		if err == nil || !strings.Contains(err.Error(), "verifier") {
			t.Fatalf("expected verifier tier error, got %v", err)
		}
	})

	t.Run("partial agentProfiles patch downgrading verifier profile tier", func(t *testing.T) {
		patch := map[string]any{
			"agentProfiles": []any{
				map[string]any{"id": "p-fast", "name": "Fast Coder", "provider": "pi", "tier": "fast"},
				map[string]any{"id": "p-std", "name": "Standard Coder", "provider": "codex", "tier": "standard"},
				map[string]any{"id": "p-strong", "name": "Strong Reviewer", "provider": "claude", "tier": "fast"},
			},
		}
		err := ValidateEffectiveDaemonConfig(existing, patch, nil)
		if err == nil || !strings.Contains(err.Error(), "verifier") {
			t.Fatalf("expected verifier tier error after profile downgrade, got %v", err)
		}
	})

	t.Run("partial agentProfiles patch upgrading author profile tier above verifier", func(t *testing.T) {
		base := baseChiefConfigForValidationTests()
		base["agentProfiles"] = []any{
			map[string]any{"id": "p-std", "name": "Author", "provider": "codex", "tier": "standard"},
			map[string]any{"id": "p-ver", "name": "Verifier", "provider": "claude", "tier": "standard"},
		}
		base["chief"] = map[string]any{
			"roles": map[string]any{
				"author":   map[string]any{"primaryProfileId": "p-std"},
				"verifier": map[string]any{"primaryProfileId": "p-ver"},
			},
		}
		patch := map[string]any{
			"agentProfiles": []any{
				map[string]any{"id": "p-std", "name": "Author", "provider": "codex", "tier": "strong"},
				map[string]any{"id": "p-ver", "name": "Verifier", "provider": "claude", "tier": "standard"},
			},
		}
		err := ValidateEffectiveDaemonConfig(base, patch, nil)
		if err == nil || !strings.Contains(err.Error(), "verifier") {
			t.Fatalf("expected verifier tier error after author upgrade, got %v", err)
		}
	})

	t.Run("partial agentProfiles patch removing referenced profile", func(t *testing.T) {
		patch := map[string]any{
			"agentProfiles": []any{
				map[string]any{"id": "p-fast", "name": "Fast Coder", "provider": "pi", "tier": "fast"},
				map[string]any{"id": "p-std", "name": "Standard Coder", "provider": "codex"},
			},
		}
		err := ValidateEffectiveDaemonConfig(existing, patch, nil)
		if err == nil || !strings.Contains(err.Error(), "unknown profile") {
			t.Fatalf("expected unknown profile error, got %v", err)
		}
	})
}

func TestValidateEffectiveDaemonConfigValidatesChiefShapesAndRefs(t *testing.T) {
	existing := baseChiefConfigForValidationTests()

	invalid := []struct {
		name  string
		patch map[string]any
		want  string
	}{
		{
			name: "invalid profile tier",
			patch: map[string]any{
				"agentProfiles": []any{
					map[string]any{"id": "p1", "name": "Bad", "provider": "pi", "tier": "turbo"},
				},
			},
			want: "tier",
		},
		{
			name: "empty string profile tier",
			patch: map[string]any{
				"agentProfiles": []any{
					map[string]any{"id": "p1", "name": "Bad", "provider": "pi", "tier": ""},
				},
			},
			want: "tier",
		},
		{
			name: "duplicate profile id",
			patch: map[string]any{
				"agentProfiles": []any{
					map[string]any{"id": "dup", "name": "One", "provider": "pi"},
					map[string]any{"id": "dup", "name": "Two", "provider": "codex"},
				},
			},
			want: "duplicate profile id",
		},
		{
			name:  "unknown fallback profile id",
			patch: map[string]any{"chief": map[string]any{"roles": map[string]any{"author": map[string]any{"fallbackProfileIds": []any{"missing"}}}}},
			want:  "unknown profile",
		},
		{
			name:  "empty primaryProfileId on existing role entry",
			patch: map[string]any{"chief": map[string]any{"roles": map[string]any{"chief": map[string]any{"primaryProfileId": ""}}}},
			want:  "primaryProfileId",
		},
		{
			name:  "invalid defaultTier",
			patch: map[string]any{"chief": map[string]any{"defaultTier": "L9"}},
			want:  "defaultTier",
		},
		{
			name:  "non-positive stall threshold",
			patch: map[string]any{"chief": map[string]any{"stall": map[string]any{"softWarningSec": 0}}},
			want:  "softWarningSec",
		},
		{
			name:  "fractional stall threshold",
			patch: map[string]any{"chief": map[string]any{"stall": map[string]any{"hardRecoverySec": 12.5}}},
			want:  "hardRecoverySec",
		},
		{
			name:  "hard stall below soft stall",
			patch: map[string]any{"chief": map[string]any{"stall": map[string]any{"softWarningSec": 900, "hardRecoverySec": 600}}},
			want:  "hardRecoverySec",
		},
		{
			name:  "invalid landing mode",
			patch: map[string]any{"chief": map[string]any{"landing": map[string]any{"mode": "force_push"}}},
			want:  "landing.mode",
		},
		{
			name:  "invalid landing strategy",
			patch: map[string]any{"chief": map[string]any{"landing": map[string]any{"strategy": "octopus"}}},
			want:  "landing.strategy",
		},
		{
			name:  "non-bool requireHumanApproval",
			patch: map[string]any{"chief": map[string]any{"landing": map[string]any{"requireHumanApproval": "yes"}}},
			want:  "requireHumanApproval",
		},
	}

	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateEffectiveDaemonConfig(existing, tc.patch, nil)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
		})
	}

	t.Run("missing primaryProfileId on brand new role entry", func(t *testing.T) {
		base := map[string]any{
			"agentProfiles": existing["agentProfiles"],
		}
		patch := map[string]any{
			"chief": map[string]any{
				"roles": map[string]any{
					"integrator": map[string]any{"fallbackProfileIds": []any{"p-strong"}},
				},
			},
		}
		err := ValidateEffectiveDaemonConfig(base, patch, nil)
		if err == nil || !strings.Contains(err.Error(), "primaryProfileId") {
			t.Fatalf("expected primaryProfileId error, got %v", err)
		}
	})
}

func TestValidateEffectiveDaemonConfigDoesNotMutateInputs(t *testing.T) {
	existing := baseChiefConfigForValidationTests()
	patch := map[string]any{
		"removeProviders": []any{"custom"},
		"chief":           map[string]any{"defaultTier": "L2"},
	}

	if err := ValidateEffectiveDaemonConfig(existing, patch, nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	providers, _ := existing["providers"].(map[string]any)
	if _, ok := providers["custom"]; !ok {
		t.Fatalf("ValidateEffectiveDaemonConfig mutated existing.providers: %#v", providers)
	}
	if _, ok := patch["removeProviders"]; !ok {
		t.Fatalf("ValidateEffectiveDaemonConfig mutated patch.removeProviders: %#v", patch)
	}
}

func TestValidateDaemonConfigBackwardsCompatForChiefAndProfiles(t *testing.T) {
	if err := ValidateDaemonConfig(map[string]any{
		"agentProfiles": []any{
			map[string]any{"name": "bad", "provider": "pi", "tier": "nope"},
		},
	}); err == nil {
		t.Fatal("expected invalid profile tier to be rejected")
	}

	if err := ValidateDaemonConfig(map[string]any{
		"chief": map[string]any{"defaultTier": "L3"},
	}); err == nil {
		t.Fatal("expected invalid chief.defaultTier to be rejected")
	}

	partial := map[string]any{
		"chief": map[string]any{
			"roles": map[string]any{
				"author": map[string]any{"primaryProfileId": "p-std"},
			},
		},
	}
	if err := ValidateDaemonConfig(partial); err != nil {
		t.Fatalf("standalone ValidateDaemonConfig should stay backward-compatible on partial patch: %v", err)
	}
	if err := ValidateEffectiveDaemonConfig(nil, partial, nil); err == nil {
		t.Fatal("ValidateEffectiveDaemonConfig must reject dangling profile ref when existing has no profiles")
	}
}
