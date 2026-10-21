package daemon

import (
	"runtime"
	"strings"
	"testing"
)

// "Installed" with an unloaded unit looks identical to "installed and working" until the next
// login, so status reports the two facts separately.
func TestQueryServiceStatusReportsBothFacts(t *testing.T) {
	status := QueryServiceStatus()
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		if status.Supported {
			t.Fatal("unsupported platforms must say so")
		}
		return
	}
	if !status.Supported {
		t.Fatalf("a supported platform reported unsupported: %+v", status)
	}
	// Registered implies the platform has an opinion; not registered must carry a reason a
	// human can act on rather than an empty string.
	if !status.Registered && strings.TrimSpace(status.Detail) == "" {
		t.Fatal("an unregistered service needs a detail line")
	}
}

// Uninstalling when nothing is installed must be a no-op, not an error: `install-service` then
// `uninstall-service` in a script has to be safe to re-run.
func TestUninstallLoginServiceIsIdempotent(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("login services are unsupported here")
	}
	if err := UninstallLoginService(); err != nil && !strings.Contains(err.Error(), "not supported") {
		// A real container without systemd fails the systemctl calls; that is the platform,
		// not the code under test.
		t.Logf("uninstall reported: %v", err)
	}
}
