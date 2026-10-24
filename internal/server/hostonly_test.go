package server

import (
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

// With no allow-list the daemon is not restricted: the check exists for operators who opt in,
// not as a policy imposed on every install (the node daemon behaves the same way).
func TestHostAllowedWithoutConfig(t *testing.T) {
	srv := &Server{}
	if !srv.hostAllowed("anything.example") {
		t.Fatal("no allow-list means no restriction")
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
