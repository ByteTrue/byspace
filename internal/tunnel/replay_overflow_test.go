package tunnel

import (
	"net"
	"testing"
	"time"
)

// TestReplayOverflowReleasesTheStream drives the target's replay buffer past its budget with a peer
// that never acknowledges, which is what a stalled or vanished peer looks like.
//
// The overflow path closes the stream. If it closes while still holding the stream's write lock, the
// pump parks forever on a lock it already owns. The map entry is deleted before that lock, so the
// shared read loop keeps working and the leak is invisible from the registry: the dialled socket
// stays open and both pumps run for the process lifetime. Target.Close walks the map, so it cannot
// reclaim them either.
//
// The local socket is the observable that distinguishes the two. conn.Close runs after the lock, so
// its peer sees EOF only when the overflow path actually finished.
func TestReplayOverflowReleasesTheStream(t *testing.T) {
	// A service that floods its response without reading, so the target's downstream replay buffer
	// is what fills up. Upstream must stay quiet: that queue has its own overflow path.
	service, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer service.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, err := service.Accept()
		if err != nil {
			return
		}
		accepted <- conn
		chunk := make([]byte, 64<<10)
		for {
			if _, err := conn.Write(chunk); err != nil {
				return
			}
		}
	}()
	port := service.Addr().(*net.TCPAddr).Port

	target := NewTarget(func() bool { return true }, func() bool { return true }, loopbackAllowlist(port))
	defer target.Close()

	// The peer accepts frames and drops them: no DataAck ever comes back, so the replay buffer
	// grows until it refuses another payload.
	send := func(Frame) error { return nil }
	target.HandleFrame(Frame{
		Opcode:   OpcodeOpen,
		TunnelID: "flood",
		Payload:  EncodeOpenPayload(port, ""),
	}, "owner", false, send)

	var serviceConn net.Conn
	select {
	case serviceConn = <-accepted:
	case <-time.After(3 * time.Second):
		t.Fatal("target never dialled the service")
	}
	defer serviceConn.Close()

	// The response floods on its own. Wait for the replay budget to be exceeded.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && target.ActiveStreams() != 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if target.ActiveStreams() != 0 {
		t.Fatal("replay overflow never released the stream")
	}

	_ = serviceConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 1)
	_, err = serviceConn.Read(buf)
	if err == nil {
		t.Fatal("socket still open after replay overflow")
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		t.Fatal("replay overflow parked before closing the socket: the pump deadlocked on its own write lock")
	}
}
