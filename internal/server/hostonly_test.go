package server

import (
	"os"
	"testing"
)

// DNS rebinding makes a loopback-bound daemon reachable as evil.example; the Host header is the
// only signal that the request did not come from the address it claims.
func TestHostAllowed(t *testing.T) {
	srv := &Server{}
	srv.allowedHostnames = []string{"byspace.example.com", ".corp.example"}

	cases := map[string]bool{
		"127.0.0.1:6778":           true,  // IP literal, cannot be rebound
		"[::1]:6778":               true,  // IPv6 loopback
		"localhost:6778":           true,  // loopback name
		"app.localhost":            true,  // *.localhost
		"byspace.example.com":      true,  // configured
		"byspace.example.com:6778": true,  // configured with port
		"node1.corp.example":       true,  // suffix rule
		"evil.example":             false, // rebound name
		"192.168.1.10":             true,  // IP literal
	}
	for host, want := range cases {
		if got := srv.hostAllowed(host); got != want {
			t.Fatalf("hostAllowed(%q) = %v, want %v", host, got, want)
		}
	}
}

// With no allow-list, the machine's own hostname stays reachable; unrelated names do not.
func TestHostAllowedWithoutConfig(t *testing.T) {
	srv := &Server{}
	machine, err := os.Hostname()
	if err != nil {
		t.Skip("hostname unavailable")
	}
	if !srv.hostAllowed(machine) {
		t.Fatalf("machine hostname %q should be allowed", machine)
	}
	if srv.hostAllowed("definitely-not-this-machine.example") {
		t.Fatal("an unrelated hostname must be rejected when no allow-list is configured")
	}
}

// "*" is the operator opting out behind their own proxy.
func TestHostAllowedWildcard(t *testing.T) {
	srv := &Server{}
	srv.allowedHostnames = []string{"*"}
	if !srv.hostAllowed("anything.example") {
		t.Fatal("wildcard allow-list must accept any host")
	}
}
