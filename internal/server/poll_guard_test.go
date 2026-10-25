package server

import (
	"os"
	"strings"
	"testing"
)

// A panic in one poll must not end the loop: the goroutine would die silently, the daemon would keep serving, and
// every subscription would stop updating with nothing to show for it.
func TestPollTickSurvivesAPanic(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	// A nil map is the classic poll-time panic; deleting from it must not escape the guard.
	srv.fileSubs = nil
	srv.diffSubs = nil

	// If the recover were missing, this call would panic and fail the test.
	srv.runPollTick()
	srv.runPlacementTick()
}

// The recover logs rather than swallowing: an invisible failure is what the guard exists to prevent.
func TestPollGuardLogsInsteadOfSwallowing(t *testing.T) {
	source := readSourceForTest(t, "runtime_services.go")
	for _, want := range []string{
		"subscription poll panicked",
		"workspace placement poll panicked",
		"debug.Stack()",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("the guard does not log %q", want)
		}
	}
}

// readSourceForTest reads a file from this package's directory.
func readSourceForTest(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(name)
	if err != nil {
		t.Skipf("cannot read %s: %v", name, err)
	}
	return string(raw)
}
