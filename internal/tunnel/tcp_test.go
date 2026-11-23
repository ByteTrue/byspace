package tunnel

import (
	"os"
	"runtime"
	"testing"
)

// Windows can prompt for every newly built test binary that opens a TCP listener,
// even on loopback. Keep real-socket coverage in CI and make local runs prompt-free.
func requireTCP(t testing.TB) {
	t.Helper()
	if runtime.GOOS != "windows" || os.Getenv("CI") != "" || os.Getenv("BYSPACE_TCP_TESTS") == "1" {
		return
	}
	t.Skip("real TCP tests are skipped on local Windows to avoid firewall prompts; set BYSPACE_TCP_TESTS=1 to run them")
}
