package server

import (
	"net"
	"testing"
)

// A running service's health is whether anything accepts connections on its port: "it started"
// and "it is serving" are different facts.
func TestIsPortOpen(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if !isPortOpen(port) {
		t.Fatal("a listening port must report open")
	}
	_ = ln.Close()

	// After closing, the port must report closed. Reuse the same number: nothing listens now.
	if isPortOpen(port) {
		t.Fatalf("port %d reported open after the listener closed", port)
	}

	// A port nothing ever bound is also closed (not an error).
	if isPortOpen(1) {
		t.Log("port 1 unexpectedly open; environment has a privileged listener")
	}
}
