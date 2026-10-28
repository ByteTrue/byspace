package providers

import "testing"

// A built-in that the manifest marks `enabledByDefault: false` must start off.
//
// The catalog hardcoded `enabled := true` for every built-in, so Oh My Pi appeared in the picker on
// a fresh home even though packages/protocol/src/provider-manifest.ts declares it off until the user
// opts in. The two had drifted because the manifest field has no Go counterpart.
func TestEnabledByDefaultMatchesTheManifest(t *testing.T) {
	// Only omp is off by default; everything else must stay on, or a fresh install loses providers.
	wantOff := map[string]bool{"omp": true}

	entries := BuildSnapshotEntries(nil, "", nil)
	byID := make(map[string]bool, len(entries))
	for _, entry := range entries {
		id, _ := entry["provider"].(string)
		enabled, _ := entry["enabled"].(bool)
		byID[id] = enabled
	}

	for _, spec := range BuiltinProviders {
		enabled, present := byID[spec.ID]
		if !present {
			t.Fatalf("%s is missing from the catalog", spec.ID)
		}
		if wantOff[spec.ID] && enabled {
			t.Fatalf("%s starts enabled; the manifest says enabledByDefault: false", spec.ID)
		}
		if !wantOff[spec.ID] && !enabled {
			t.Fatalf("%s starts disabled; every provider except omp is on by default", spec.ID)
		}
	}
}

// An explicit user switch still wins over the default.
func TestExplicitEnableOverridesTheDefault(t *testing.T) {
	overrides := map[string]any{"omp": map[string]any{"enabled": true}}
	entries := BuildSnapshotEntries(nil, "", overrides)
	for _, entry := range entries {
		if entry["provider"] != "omp" {
			continue
		}
		if entry["enabled"] != true {
			t.Fatal("turning omp on in config did not enable it")
		}
		return
	}
	t.Fatal("omp is missing from the catalog")
}
