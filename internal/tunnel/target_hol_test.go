package tunnel

import (
	"io"
	"net"
	"testing"
	"time"
)

// The target's HandleFrame runs on the shared sink read loop, which also carries terminal and file
// frames. Before the upstream writer was split per-stream, it called conn.Write inline: a dialled
// socket that filled its TCP window blocked that one loop, so every other stream's bytes stopped
// behind it. Here stream A's service never reads; stream B must still get its bytes echoed back.
func TestTargetSlowStreamDoesNotBlockOthers(t *testing.T) {
	requireTCP(t)
	// Service A accepts but never reads, so the target's writes to it fill and block.
	listenerA, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listenerA.Close()
	portA := listenerA.Addr().(*net.TCPAddr).Port
	go func() {
		conn, acceptErr := listenerA.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		select {} // hold the socket open, never read
	}()

	// Service B echoes.
	portB, stopB := startEchoService(t)
	defer stopB()

	target := NewTarget(func() bool { return true }, func() bool { return true }, loopbackAllowlist(portA, portB))
	defer target.Close()

	out := make(chan Frame, 256)
	send := func(frame Frame) error {
		select {
		case out <- frame:
		case <-time.After(3 * time.Second):
		}
		return nil
	}

	if _, err := target.Open("slow-a", portA, "", "", send); err != nil {
		t.Fatal(err)
	}
	if _, err := target.Open("fast-b", portB, "", "", send); err != nil {
		t.Fatal(err)
	}

	// Flood A past any TCP window so its writer blocks in conn.Write. HandleFrame must return for
	// every frame — it only enqueues now.
	const flood = 8 << 20
	payload := make([]byte, 64<<10)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for sent := 0; sent < flood; sent += len(payload) {
			target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: "slow-a", Payload: payload}, "", true, send)
		}
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("flooding stream A blocked the read loop")
	}

	// B's bytes must still cross and echo back even though A's writer is stuck.
	want := []byte("ping")
	target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: "fast-b", Payload: want}, "", true, send)

	var got []byte
	deadline := time.After(3 * time.Second)
	for string(got) != string(want) {
		select {
		case frame := <-out:
			if frame.TunnelID != "fast-b" {
				continue
			}
			if body, ok := downstreamPayload(frame); ok {
				got = append(got, body...)
			}
		case <-deadline:
			t.Fatalf("stream B stalled behind stream A: got %q want %q", got, want)
		}
	}
}

// A half-close queued behind writes must drain them before signalling EOF, so the service reads the
// whole request. This pins the ordering the upstream queue introduced.
func TestTargetHalfCloseDrainsQueuedWrites(t *testing.T) {
	requireTCP(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	received := make(chan string, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		body, _ := io.ReadAll(conn)
		received <- string(body)
		_, _ = conn.Write([]byte("done"))
	}()

	target := NewTarget(func() bool { return true }, func() bool { return true }, loopbackAllowlist(port))
	defer target.Close()
	out := make(chan Frame, 16)
	send := func(frame Frame) error { out <- frame; return nil }
	if _, err := target.Open("drain", port, "", "", send); err != nil {
		t.Fatal(err)
	}

	target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: "drain", Payload: []byte("hello ")}, "", true, send)
	target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: "drain", Payload: []byte("world")}, "", true, send)
	target.HandleFrame(Frame{Opcode: OpcodeClose, TunnelID: "drain", Payload: []byte{CloseWrite}}, "", true, send)

	select {
	case body := <-received:
		if body != "hello world" {
			t.Fatalf("half-close truncated the request: %q", body)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("service never saw EOF after queued writes")
	}
}
