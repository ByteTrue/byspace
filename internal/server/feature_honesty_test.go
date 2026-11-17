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
// Only runtime-state gates remain (app and daemon ship together, so always-on
// capabilities are unconditional). This test keeps the surviving gates honest.
func TestDeclaredFeaturesAreImplemented(t *testing.T) {
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

	// The tunnel registry is implemented; the gate reflects operator opt-in state.
	if rawFeatures["daemonTunnels"] != true {
		t.Fatalf("daemonTunnels should be true; the client would disable working UI")
	}
	if _, ok := rawFeatures["agentRoleNames"].([]string); !ok {
		t.Fatal("agentRoleNames must stay a role-name catalog")
	}
}

// Every declared-true feature must have a handler registered for its message prefix, otherwise
// the flag and the router disagree.
func TestNoFeatureIsDeclaredWithoutAHandler(t *testing.T) {
	// Prefixes a feature implies. Kept explicit rather than derived: the mapping from a feature
	// name to its RPC prefix is a product decision, and inferring it from the name would be a
	// guess that silently passes.
	required := map[string]string{
		"daemonTunnels": "tunnel.",
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
