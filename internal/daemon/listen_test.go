package daemon

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

// Ported from bootstrap.ts parseListenString: six accepted forms, and a Windows drive path
// must be rejected rather than silently treated as a socket name.
func TestParseListenTarget(t *testing.T) {
	cases := []struct {
		in   string
		kind string
		host string
		port int
		path string
	}{
		{"6778", "tcp", "127.0.0.1", 6778, ""},
		{"0.0.0.0:6777", "tcp", "0.0.0.0", 6777, ""},
		{"[::1]:6778", "tcp", "::1", 6778, ""},
		{"localhost:7000", "tcp", "localhost", 7000, ""},
		{"/tmp/byspace.sock", "socket", "", 0, "/tmp/byspace.sock"},
		{"unix:///var/run/byspace.sock", "socket", "", 0, "/var/run/byspace.sock"},
		{"pipe://byspace", "pipe", "", 0, "byspace"},
		{`\\.\pipe\byspace`, "pipe", "", 0, `\\.\pipe\byspace`},
	}
	for _, tc := range cases {
		got, err := ParseListenTarget(tc.in)
		if err != nil {
			t.Fatalf("%q: %v", tc.in, err)
		}
		if got.Kind != tc.kind || got.Host != tc.host || got.Port != tc.port || got.Path != tc.path {
			t.Fatalf("%q -> %+v, want kind=%s host=%s port=%d path=%s", tc.in, got, tc.kind, tc.host, tc.port, tc.path)
		}
	}
}

func TestParseListenTargetRejects(t *testing.T) {
	for _, in := range []string{"", "C:\\temp\\x", "nonsense", "127.0.0.1:abc", "0", "70000"} {
		if got, err := ParseListenTarget(in); err == nil {
			t.Fatalf("%q should be rejected, got %+v", in, got)
		}
	}
}

func TestListenTargetAddress(t *testing.T) {
	tcp, _ := ParseListenTarget("127.0.0.1:6778")
	if tcp.Address() != "127.0.0.1:6778" {
		t.Fatalf("tcp address = %q", tcp.Address())
	}
	sock, _ := ParseListenTarget("/tmp/a.sock")
	if sock.Address() != "/tmp/a.sock" {
		t.Fatalf("socket address = %q", sock.Address())
	}
}

// A socket file left by a crashed daemon must not block the next start.
func TestSocketListenReplacesStaleFile(t *testing.T) {
	// A short path: t.TempDir() on macOS is already longer than the 104-byte socket limit.
	shortRoot := "/tmp"
	if runtime.GOOS == "windows" {
		shortRoot = os.TempDir()
	}
	dir, err := os.MkdirTemp(shortRoot, "bys")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	target, err := ParseListenTarget(dir + "/b.sock")
	if err != nil {
		t.Fatal(err)
	}
	first, err := target.Listen()
	if err != nil {
		t.Fatalf("first listen: %v", err)
	}
	first.Close() // socket file stays on disk, like a crashed daemon

	second, err := target.Listen()
	if err != nil {
		t.Fatalf("second listen must reclaim the stale socket: %v", err)
	}
	second.Close()
}

// Overlong socket paths must fail with an actionable message, not a bare bind error.
func TestSocketPathTooLong(t *testing.T) {
	long := "/tmp/" + strings.Repeat("a", 200) + ".sock"
	target, err := ParseListenTarget(long)
	if err != nil {
		t.Fatal(err)
	}
	_, err = target.Listen()
	if err == nil {
		t.Fatal("expected an error for an overlong socket path")
	}
	if !strings.Contains(err.Error(), "platform limit") {
		t.Fatalf("expected an actionable message, got: %v", err)
	}
}
