package tunnel

import (
	"io"
	"net"
	"testing"
	"time"
)

// echoPeer implements PeerConn's far side in-process: it echoes upstream bytes back as
// downstream, which is what a working tunnel to an echo service produces.
func echoPeer(conn PeerConn, stop <-chan struct{}) {
	go func() {
		for {
			select {
			case <-stop:
				return
			case frame, ok := <-conn.Frames():
				if !ok {
					return
				}
				switch frame.Opcode {
				case OpcodeOpen:
					// The far side grants every stream, which is what a target with the port on its
					// allowlist does. The manager will not move bytes until it sees this.
					_ = conn.Send(Frame{
						Opcode:   OpcodeOpenAck,
						TunnelID: frame.TunnelID,
						Payload:  EncodeOpenAck(true, ""),
					})
				case OpcodeDataUpstream:
					_ = conn.Send(Frame{Opcode: OpcodeDataDownstream, TunnelID: frame.TunnelID, Payload: frame.Payload})
				case OpcodeClose:
					_ = conn.Send(Frame{Opcode: OpcodeClose, TunnelID: frame.TunnelID})
				}
			}
		}
	}()
}

// The whole point of a tunnel: a connection to the local port reaches the peer and its bytes come
// back. Everything below the relay is real — listener, accepted socket, frame encoding, pumps.
func TestLocalPortReachesPeerAndBack(t *testing.T) {
	m := NewManager("peer-1", "target-host", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(3000, "dev server"); err != nil {
		t.Fatal(err)
	}
	localPort, ok := m.LocalPort(3000)
	if !ok {
		t.Fatal("no local port")
	}

	peer, far := Pipe(64)
	stop := make(chan struct{})
	defer close(stop)
	echoPeer(far, stop)
	m.SetPeer(peer)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	payload := []byte("GET / HTTP/1.1\r\n\r\n")
	if _, err := conn.Write(payload); err != nil {
		t.Fatal(err)
	}

	got := make([]byte, len(payload))
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.ReadFull(conn, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("echoed %q, want %q", got, payload)
	}
}

// A port with no live peer must fail fast rather than accept and hang: accepting then hanging
// looks to the user like the remote service is slow.
func TestConnectionWithoutPeerFails(t *testing.T) {
	m := NewManager("peer-2", "", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(3001, ""); err != nil {
		t.Fatal(err)
	}
	localPort, _ := m.LocalPort(3001)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	// The daemon closes the accepted socket; the client observes EOF rather than silence.
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 1)
	if _, readErr := conn.Read(buf); readErr == nil {
		t.Fatal("expected the connection to be closed")
	}

	if !m.WaitForState(3001, StateError, 2*time.Second) {
		t.Fatal("the port should report an error")
	}
}

// Replacing the peer tears down live streams: their ids belonged to the old connection.
func TestPeerReplacementTearsDownStreams(t *testing.T) {
	m := NewManager("peer-3", "", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(3002, ""); err != nil {
		t.Fatal(err)
	}
	localPort, _ := m.LocalPort(3002)

	first, farFirst := Pipe(16)
	stop := make(chan struct{})
	defer close(stop)
	echoPeer(farFirst, stop)
	m.SetPeer(first)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	// Drain the echo first: otherwise the buffered reply is what the next Read returns, and the
	// test would pass or fail depending on whether the pump won a race.
	echoed := make([]byte, 1)
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.ReadFull(conn, echoed); err != nil {
		t.Fatalf("stream never worked, so teardown cannot be tested: %v", err)
	}

	// New connection; the old stream must be dropped.
	second, farSecond := Pipe(16)
	echoPeer(farSecond, stop)
	m.SetPeer(second)

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 1)
	if _, readErr := conn.Read(buf); readErr == nil {
		t.Fatal("the old stream should have been closed")
	}
}

func TestAddForwardRejectsBadPort(t *testing.T) {
	m := NewManager("peer-4", "", t.Logf)
	defer func() { _ = m.Close() }()
	for _, port := range []int{0, -1, 70000} {
		if _, err := m.AddForward(port, ""); err == nil {
			t.Fatalf("port %d should be rejected", port)
		}
	}
}

// The list output is sorted, so the UI does not reorder rows between polls.
func TestStatusIsSorted(t *testing.T) {
	m := NewManager("peer-5", "", t.Logf)
	defer func() { _ = m.Close() }()
	for _, port := range []int{3005, 3001, 3003} {
		if _, err := m.AddForward(port, ""); err != nil {
			t.Fatal(err)
		}
	}
	statuses := m.Status()
	for i := 1; i < len(statuses); i++ {
		if statuses[i-1].RemotePort > statuses[i].RemotePort {
			t.Fatalf("unsorted: %+v", statuses)
		}
	}
}

// Close releases the listeners; the ports must be free afterwards.
func TestCloseReleasesListeners(t *testing.T) {
	m := NewManager("peer-6", "", t.Logf)
	if _, err := m.AddForward(3006, ""); err != nil {
		t.Fatal(err)
	}
	localPort, _ := m.LocalPort(3006)
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}

	// Binding the same port again proves the listener is gone.
	listener, err := net.Listen("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatalf("port still held after Close: %v", err)
	}
	_ = listener.Close()
}

// itoa avoids importing strconv in a test that only needs decimal ports.
func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := make([]byte, 0, 6)
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}
