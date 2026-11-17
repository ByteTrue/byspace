package tunnel

import (
	"net"
	"strconv"
	"testing"
	"time"
)

// TestTargetKillReachesTheClient checks that a stream the target tears down ends the client's read.
//
// The target closes its own socket but used to tell the peer nothing. The manager kept the local
// socket open, so a client waiting on a response hung until the manager's own idle sweep — hours —
// or gave up. A kill has to be visible on both ends, otherwise the backpressure trade (drop one slow
// stream rather than stall the socket) reads as a hang instead of an error.
func TestTargetKillReachesTheClient(t *testing.T) {
	// A service that accepts and then goes silent, so the only thing that can end the client's read
	// is a Close travelling back from the target.
	service, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer service.Close()
	go func() {
		conn, err := service.Accept()
		if err != nil {
			return
		}
		// Hold it open without answering.
		buf := make([]byte, 1)
		_, _ = conn.Read(buf)
		_ = conn.Close()
	}()
	port := service.Addr().(*net.TCPAddr).Port

	manager, target, _ := wireManagerToTarget(t, []Endpoint{{Port: port}})
	if _, err := manager.AddForward(ForwardConfig{RemotePort: port, Label: "silent"}); err != nil {
		t.Fatalf("add forward: %v", err)
	}
	localPort, ok := manager.LocalPort(port)
	if !ok {
		t.Fatal("no local listener")
	}
	conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(localPort)))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Wait for the stream to exist on the target, then kill it there.
	var id string
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		target.mu.Lock()
		for key := range target.streams {
			id = key
		}
		target.mu.Unlock()
		if id != "" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("target never opened the stream")
	}

	target.mu.Lock()
	stream := target.streams[id]
	target.mu.Unlock()
	stream.closeReason.Store("upstream buffer exceeded 16 MiB")
	target.closeStream(stream)

	// The client's read must end promptly, not sit until a read deadline hours away.
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 1)
	_, err = conn.Read(buf)
	if err == nil {
		t.Fatal("client read returned data after the target killed the stream")
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		t.Fatal("target kill never reached the client: the local socket stayed open")
	}
}
