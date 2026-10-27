package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A feature flag is a promise. `server_info.features.x === true` makes the client render the
// entry point for x and call its RPCs; declaring a capability the daemon cannot serve puts a
// button in front of the user that answers "not implemented" or returns an empty list.
//
// This is the same defect the audit kept finding in individual handlers — a field that is present
// and plausible but whose value is a lie — applied to the one place the client reads first.
func TestDeclaredFeaturesAreImplemented(t *testing.T) {
	// Capabilities this build does not serve, split by WHY. The two reasons are not
	// interchangeable: "retired by decision" is finished work, "not yet ported" is a gap.
	retired := map[string]string{
		"hubAgentRpc":         "hub was removed by decision (issue 025, 446bc38a3d)",
		"hubRelationship":     "hub was removed by decision (issue 025)",
		"plugins":             "plugin system retired by decision (issue 025, a5c6bb6588)",
		"pluginManagement":    "plugin system retired by decision (issue 025)",
		"pluginGitManagement": "plugin system retired by decision (issue 025)",
		"pluginLogs":          "plugin system retired by decision (issue 025)",
		"pluginThemes":        "plugin system retired by decision (issue 025)",
		"pluginSettings":      "plugin system retired by decision (issue 025)",
		"pluginTimelineItems": "plugin system retired by decision (issue 025)",
	}
	// Every feature this daemon claims must have a real implementation behind it. An entry here
	// means "declared false because it is not built"; it is empty because nothing is left in that
	// state.
	notYetPorted := map[string]string{}

	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = srv.Close() }()

	payload := srv.buildServerInfoPayload()
	rawFeatures, ok := payload["features"].(map[string]any)
	if !ok {
		t.Fatal("server_info has no features map")
	}

	for _, group := range []map[string]string{retired, notYetPorted} {
		for name, reason := range group {
			value, present := rawFeatures[name]
			if !present {
				// Omitting the key is also honest — the client treats it as unsupported.
				continue
			}
			if value != false {
				t.Fatalf("feature %q is declared true but %s", name, reason)
			}
		}
	}

	// And the features that ARE implemented must stay true, or the client disables working UI.
	for _, name := range []string{
		"workspaceLabels", "workspaceSetupRun", "providersSnapshot", "rewind",
		"agentHistorySearch", "providerSubagents", "workspaceTerminals", "daemonTunnels",
		"daemonSelfUpdate",
	} {
		if rawFeatures[name] != true {
			t.Fatalf("feature %q should be true; the client would disable working UI", name)
		}
	}
}

// Every declared-true feature must have a handler registered for its message prefix, otherwise
// the flag and the router disagree.
func TestNoFeatureIsDeclaredWithoutAHandler(t *testing.T) {
	// Prefixes a feature implies. Kept explicit rather than derived: the mapping from a feature
	// name to its RPC prefix is a product decision, and inferring it from the name would be a
	// guess that silently passes.
	required := map[string]string{
		"workspaceLabels":    "workspace.label.",
		"workspaceSetupRun":  "workspace.setup",
		"workspaceTerminals": "terminal",
		"providerSubagents":  "agent.provider_subagents",
		"rewind":             "agent.rewind",
	}

	source, err := os.ReadFile(filepath.Join("server.go"))
	if err != nil {
		t.Skip("server.go not readable from here")
	}
	router := string(source)
	for feature, prefix := range required {
		if !strings.Contains(router, `"`+prefix) {
			t.Fatalf("feature %q is declared but no route mentions %q", feature, prefix)
		}
	}
}
