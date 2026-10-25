package daemon

import (
	"strings"
	"testing"
)

func TestRenderLaunchdPlistAndSystemdUnit(t *testing.T) {
	exe := "/usr/local/bin/byspace"
	args := []string{"serve", "--addr", "127.0.0.1:6777"}
	env := []string{"PATH=/usr/local/bin:/usr/bin", "BYSPACE_HOME=/Users/test/.byspace"}

	plist := RenderLaunchdPlist(exe, args, env, "/Users/test/Library/Logs/byspace/serve.log")
	if !strings.Contains(plist, LaunchdLabel) || !strings.Contains(plist, "127.0.0.1:6777") {
		t.Fatalf("unexpected plist output:\n%s", plist)
	}

	unit := RenderSystemdUnit(exe, args, env)
	if !strings.Contains(unit, `ExecStart="/usr/local/bin/byspace" serve "--addr" "127.0.0.1:6777"`) {
		t.Fatalf("unexpected systemd unit output:\n%s", unit)
	}
}
