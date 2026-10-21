package cli

import (
	"testing"
)

// An explicit address is the only candidate: the user said where to look, and silently falling
// through to another daemon would talk to the wrong one.
func TestDaemonHostCandidatesHonoursExplicit(t *testing.T) {
	got := daemonHostCandidates("127.0.0.1:9999")
	if len(got) != 1 || got[0] != "127.0.0.1:9999" {
		t.Fatalf("candidates = %v", got)
	}
}

// BYSPACE_HOST is explicit too, for the same reason.
func TestDaemonHostCandidatesHonoursEnv(t *testing.T) {
	t.Setenv("BYSPACE_HOST", "127.0.0.1:8888")
	got := daemonHostCandidates("")
	if len(got) != 1 || got[0] != "127.0.0.1:8888" {
		t.Fatalf("candidates = %v", got)
	}
}

// Without an explicit address the default TCP address is always a candidate, and the list is
// deduplicated because a daemon recording the default would otherwise appear twice.
func TestDaemonHostCandidatesAlwaysIncludesDefault(t *testing.T) {
	t.Setenv("BYSPACE_HOST", "")
	got := daemonHostCandidates("")
	found := false
	for _, candidate := range got {
		if candidate == DefaultTCPListen {
			found = true
		}
	}
	if !found {
		t.Fatalf("the default address is missing: %v", got)
	}

	seen := make(map[string]bool, len(got))
	for _, candidate := range got {
		if seen[candidate] {
			t.Fatalf("duplicate candidate %q in %v", candidate, got)
		}
		seen[candidate] = true
	}
}
