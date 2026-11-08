package tunnel

import (
	"errors"
	"io"
	"net"
	"strings"
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
			if frame.Opcode == OpcodeDataDownstream {
				echoed = append(echoed, frame.Payload...)
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
			if frame.Opcode == OpcodeDataDownstream {
				response = append(response, frame.Payload...)
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

func TestTargetReconnectResumesPendingResponse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	startResponse := make(chan struct{})
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		<-startResponse
		_, _ = conn.Write([]byte("first"))
		_, _ = conn.Write([]byte("second"))
	}()

	target := NewTarget(func() bool { return true }, func() bool { return true }, func() []int { return []int{port} })
	defer target.Close()
	if _, err := target.Open("resume", port, func(Frame) error {
		return errors.New("old socket closed")
	}); err != nil {
		t.Fatal(err)
	}
	close(startResponse)
	target.Detach(func(Frame) error { return errors.New("old socket closed") })
	newFrames := make(chan Frame, 8)
	if _, err := target.Open("resume", port, func(frame Frame) error {
		newFrames <- frame
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var response []byte
	deadline := time.After(3 * time.Second)
	for string(response) != "firstsecond" {
		select {
		case frame := <-newFrames:
			if frame.Opcode == OpcodeDataDownstream {
				response = append(response, frame.Payload...)
			}
		case <-deadline:
			t.Fatalf("resumed response = %q", response)
		}
	}
}

// sendDownstream is HandleFrame with the send callback the target's pumps use.
func sendUpstream(target *Target, send func(Frame) error, tunnelID string, payload []byte) error {
	target.HandleFrame(Frame{Opcode: OpcodeDataUpstream, TunnelID: tunnelID, Payload: payload}, send)
	return nil
}
