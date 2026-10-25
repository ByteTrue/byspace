package daemon

import (
	"net"
	"strconv"
	"testing"
)

// A browser resolving "localhost" may pick ::1 while the daemon is bound to 127.0.0.1, and the
// failure reads as "host unreachable" rather than a connect error. Binding both loopback
// families removes the guess, so `http://localhost:<port>` works either way.
func TestListenBothFamiliesServesLoopback(t *testing.T) {
	// Find a free port first, then bind both families on it.
	probe, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()

	ln, err := listenBothFamilies(port)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	go func() {
		for {
			conn, acceptErr := ln.Accept()
			if acceptErr != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	reachedV4 := false
	for _, host := range []string{"127.0.0.1", "::1"} {
		conn, dialErr := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
		if dialErr != nil {
			// IPv6 may be unavailable in the sandbox; the IPv4 listener must still work.
			t.Logf("%s unreachable (acceptable when the family is disabled): %v", host, dialErr)
			continue
		}
		_ = conn.Close()
		if host == "127.0.0.1" {
			reachedV4 = true
		}
	}
	if !reachedV4 {
		t.Fatal("IPv4 loopback must always be served")
	}
}
