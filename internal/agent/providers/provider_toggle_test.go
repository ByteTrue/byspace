package providers

import "testing"

// A scripted provider the user switched off must leave the catalog.
//
// The settings switch writes `providers.mock.enabled=false`, which went nowhere: the scripted
// entries hardcoded enabled=true, so the toggle snapped back on every render. Reported from a beta
// install as "provider cannot be closed".
func TestScriptedProviderRespectsTheEnabledSwitch(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")

	entry := func(entries []map[string]any, id string) map[string]any {
		for _, e := range entries {
			if e["provider"] == id {
				return e
			}
		}
		return nil
	}

	on := entry(BuildSnapshotEntries(nil, "", nil), MockProviderID)
	if on == nil {
		t.Fatal("the development build should list the scripted provider")
	}
	if on["enabled"] != true || on["status"] != "ready" {
		t.Fatalf("enabled=%v status=%v, want it ready by default", on["enabled"], on["status"])
	}

	off := entry(BuildSnapshotEntries(nil, "", map[string]any{
		MockProviderID: map[string]any{"enabled": false},
	}), MockProviderID)
	if off == nil {
		t.Fatal("the entry must stay listed so settings can switch it back on")
	}
	if off["enabled"] != false {
		t.Fatalf("enabled=%v after switching it off, want false", off["enabled"])
	}
	if off["status"] != "unavailable" {
		t.Fatalf("status=%v after switching it off, want unavailable", off["status"])
	}
}

// A provider switched off must not appear in a catalog twice.
//
// `mock` was emitted once as a scripted provider and again by the custom-provider loop, which keyed
// off the same config entry. Two rows with one id made the toggle look even more broken: one went
// off, the other stayed on.
func TestScriptedProviderAppearsOnce(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")

	entries := BuildSnapshotEntries(nil, "", map[string]any{
		MockProviderID: map[string]any{"enabled": false},
	})
	count := 0
	for _, e := range entries {
		if e["provider"] == MockProviderID {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("%q appears %d times in the catalog, want exactly 1", MockProviderID, count)
	}
}
