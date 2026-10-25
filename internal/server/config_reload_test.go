package server

import "testing"

// The settings page needs all three buckets. Returning empty lists made every change look
// equally "not applied", so the user could not tell why an edit did nothing.
func TestConfigReloadReportBuckets(t *testing.T) {
	// The listen address is only "owned by the environment" when BYSPACE_LISTEN is actually set;
	// without it the edit is the daemon's to make, and reporting an override would send the user
	// hunting for a variable that is not there.
	t.Setenv("BYSPACE_LISTEN", "127.0.0.1:6778")
	report := configReloadReport(nil, nil, []string{
		"daemon.relay.enabled",      // reloadable
		"daemon.appendSystemPrompt", // reloadable
		"daemon.listen",             // environment owns it
		"daemon.port",               // restart required
	})

	applied := report["appliedPaths"].([]string)
	restart := report["restartRequiredPaths"].([]string)
	overridden := report["overrideControlledPaths"].([]string)

	if len(applied) != 2 || applied[0] != "daemon.appendSystemPrompt" {
		t.Fatalf("applied = %v", applied)
	}
	if len(restart) != 1 || restart[0] != "daemon.port" {
		t.Fatalf("restart = %v", restart)
	}
	if len(overridden) != 1 || overridden[0] != "daemon.listen" {
		t.Fatalf("overridden = %v", overridden)
	}
}

// A nested setting counts as reloadable when its parent prefix is reloadable: the client only
// sends leaf paths, and `daemon.relay.endpoint` arrives as exactly that, but
// `daemon.mcp.injectIntoAgents` must also match `daemon.mcp`.
func TestConfigReloadReportMatchesPrefixes(t *testing.T) {
	report := configReloadReport(nil, nil, []string{"daemon.mcp.injectIntoAgents"})
	if applied := report["appliedPaths"].([]string); len(applied) != 1 {
		t.Fatalf("expected daemon.mcp.injectIntoAgents to be reloadable, got %v", applied)
	}
}

// Only paths whose values actually changed are reported; touching a setting and saving the same
// value must not claim it was applied.
func TestDiffConfigPathsOnlyChanged(t *testing.T) {
	previous := map[string]any{
		"daemon": map[string]any{"appendSystemPrompt": "zh", "relay": map[string]any{"enabled": true}},
	}
	next := map[string]any{
		"daemon": map[string]any{"appendSystemPrompt": "en", "relay": map[string]any{"enabled": true}},
	}
	changed := diffConfigPaths(previous, next)
	if len(changed) != 1 || changed[0] != "daemon.appendSystemPrompt" {
		t.Fatalf("changed = %v", changed)
	}

	// A removed key is a change too.
	changed = diffConfigPaths(previous, map[string]any{"daemon": map[string]any{}})
	if len(changed) != 2 {
		t.Fatalf("removals must be reported, got %v", changed)
	}
}

// JSON comparison, not Go equality: config values decode into `any`, so 1 and 1.0 are the same
// setting and must not be reported as a change.
func TestValuesEqualAcrossNumericTypes(t *testing.T) {
	if !valuesEqual(1, 1.0) {
		t.Fatal("1 and 1.0 are the same config value")
	}
	if valuesEqual(nil, false) {
		t.Fatal("nil and false differ")
	}
}

// Without the variable present the daemon owns the setting, so the change is the daemon's to make.
// Claiming an override on a daemon started with no BYSPACE_* told the user their edit was ignored
// when it had in fact applied.
func TestConfigReloadReportNeedsTheEnvVarToClaimAnOverride(t *testing.T) {
	report := configReloadReport(nil, nil, []string{"daemon.listen"})

	if overridden := report["overrideControlledPaths"].([]string); len(overridden) != 0 {
		t.Fatalf("overridden = %v, want none without BYSPACE_LISTEN", overridden)
	}
	if restart := report["restartRequiredPaths"].([]string); len(restart) != 1 {
		t.Fatalf("restart = %v, want the listen change to need a restart", restart)
	}
}

// BYSPACE_PASSWORD="" is how a shell clears a variable; it does not mean the environment owns the
// password. A set-but-blank value must therefore fall through to "restart required".
func TestConfigReloadReportBlankPasswordIsNotAnOverride(t *testing.T) {
	t.Setenv("BYSPACE_PASSWORD", "   ")

	report := configReloadReport(nil, nil, []string{"daemon.auth.password"})
	if overridden := report["overrideControlledPaths"].([]string); len(overridden) != 0 {
		t.Fatalf("overridden = %v, want none for a blank password", overridden)
	}

	t.Setenv("BYSPACE_PASSWORD", "hunter2")
	report = configReloadReport(nil, nil, []string{"daemon.auth.password"})
	if overridden := report["overrideControlledPaths"].([]string); len(overridden) != 1 {
		t.Fatalf("overridden = %v, want the password the environment set", overridden)
	}
}
