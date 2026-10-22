package cli

import "testing"

// An explicit address is the only candidate. Comparing its VALUE against the dev default instead of asking whether it
// was set made `--addr 127.0.0.1:6778` indistinguishable from "not passed", so the CLI fell through to the recorded
// address and then to the production daemon on 6777 — reporting "Invalid hello" from a daemon the user never named.
func TestDaemonHostCandidates(t *testing.T) {
	explicit := daemonHostCandidates("127.0.0.1:6778")
	if len(explicit) != 1 || explicit[0] != "127.0.0.1:6778" {
		t.Fatalf("explicit = %v", explicit)
	}

	// The dev default must not be special-cased into oblivion.
	if got := daemonHostCandidates(DefaultDevAddr); len(got) != 1 || got[0] != DefaultDevAddr {
		t.Fatalf("dev default = %v", got)
	}
}

// Without an explicit address the list starts with whatever the daemon recorded, then the production default.
func TestDaemonHostCandidatesWithoutExplicit(t *testing.T) {
	t.Setenv("BYSPACE_HOST", "")
	candidates := daemonHostCandidates("")
	if len(candidates) == 0 {
		t.Fatal("no candidates")
	}
	last := candidates[len(candidates)-1]
	if last != DefaultTCPListen {
		t.Fatalf("last candidate = %q, want %q", last, DefaultTCPListen)
	}
	// Deduplicated: the recorded address is often the default one.
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if seen[candidate] {
			t.Fatalf("duplicate candidate %q in %v", candidate, candidates)
		}
		seen[candidate] = true
	}
}

// BYSPACE_HOST overrides the recorded and default addresses.
func TestDaemonHostCandidatesHonoursEnv(t *testing.T) {
	t.Setenv("BYSPACE_HOST", "10.0.0.5:6778")
	got := daemonHostCandidates("")
	if len(got) != 1 || got[0] != "10.0.0.5:6778" {
		t.Fatalf("got %v", got)
	}
}
