package tunnel

import (
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// startEchoService runs a TCP service that echoes whatever it receives, standing in for the dev
// server a tunnel exposes.
func startEchoService(t *testing.T) (port int, stop func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(conn)
		}
	}()
	return listener.Addr().(*net.TCPAddr).Port, func() { _ = listener.Close() }
}

// The three gates exist because a client can lie about all of them. Each denial names the gate
// that closed, since the client shows the reason verbatim.
func TestTargetOpenGates(t *testing.T) {
	port, stop := startEchoService(t)
	defer stop()
	allowed := []int{port}

	disabled := NewTarget(func() bool { return false }, func() bool { return true }, func() []int { return allowed })
	if result, _ := disabled.Open("", port, func(Frame) error { return nil }); result.Allowed {
		t.Fatal("a disabled host must refuse")
	} else if result.Reason == "" {
		t.Fatal("the refusal must say why")
	}

	noPassword := NewTarget(func() bool { return true }, func() bool { return false }, func() []int { return allowed })
	if result, _ := noPassword.Open("", port, func(Frame) error { return nil }); result.Allowed {
		t.Fatal("a host without a password must refuse")
	}

	notAllowed := NewTarget(func() bool { return true }, func() bool { return true }, func() []int { return []int{1, 2} })
	result, _ := notAllowed.Open("", port, func(Frame) error { return nil })
	if result.Allowed {
		t.Fatal("a port outside the allowlist must refuse")
	}
	if !strings.Contains(result.Reason, "allowlist") {
		t.Fatalf("the reason should mention the allowlist: %q", result.Reason)
	}

	ok := NewTarget(func() bool { return true }, func() bool { return true }, func() []int { return allowed })
	opened, _ := ok.Open("", port, func(Frame) error { return nil })
	if !opened.Allowed || opened.TunnelID == "" {
		t.Fatalf("an allowed port must open: %+v", opened)
	}
	ok.Close()
}

// The gate is read per request, so flipping it takes effect without a restart.
func TestTargetGatesAreReadPerRequest(t *testing.T) {
	port, stop := startEchoService(t)
	defer stop()

	enabled := false
	target := NewTarget(func() bool { return enabled }, func() bool { return true }, func() []int { return []int{port} })
	defer target.Close()

	if result, _ := target.Open("", port, func(Frame) error { return nil }); result.Allowed {
		t.Fatal("should be refused while disabled")
	}
	enabled = true
	if result, _ := target.Open("", port, func(Frame) error { return nil }); !result.Allowed {
		t.Fatalf("should be allowed once enabled: %s", result.Reason)
	}
}

// The full round trip: the target dials the service, and bytes sent as downstream frames come
// back as upstream frames.
func downstreamPayload(frame Frame) ([]byte, bool) {
	if frame.Opcode == OpcodeDataDownstream {
		return frame.Payload, true
	}
	if frame.Opcode != OpcodeDataDownstreamSeq {
		return nil, false
	}
	_, payload, ok := decodeSequencedPayload(frame.Payload)
	return payload, ok
}

func TestTargetForwardsBytes(t *testing.T) {
	port, stop := startEchoService(t)
	defer stop()

	target := NewTarget(func() bool { return true }, func() bool { return true }, func() []int { return []int{port} })
	defer target.Close()

	upstream := make(chan Frame, 16)
	send := func(frame Frame) error {
		select {
		case upstream <- frame:
		default:
		}
		return nil
	}

	opened, _ := target.Open("t1", port, send)
	if !opened.Allowed {
		t.Fatalf("open refused: %s", opened.Reason)
	}

	// The initiator's client sent "ping": that travels as upstream into the dialled socket.
	if err := sendUpstream(target, send, opened.TunnelID, []byte("ping")); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(5 * time.Second)
	var echoed []byte
	for len(echoed) < 4 {
		select {
		case frame := <-upstream:
			// The echo comes back as downstream, from the dialled socket to the initiator.
			if payload, ok := downstreamPayload(frame); ok {
				echoed = append(echoed, payload...)
			}
		case <-deadline:
			t.Fatalf("timed out with %q", echoed)
		}
	}
	if string(echoed) != "ping" {
		t.Fatalf("echoed %q", echoed)
	}
}

func TestTargetUpstreamHalfCloseKeepsResponse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.ReadAll(conn)
		_, _ = conn.Write([]byte("data: complete\n\ndata: [DONE]\n\n"))
	}()

	target := NewTarget(func() bool { return true }, func() bool { return true }, func() []int { return []int{port} })
	defer target.Close()
	frames := make(chan Frame, 16)
	send := func(frame Frame) error { frames <- frame; return nil }
	if _, err := target.Open("half-close", port, send); err != nil {
		t.Fatal(err)
	}
	target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: "half-close", Payload: []byte("request")}, send)
	target.HandleFrame(Frame{Opcode: OpcodeClose, TunnelID: "half-close", Payload: []byte{CloseWrite}}, send)

	var response []byte
	deadline := time.After(3 * time.Second)
	for {
		select {
		case frame := <-frames:
			if payload, ok := downstreamPayload(frame); ok {
				response = append(response, payload...)
			}
			if frame.Opcode == OpcodeClose {
				if string(response) != "data: complete\n\ndata: [DONE]\n\n" {
					t.Fatalf("upstream half-close truncated the response: %q", response)
				}
				return
			}
		case <-deadline:
			t.Fatalf("response did not finish after upstream half-close: %q", response)
		}
	}
}

func TestTargetResumeAcknowledgesExistingStream(t *testing.T) {
	target := NewTarget(func() bool { return true }, func() bool { return true }, func() []int { return []int{1} })
	stream := &targetStream{id: "resume", send: func(Frame) error { return nil }, resumable: true}
	target.streams["resume"] = stream
	frames := make(chan Frame, 1)
	target.HandleFrame(Frame{Opcode: OpcodeResume, TunnelID: "resume"}, func(frame Frame) error {
		frames <- frame
		return nil
	})
	select {
	case frame := <-frames:
		if frame.Opcode != OpcodeOpenAck {
			t.Fatalf("resume acknowledgement = %+v", frame)
		}
	case <-time.After(time.Second):
		t.Fatal("resume did not acknowledge")
	}
}

func TestTargetReconnectResumesPendingResponse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	write := make(chan string, 4)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		for chunk := range write {
			_, _ = conn.Write([]byte(chunk))
		}
	}()

	target := NewTarget(func() bool { return true }, func() bool { return true }, func() []int { return []int{port} })
	defer target.Close()

	// One send callback for the whole test: only the socket behind it changes, which is exactly
	// what a reconnect is.
	var mu sync.Mutex
	failing := true
	sent := make(chan Frame, 32)
	send := func(frame Frame) error {
		mu.Lock()
		fail := failing
		mu.Unlock()
		if fail {
			return errors.New("socket closed")
		}
		sent <- frame
		return nil
	}

	target.HandleFrame(Frame{
		Opcode:   OpcodeOpen,
		TunnelID: "resume",
		Payload:  append(EncodeOpenPayload(port), OpenResumeRequested),
	}, send)

	resume := func(fail bool, cursor uint64) {
		t.Helper()
		mu.Lock()
		failing = fail
		mu.Unlock()
		target.HandleFrame(Frame{Opcode: OpcodeResume, TunnelID: "resume"}, send)
		target.HandleFrame(Frame{Opcode: OpcodeResumeAck, TunnelID: "resume", Payload: encodeSequence(cursor)}, send)
	}

	// Two disconnect cycles. The second one is what a resume counter that only ever rose used to
	// break: the stream kept waiting for a replay that had already been skipped.
	for cycle, chunk := range []string{"first", "second"} {
		mu.Lock()
		failing = true
		mu.Unlock()
		write <- chunk
		waitForStream(t, target, "resume", func(stream *targetStream) bool {
			return stream.disconnected && stream.downstream.next == uint64(cycle+1)
		})
		resume(false, uint64(cycle))

		var payload []byte
		deadline := time.After(3 * time.Second)
		for string(payload) != chunk {
			select {
			case frame := <-sent:
				if frame.Opcode != OpcodeDataDownstreamSeq {
					continue
				}
				sequence, body, ok := decodeSequencedPayload(frame.Payload)
				if !ok {
					t.Fatalf("cycle %d: malformed sequenced frame", cycle)
				}
				if sequence != uint64(cycle) {
					t.Fatalf("cycle %d: replayed sequence %d, want %d", cycle, sequence, cycle)
				}
				payload = body
			case <-deadline:
				t.Fatalf("cycle %d: resumed response = %q, want %q", cycle, payload, chunk)
			}
		}
	}
}

// waitForStream polls a stream until the condition holds; the pumps are goroutines, so the test
// has to observe a state rather than receive a signal from inside them.
func waitForStream(t *testing.T, target *Target, tunnelID string, done func(*targetStream) bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		target.mu.Lock()
		stream := target.streams[tunnelID]
		target.mu.Unlock()
		if stream != nil {
			stream.writeMu.Lock()
			ok := done(stream)
			stream.writeMu.Unlock()
			if ok {
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("stream %s never reached the expected state", tunnelID)
}

// sendDownstream is HandleFrame with the send callback the target's pumps use.
func sendUpstream(target *Target, send func(Frame) error, tunnelID string, payload []byte) error {
	target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: tunnelID, Payload: payload}, send)
	return nil
}
