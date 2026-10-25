package workspace

import (
	"testing"
	"time"
)

// `cli_missing` means the tool is not installed; telling that user to "sign in" sends them to a command that
// does not exist.
func TestClassifyForgeAuth(t *testing.T) {
	cases := []struct {
		name          string
		hasRemote     bool
		cliPath       string
		authenticated bool
		probeErr      error
		want          ForgeAuthState
	}{
		{"no remote wins over everything", false, "/usr/bin/gh", true, nil, ForgeAuthNoRemote},
		{"missing cli", true, "", true, nil, ForgeAuthCLIMissing},
		{"blank cli path", true, "   ", true, nil, ForgeAuthCLIMissing},
		{"not signed in", true, "/usr/bin/gh", false, nil, ForgeAuthUnauthenticated},
		{"signed in", true, "/usr/bin/gh", true, nil, ForgeAuthAuthenticated},
		{"probe failed", true, "/usr/bin/gh", false, errString("network unreachable"), ForgeAuthError},
	}
	for _, c := range cases {
		got := ClassifyForgeAuth(c.hasRemote, c.cliPath, c.probeErr, c.authenticated)
		if got != c.want {
			t.Fatalf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// The five values are what the client's parser accepts; a typo here falls back to the legacy boolean and
// loses the distinction.
func TestForgeAuthStatesAreTheWireValues(t *testing.T) {
	for _, state := range []ForgeAuthState{
		ForgeAuthAuthenticated, ForgeAuthUnauthenticated, ForgeAuthCLIMissing, ForgeAuthNoRemote, ForgeAuthError,
	} {
		switch string(state) {
		case "authenticated", "unauthenticated", "cli_missing", "no_remote", "error":
		default:
			t.Fatalf("unexpected value %q", state)
		}
	}
}

type errString string

func (e errString) Error() string { return string(e) }

// WaitDelay alone does not bound a command that never answers: its timer only starts once the context is done
// or the process has exited. A probe without a real deadline would hang the whole PR status request.
func TestProbeIsBoundedByADeadline(t *testing.T) {
	const short = 150 * time.Millisecond
	original := forgeProbeDeadline
	forgeProbeDeadline = short
	t.Cleanup(func() { forgeProbeDeadline = original })

	start := time.Now()
	// `sleep 30` stands in for a CLI that answers only after a forge stops responding.
	_, _ = runForgeProbe(t.TempDir(), "sleep")
	elapsed := time.Since(start)
	if elapsed > 2*time.Second {
		t.Fatalf("the probe was not bounded: %s", elapsed)
	}
}
