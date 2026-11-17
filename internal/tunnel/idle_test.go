package tunnel

import (
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// A black-holed destination must fail the open within the dial budget, not pin the caller's stream
// for the OS default (minutes). 192.0.2.1 is TEST-NET-1 (RFC 5737): routable nowhere, so the SYN is
// dropped and only a timeout ends the dial.
func TestTargetDialRespectsTimeout(t *testing.T) {
	target := NewTarget(func() bool { return true }, func() bool { return true }, func() []Endpoint {
		return []Endpoint{{Host: "192.0.2.1", Port: 9}}
	})
	defer target.Close()
	target.dialTimeout = 300 * time.Millisecond

	start := time.Now()
	result, err := target.Open("dial-timeout", 9, "192.0.2.1", "", func(Frame) error { return nil })
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("Open returned an error: %v", err)
	}
	if result.Allowed {
		t.Fatal("a black-holed destination must not be allowed")
	}
	if elapsed > 3*time.Second {
		t.Fatalf("dial took %v, want it bounded by the dial timeout", elapsed)
	}
	if !strings.Contains(result.Reason, "Failed to connect") {
		t.Fatalf("reason should name the failed dial, got %q", result.Reason)
	}
	// Require a timeout specifically. A network that answers ICMP unreachable fails the dial
	// instantly, which would let this test pass with no dial timeout at all.
	if !strings.Contains(result.Reason, "i/o timeout") {
		t.Fatalf("dial failed for a reason other than the timeout, so this proves nothing: %q", result.Reason)
	}
	if target.ActiveStreams() != 0 {
		t.Fatalf("a failed dial must leave no stream, got %d", target.ActiveStreams())
	}
}

// A stream that carries no bytes is reclaimed after the idle timeout, releasing the dialled socket.
func TestTargetIdleStreamCloses(t *testing.T) {
	port, stop := startEchoService(t)
	defer stop()
	target := NewTarget(func() bool { return true }, func() bool { return true }, loopbackAllowlist(port))
	defer target.Close()
	target.idleTimeout.Store(int64(200 * time.Millisecond))

	opened, err := target.Open("idle-target", port, "", "", func(Frame) error { return nil })
	if err != nil || !opened.Allowed {
		t.Fatalf("open refused: %+v %v", opened, err)
	}
	if target.ActiveStreams() != 1 {
		t.Fatalf("want one live stream, got %d", target.ActiveStreams())
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if target.ActiveStreams() == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("idle stream was never reclaimed")
}

// The manager side of the same hygiene: an open stream with no traffic is dropped after the idle
// timeout, closing the local socket the client is holding.
func TestManagerIdleStreamCloses(t *testing.T) {
	m := NewManager("peer-idle", "target-host", func(string, ...any) {})
	defer func() { _ = m.Close() }()
	m.idleTimeout.Store(int64(200 * time.Millisecond))
	if _, err := m.AddForward(ForwardConfig{RemotePort: 4100}); err != nil {
		t.Fatal(err)
	}
	localPort, ok := m.LocalPort(4100)
	if !ok {
		t.Fatal("no local port")
	}
	peer, far := Pipe(16)
	stop := make(chan struct{})
	defer close(stop)
	echoPeer(far, stop)
	m.SetPeer(peer)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	// Prove the stream opened and worked, so the close below is the idle sweep, not a failed open.
	if _, err := conn.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	echoed := make([]byte, 1)
	if _, err := io.ReadFull(conn, echoed); err != nil {
		t.Fatalf("stream never worked, so idle teardown cannot be tested: %v", err)
	}

	// No further bytes: the idle sweep must close the local socket well before the read deadline.
	// A timeout error would mean the socket merely sat open until the deadline — not reclaimed.
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 1)
	readStart := time.Now()
	_, readErr := conn.Read(buf)
	if readErr == nil {
		t.Fatal("idle stream should have been closed")
	}
	if netErr, ok := readErr.(net.Error); ok && netErr.Timeout() {
		t.Fatal("read hit its deadline: the idle sweep never closed the socket")
	}
	if time.Since(readStart) > 2*time.Second {
		t.Fatalf("socket closed only after %v, too slow to be the idle sweep", time.Since(readStart))
	}
}

// Traffic in either direction keeps a stream alive past the idle timeout: the sweeper reclaims
// silence, not a slow but live connection.
func TestTargetActivityKeepsStreamAlive(t *testing.T) {
	port, stop := startEchoService(t)
	defer stop()
	target := NewTarget(func() bool { return true }, func() bool { return true }, loopbackAllowlist(port))
	defer target.Close()
	target.idleTimeout.Store(int64(300 * time.Millisecond))

	downstream := make(chan Frame, 64)
	send := func(frame Frame) error {
		select {
		case downstream <- frame:
		default:
		}
		return nil
	}
	opened, err := target.Open("active", port, "", "", send)
	if err != nil || !opened.Allowed {
		t.Fatalf("open refused: %+v %v", opened, err)
	}

	// Send a byte every 100ms for 600ms — well past the 300ms idle window — and read each echo.
	for i := 0; i < 6; i++ {
		target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: "active", Payload: []byte("x")}, "", true, send)
		select {
		case frame := <-downstream:
			if payload, ok := downstreamPayload(frame); !ok || string(payload) != "x" {
				t.Fatalf("want echo x, got %+v", frame)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("no echo")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if target.ActiveStreams() != 1 {
		t.Fatalf("active stream was reclaimed despite traffic, got %d streams", target.ActiveStreams())
	}
}

// Downstream bytes alone keep a stream alive. An SSE subscription or a log tail pushes for a long
// time while the client sends nothing, so stamping only the upstream direction would sweep it.
func TestTargetDownstreamOnlyActivityKeepsStreamAlive(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port
	// A service that only pushes: it never reads what the client sends.
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			if _, err := conn.Write([]byte("tick")); err != nil {
				return
			}
			time.Sleep(60 * time.Millisecond)
		}
	}()

	target := NewTarget(func() bool { return true }, func() bool { return true }, loopbackAllowlist(port))
	defer target.Close()
	target.idleTimeout.Store(int64(300 * time.Millisecond))

	downstream := make(chan Frame, 256)
	send := func(frame Frame) error {
		select {
		case downstream <- frame:
		default:
		}
		return nil
	}
	opened, err := target.Open("push-only", port, "", "", send)
	if err != nil || !opened.Allowed {
		t.Fatalf("open refused: %+v %v", opened, err)
	}

	// No upstream frames at all for twice the idle window; the pushes must keep it alive.
	deadline := time.After(700 * time.Millisecond)
	pushes := 0
	for {
		select {
		case <-downstream:
			pushes++
		case <-deadline:
			if pushes == 0 {
				t.Fatal("service never pushed, so the assertion proves nothing")
			}
			if target.ActiveStreams() != 1 {
				t.Fatalf("downstream-only stream was reclaimed after %d pushes, got %d streams", pushes, target.ActiveStreams())
			}
			return
		}
	}
}
