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
	// Capabilities this build deliberately does not serve. Each one has a recorded reason; the
	// list is the answer to "why is this feature false".
	unimplemented := map[string]string{
		"hubAgentRpc":         "hub.* has no implementation, only the permission table",
		"hubRelationship":     "hub relationship management is absent",
		"directorySync":       "cross-host directory sync is undecided product work",
		"plugins":             "no plugin sandbox; the read-only endpoints return an empty list",
		"pluginManagement":    "no plugin runtime",
		"pluginGitManagement": "no plugin runtime",
		"pluginLogs":          "no plugin runtime",
		"pluginThemes":        "no plugin runtime",
		"pluginSettings":      "no plugin runtime",
		"pluginTimelineItems": "no plugin runtime",
		"daemonTunnels":       "TCP tunnels are not implemented (needs a second machine to verify)",
		"daemonSelfUpdate":    "no self-update path",
	}

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

	for name, reason := range unimplemented {
		value, present := rawFeatures[name]
		if !present {
			// Omitting the key is also honest — the client treats it as unsupported.
			continue
		}
		if value != false {
			t.Fatalf("feature %q is declared true but %s", name, reason)
		}
	}

	// And the features that ARE implemented must stay true, or the client disables working UI.
	for _, name := range []string{
		"workspaceLabels", "workspaceSetupRun", "providersSnapshot", "rewind",
		"agentHistorySearch", "providerSubagents", "workspaceTerminals",
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
