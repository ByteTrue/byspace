package server

import "testing"

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

// The script's output is untrusted and becomes a bind port.
func TestAllocatePortFromScriptValidates(t *testing.T) {
	if p, err := AllocatePortFromScript(t.Context(), "echo 4321", "/tmp", "web", "w1", "main"); err != nil || p != 4321 {
		t.Fatalf("got %d %v", p, err)
	}
	// Out of range.
	if _, err := AllocatePortFromScript(t.Context(), "echo 99999", "/tmp", "web", "w1", "main"); err == nil {
		t.Fatal("out-of-range port must be rejected")
	}
	// Not a number.
	if _, err := AllocatePortFromScript(t.Context(), "echo hello", "/tmp", "web", "w1", "main"); err == nil {
		t.Fatal("non-numeric output must be rejected")
	}
	// Failing script.
	if _, err := AllocatePortFromScript(t.Context(), "exit 3", "/tmp", "web", "w1", "main"); err == nil {
		t.Fatal("a failing script must be reported")
	}
}
