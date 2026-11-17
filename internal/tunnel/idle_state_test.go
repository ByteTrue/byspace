package tunnel

import (
	"io"
	"net"
	"testing"
	"time"
)

// The idle sweep is hygiene, not a failure. A pooled database connection, an SSE subscription with
// no heartbeat, or a debugger parked at a breakpoint carries no bytes for long stretches while the
// forward is perfectly healthy. Reclaiming that socket must not paint the forward as errored: the
// listener is still up and the next connection works.
func TestIdleSweepDoesNotErrorTheForward(t *testing.T) {
	m := NewManager("peer-idle-state", "target-host", func(string, ...any) {})
	defer func() { _ = m.Close() }()
	m.idleTimeout.Store(int64(200 * time.Millisecond))
	if _, err := m.AddForward(ForwardConfig{RemotePort: 4110}); err != nil {
		t.Fatal(err)
	}
	localPort, ok := m.LocalPort(4110)
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
	// Prove the forward works, so the state under test is the connected one.
	if _, err := conn.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	echoed := make([]byte, 1)
	if _, err := io.ReadFull(conn, echoed); err != nil {
		t.Fatalf("stream never worked: %v", err)
	}
	if state, _ := m.forwardState(4110); state != StateConnected {
		t.Fatalf("want connected before the sweep, got %q", state)
	}

	// Wait for the sweep to reclaim the idle stream.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		live := len(m.streams)
		m.mu.Unlock()
		if live == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	m.mu.Lock()
	live := len(m.streams)
	m.mu.Unlock()
	if live != 0 {
		t.Fatal("idle stream was never reclaimed, so the state assertion proves nothing")
	}

	state, _ := m.forwardState(4110)
	if state == StateError {
		t.Fatalf("idle hygiene marked the forward errored (state=%q); an idle stream is not a failure", state)
	}
	m.mu.Lock()
	lastError := m.forwards[FormatEndpoint("", 4110)].lastError
	m.mu.Unlock()
	if lastError != "" {
		t.Fatalf("idle sweep left an error message on a healthy forward: %q", lastError)
	}
}
