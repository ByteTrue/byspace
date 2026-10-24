package serviceproxy

import (
	"net"
	"testing"
)

// listenOnFreePort opens a listener on an OS-assigned port.
func listenOnFreePort(t *testing.T) (net.Listener, int) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return listener, listener.Addr().(*net.TCPAddr).Port
}
