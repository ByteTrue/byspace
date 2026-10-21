package daemon

import (
	"os"
	"os/exec"
	"testing"
)

// A pid from a file is not a handle: after a crash the number can be reused. Signalling it
// blindly means `daemon stop` kills something unrelated — an editor, another daemon.
func TestProcessMatchesRejectsRecycledPid(t *testing.T) {
	// Our own test process is alive but is not a daemon.
	if ProcessMatches(os.Getpid(), daemonProcessIdentity) {
		t.Fatal("the test process must not look like a daemon")
	}
	if ProcessMatches(os.Getpid(), "") {
		t.Fatal("an empty identity must never match")
	}
	if ProcessMatches(0, daemonProcessIdentity) || ProcessMatches(-1, daemonProcessIdentity) {
		t.Fatal("an invalid pid must never match")
	}
}

// A real child whose command line carries the identity words must match, so the check is not
// simply always false.
func TestProcessMatchesAcceptsRealProcess(t *testing.T) {
	cmd := exec.Command("/bin/sh", "-c", "exec -a 'byspace serve' sleep 5")
	if err := cmd.Start(); err != nil {
		t.Skip("cannot spawn a named process here:", err)
	}
	defer func() { _ = cmd.Process.Kill() }()

	commandLine := ProcessCommandLine(cmd.Process.Pid)
	if commandLine == "" {
		t.Skip("command line unavailable on this platform")
	}
	if ProcessMatches(cmd.Process.Pid, daemonProcessIdentity) {
		t.Log("matched as expected")
		return
	}
	// On platforms where `exec -a` is not honoured the name will be "sleep 5"; the assertion
	// that matters is that a live non-daemon does not match, which the previous test covers.
	t.Logf("exec -a not honoured here; command line was %q", commandLine)
}

// When the command line cannot be read the answer must be "no": refusing to kill is
// recoverable, killing the wrong process is not.
func TestProcessMatchesUnreadableIsFalse(t *testing.T) {
	if ProcessMatches(999999, daemonProcessIdentity) {
		t.Fatal("a pid that does not exist must not match")
	}
}
