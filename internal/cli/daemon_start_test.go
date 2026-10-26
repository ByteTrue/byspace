package cli

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/server"
)

// `daemon status` with no --addr must find the daemon this home recorded.
//
// The probe used to run against the raw flag, which is empty when omitted, so it failed with an
// empty URL and printed "stopped" for every running daemon. The address that works is in the PID
// lock the daemon wrote — the same one the rest of the CLI dials.
func TestDaemonStatusProbesTheAddressTheDaemonRecorded(t *testing.T) {
	homeDir := t.TempDir()
	srv, err := server.New(server.Options{HomeDir: filepath.Join(homeDir, "daemon"), Version: "9.9.9-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ts := httptest.NewServer(srv)
	defer ts.Close()
	addr := strings.TrimPrefix(ts.URL, "http://")
	if err := daemon.WritePIDLock(homeDir, daemon.PIDLockInfo{PID: os.Getpid(), Listen: &addr}); err != nil {
		t.Fatal(err)
	}

	var out, errOut bytes.Buffer
	if code := Main("9.9.9-test", []string{"daemon", "status", "--home", homeDir}, &out, &errOut); code != 0 {
		t.Fatalf("daemon status failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "running") || !strings.Contains(out.String(), srv.ServerID()) {
		t.Fatalf("output = %q, want the recorded daemon reported as running", out.String())
	}
}

// A home with no daemon must keep saying so instead of inventing one.
func TestDaemonStatusReportsStoppedWithoutADaemon(t *testing.T) {
	homeDir := t.TempDir()

	var out, errOut bytes.Buffer
	if code := Main("9.9.9-test", []string{"daemon", "status", "--home", homeDir}, &out, &errOut); code != 0 {
		t.Fatalf("daemon status failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "stopped") {
		t.Fatalf("output = %q, want stopped", out.String())
	}
}

// `daemon start` must listen where every other command looks.
//
// The dev port used to be the fallback, so a start with no flags bound 6778 while `daemon status`
// and `ls` fell through to 6777 and reported a stopped daemon that had just started.
func TestDefaultListenAddrUsesThePackagedPort(t *testing.T) {
	t.Setenv("BYSPACE_LISTEN", "")
	if got := defaultListenAddr(); got != DefaultTCPListen {
		t.Fatalf("defaultListenAddr() = %q, want %q", got, DefaultTCPListen)
	}

	candidates := daemonHostCandidates("")
	if len(candidates) == 0 || candidates[len(candidates)-1] != DefaultTCPListen {
		t.Fatalf("candidates = %v, want the packaged port last", candidates)
	}
}

// BYSPACE_LISTEN still wins: repository development sets it, and a service peer passes its port.
func TestDefaultListenAddrHonoursTheEnvironment(t *testing.T) {
	t.Setenv("BYSPACE_LISTEN", "0.0.0.0:9100")
	if got := defaultListenAddr(); got != "0.0.0.0:9100" {
		t.Fatalf("defaultListenAddr() = %q, want the env value", got)
	}
}

// The timeout message must describe this start, not the previous daemon's metrics.
func TestDaemonLogTailReadsOnlyWhatThisStartWrote(t *testing.T) {
	homeDir := t.TempDir()
	path := daemon.LogPath(homeDir)
	previous := `{"level":30,"msg":"ws_runtime_metrics","uptimeSeconds":13985}` + "\n"
	if err := os.WriteFile(path, []byte(previous), 0o600); err != nil {
		t.Fatal(err)
	}
	since := daemonLogSize(homeDir)

	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(
		`{"level":30,"msg":"ws_runtime_metrics","uptimeSeconds":1}` + "\n" +
			"bind: address already in use\n"); err != nil {
		t.Fatal(err)
	}
	file.Close()

	tail := daemonLogTail(homeDir, since)
	if !strings.Contains(tail, "address already in use") {
		t.Fatalf("tail = %q, want the failure line", tail)
	}
	if strings.Contains(tail, "13985") {
		t.Fatalf("tail = %q, want no lines from before this start", tail)
	}
	// Periodic metrics are noise in an error message even when this start wrote them.
	if strings.Contains(tail, "ws_runtime_metrics") {
		t.Fatalf("tail = %q, want the metrics lines filtered out", tail)
	}
}

// A start that writes nothing should say so rather than repeat older output.
func TestDaemonLogTailReportsAnEmptyStart(t *testing.T) {
	homeDir := t.TempDir()
	path := daemon.LogPath(homeDir)
	if err := os.WriteFile(path, []byte("old line\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if tail := daemonLogTail(homeDir, daemonLogSize(homeDir)); !strings.Contains(tail, "wrote nothing") {
		t.Fatalf("tail = %q, want the empty-start message", tail)
	}
}

// Without a recorded offset the whole log is still readable, minus the metrics.
func TestDaemonLogTailFallsBackToTheWholeLog(t *testing.T) {
	homeDir := t.TempDir()
	path := filepath.Join(homeDir, "daemon.log")
	if err := os.WriteFile(path, []byte("old line\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if tail := daemonLogTail(homeDir, 0); !strings.Contains(tail, "old line") {
		t.Fatalf("tail = %q, want the log contents", tail)
	}
}
