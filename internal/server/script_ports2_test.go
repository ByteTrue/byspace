package server

import (
	"os"
	"runtime"
	"testing"
)

func TestParsePortRange(t *testing.T) {
	r, err := ParsePortRange("3000-3010")
	if err != nil || r.Start != 3000 || r.End != 3010 {
		t.Fatalf("range: %+v %v", r, err)
	}
	// A single port is a range of one.
	r, err = ParsePortRange("8080")
	if err != nil || r.Start != 8080 || r.End != 8080 {
		t.Fatalf("single: %+v %v", r, err)
	}
	for _, bad := range []string{"", "abc", "10-5", "0-10", "1-70000", "-", "1-"} {
		if _, err := ParsePortRange(bad); err == nil {
			t.Fatalf("%q should have been rejected", bad)
		}
	}
}

// The first free port in the window wins, and already-assigned ports are skipped even if they
// are not bound yet.
func TestAllocateFromRange(t *testing.T) {
	a := newServicePortAllocator()
	port, err := a.AllocateFromRange(PortRange{Start: 42000, End: 42010}, nil)
	if err != nil {
		t.Skip("no free port in the test range:", err)
	}
	// Reserve it, then ask again: the allocator must move on.
	a.mu.Lock()
	a.assigned["w1:web"] = port
	a.mu.Unlock()

	next, err := a.AllocateFromRange(PortRange{Start: 42000, End: 42010}, nil)
	if err != nil {
		t.Skip("no second free port:", err)
	}
	if next == port {
		t.Fatalf("allocator returned the same port twice: %d", port)
	}
}

// A one-port range that is taken must fail rather than return something outside the window: the
// window exists because a firewall or port map only allows those ports.
func TestAllocateFromRangeExhausted(t *testing.T) {
	a := newServicePortAllocator()
	a.mu.Lock()
	a.assigned["w1:web"] = 42050
	a.mu.Unlock()
	if _, err := a.AllocateFromRange(PortRange{Start: 42050, End: 42050}, nil); err == nil {
		t.Fatal("expected exhaustion error")
	}
}

func TestAllocatePortFromScriptHelper(_ *testing.T) {
	if os.Getenv("BYSPACE_TEST_PORT_HELPER") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg != "--" || i+1 >= len(os.Args) {
			continue
		}
		if os.Args[i+1] == "fail" {
			os.Exit(3)
		}
		_, _ = os.Stdout.WriteString(os.Args[i+1])
		os.Exit(0)
	}
	os.Exit(2)
}

func portScriptHelperCommand(argument string) string {
	if runtime.GOOS == "windows" {
		return "& $env:BYSPACE_TEST_PORT_BINARY '-test.run=^TestAllocatePortFromScriptHelper$' -- " + argument
	}
	return "\"$BYSPACE_TEST_PORT_BINARY\" '-test.run=^TestAllocatePortFromScriptHelper$' -- " + argument
}

// The script's output is untrusted and becomes a bind port.
func TestAllocatePortFromScriptValidates(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("BYSPACE_TEST_PORT_HELPER", "1")
	t.Setenv("BYSPACE_TEST_PORT_BINARY", executable)
	scratch := t.TempDir()
	if p, err := AllocatePortFromScript(t.Context(), portScriptHelperCommand("4321"), scratch, "web", "w1", "main"); err != nil || p != 4321 {
		t.Fatalf("got %d %v", p, err)
	}
	if _, err := AllocatePortFromScript(t.Context(), portScriptHelperCommand("99999"), scratch, "web", "w1", "main"); err == nil {
		t.Fatal("out-of-range port must be rejected")
	}
	if _, err := AllocatePortFromScript(t.Context(), portScriptHelperCommand("hello"), scratch, "web", "w1", "main"); err == nil {
		t.Fatal("non-numeric output must be rejected")
	}
	if _, err := AllocatePortFromScript(t.Context(), portScriptHelperCommand("fail"), scratch, "web", "w1", "main"); err == nil {
		t.Fatal("a failing script must be reported")
	}
}
