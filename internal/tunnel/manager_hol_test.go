package tunnel

import (
	"io"
	"net"
	"testing"
	"time"
)

// A stream whose local socket never drains must not stall the shared read loop. Before the
// downstream writer was split per-stream, handleFrame called conn.Write inline: a local socket
// that filled its TCP window blocked the one pumpPeer goroutine, so every other stream's data and
// acks stopped behind it. Here stream A's client never reads; stream B must still get its bytes and
// its DataAck must still reach the peer.
func TestSlowStreamDoesNotBlockOthers(t *testing.T) {
	// The manager logs stream lifecycle through this writer, not t.Logf: a pump goroutine can still
	// be draining when the test returns, and logging through t after that races the test framework.
	// The assertions here are byte transfer and the DataAck, so the log text is discarded.
	m := NewManager("peer-hol", "", func(string, ...any) {})
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(ForwardConfig{RemotePort: 4000, Label: "a"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddForward(ForwardConfig{RemotePort: 4001, Label: "b"}); err != nil {
		t.Fatal(err)
	}
	portA, _ := m.LocalPort(4000)
	portB, _ := m.LocalPort(4001)

	// Capture every frame the manager sends so the test can read DataAck without a forwarding
	// goroutine that could itself mask a stall.
	out := make(chan Frame, 256)
	in := make(chan Frame, 64)
	m.SetPeer(&chanPeer{send: out, recv: in})

	// Stream A: a client that connects but never reads, so its local socket fills and stays full.
	connA, err := net.Dial("tcp", "127.0.0.1:"+itoa(portA))
	if err != nil {
		t.Fatal(err)
	}
	defer connA.Close()
	idA := waitStreamID(t, out)
	in <- Frame{Opcode: OpcodeOpenAck, TunnelID: idA, Payload: EncodeOpenAck(true, "")}

	// Fill A's local socket well past any TCP window so its writer blocks in conn.Write.
	const flood = 8 << 20
	filled := make(chan struct{})
	go func() {
		defer close(filled)
		payload := make([]byte, 64<<10)
		for sent := 0; sent < flood; sent += len(payload) {
			in <- Frame{Opcode: OpcodeDataDownstream, TunnelID: idA, Payload: payload}
		}
	}()
	select {
	case <-filled:
	case <-time.After(5 * time.Second):
		t.Fatal("flooding stream A did not complete")
	}

	// Stream B: a healthy client that reads its response.
	connB, err := net.Dial("tcp", "127.0.0.1:"+itoa(portB))
	if err != nil {
		t.Fatal(err)
	}
	defer connB.Close()
	idB := waitStreamID(t, out)
	in <- Frame{Opcode: OpcodeOpenAck, TunnelID: idB, Payload: EncodeOpenAck(true, "")}

	want := []byte("pong:ping")
	in <- Frame{Opcode: OpcodeDataDownstream, TunnelID: idB, Payload: want}

	// B's bytes must arrive even though A's writer is stuck.
	got := make([]byte, len(want))
	_ = connB.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.ReadFull(connB, got); err != nil {
		t.Fatalf("stream B stalled behind stream A: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("stream B got %q want %q", got, want)
	}

	// B's DataAck must also reach the peer; the old inline write blocked acks behind A too.
	deadline := time.After(3 * time.Second)
	acked := false
	for !acked {
		select {
		case f := <-out:
			if f.Opcode == OpcodeDataAck && f.TunnelID == idB {
				acked = true
			}
		case <-deadline:
			t.Fatal("stream B DataAck never reached the peer behind stuck stream A")
		}
	}

	// Quiesce before cleanup: stop the flood, close both client sockets so their upstream pumps see
	// EOF and exit, then wait for writeDone. Otherwise a pump outlives the test and logs through
	// t.Logf after it ends, which the race detector flags. The EOF path does not log.
	<-filled
	_ = connA.Close()
	_ = connB.Close()
	for _, id := range []string{idA, idB} {
		waitUpstreamDone(t, m, id)
	}
}

// waitUpstreamDone blocks until the stream's upstream pump has exited (writeDone closed), so no
// goroutine that logs through the test's t is still running when the test returns.
func waitUpstreamDone(t *testing.T, m *Manager, id string) {
	t.Helper()
	m.mu.Lock()
	var s *stream
	for _, f := range m.forwards {
		if cand, ok := f.streams[id]; ok {
			s = cand
			break
		}
	}
	m.mu.Unlock()
	if s == nil {
		return
	}
	select {
	case <-s.writeDone:
	case <-time.After(3 * time.Second):
		t.Fatalf("upstream pump for %s did not exit", id)
	}
}

// waitStreamID drains captured frames until the next Open and returns its tunnel id.
func waitStreamID(t *testing.T, out <-chan Frame) string {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case f := <-out:
			if f.Opcode == OpcodeOpen {
				return f.TunnelID
			}
		case <-deadline:
			t.Fatal("no Open frame captured")
		}
	}
}
