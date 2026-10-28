package tunnel

import (
	"bytes"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"
)

// The layout is `opcode | idLen | id | payload`, matching the TypeScript codec byte for byte.
// A Go daemon and a TypeScript client interoperate, so the bytes are not free to change.
func TestFrameRoundTrip(t *testing.T) {
	payload := []byte("hello bytes")
	encoded, err := EncodeFrame(OpcodeDataUpstream, "stream-1", payload)
	if err != nil {
		t.Fatal(err)
	}
	if encoded[0] != OpcodeDataUpstream {
		t.Fatalf("opcode = %#x", encoded[0])
	}
	if int(encoded[1]) != len("stream-1") {
		t.Fatalf("idLen = %d", encoded[1])
	}
	if string(encoded[2:2+len("stream-1")]) != "stream-1" {
		t.Fatalf("id = %q", encoded[2:2+len("stream-1")])
	}
	if !bytes.Equal(encoded[2+len("stream-1"):], payload) {
		t.Fatal("payload mismatch")
	}

	decoded, ok := DecodeFrame(encoded)
	if !ok {
		t.Fatal("decode failed")
	}
	if decoded.Opcode != OpcodeDataUpstream || decoded.TunnelID != "stream-1" {
		t.Fatalf("decoded %+v", decoded)
	}
	if !bytes.Equal(decoded.Payload, payload) {
		t.Fatalf("payload = %q", decoded.Payload)
	}
}

// A close frame carries no payload.
func TestCloseFrameHasNoPayload(t *testing.T) {
	encoded, err := EncodeFrame(OpcodeClose, "s", nil)
	if err != nil {
		t.Fatal(err)
	}
	decoded, ok := DecodeFrame(encoded)
	if !ok || decoded.Opcode != OpcodeClose || len(decoded.Payload) != 0 {
		t.Fatalf("%+v ok=%v", decoded, ok)
	}
}

// The demultiplexer tries each opcode family in turn, so "not a tunnel frame" must be a plain
// false rather than an error.
func TestDecodeRejectsForeignFrames(t *testing.T) {
	cases := [][]byte{
		nil,
		{0x20},                 // too short
		{0x01, 0x02, 'a', 'b'}, // terminal opcode
		{0x10, 0x02, 'a', 'b'}, // file-transfer opcode
		{0x20, 0x00},           // zero-length id
		{0x20, 0x05, 'a'},      // id longer than the buffer
	}
	for _, data := range cases {
		if _, ok := DecodeFrame(data); ok {
			t.Fatalf("decoded %v as a tunnel frame", data)
		}
	}
}

func TestEncodeRejectsBadIDs(t *testing.T) {
	if _, err := EncodeFrame(OpcodeDataUpstream, "", nil); err == nil {
		t.Fatal("empty id must fail")
	}
	long := strings.Repeat("x", MaxTunnelIDLength+1)
	if _, err := EncodeFrame(OpcodeDataUpstream, long, nil); err == nil {
		t.Fatal("over-long id must fail")
	}
	// Exactly at the limit is fine: the length fits in one byte.
	if _, err := EncodeFrame(OpcodeDataUpstream, strings.Repeat("x", MaxTunnelIDLength), nil); err != nil {
		t.Fatalf("id at the limit: %v", err)
	}
}

// The decoder copies the payload; the websocket reader reuses its buffer.
func TestDecodeCopiesPayload(t *testing.T) {
	encoded, err := EncodeFrame(OpcodeDataUpstream, "s", []byte("abc"))
	if err != nil {
		t.Fatal(err)
	}
	decoded, ok := DecodeFrame(encoded)
	if !ok {
		t.Fatal("decode failed")
	}
	for i := range encoded {
		encoded[i] = 0xFF
	}
	if string(decoded.Payload) != "abc" {
		t.Fatalf("payload aliased the input buffer: %q", decoded.Payload)
	}
}

// An open must reach the target and the bytes must cross, with one manager and one target wired
// back to back over a loopback PeerConn.
//
// This is the test the two-daemon failure needed: the port forward, the dial and the open
// handshake all worked on their own, and still not one byte crossed, because each end listened for
// the direction the other one sent. A single-end test cannot see that.
func TestManagerAndTargetExchangeBytes(t *testing.T) {
	// A real TCP service for the target to dial.
	service, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = service.Close() }()
	servicePort := service.Addr().(*net.TCPAddr).Port
	go func() {
		for {
			conn, acceptErr := service.Accept()
			if acceptErr != nil {
				return
			}
			go func() {
				defer func() { _ = conn.Close() }()
				buf := make([]byte, 16)
				n, _ := conn.Read(buf)
				if n > 0 {
					_, _ = conn.Write([]byte("pong:" + string(buf[:n])))
				}
			}()
		}
	}()

	manager, target, _ := wireManagerToTarget(t, servicePort)

	if _, err := manager.AddForward(servicePort, "echo"); err != nil {
		t.Fatal(err)
	}
	localPort, ok := manager.LocalPort(servicePort)
	if !ok {
		t.Fatal("no local listener")
	}

	client, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Close() }()
	if _, err := client.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}

	_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
	got := make([]byte, 16)
	n, err := client.Read(got)
	if err != nil {
		t.Fatalf("read back through the tunnel: %v", err)
	}
	if string(got[:n]) != "pong:ping" {
		t.Fatalf("tunnel returned %q, want the service's reply", got[:n])
	}
	_ = target
}

// wireManagerToTarget builds a manager and a target joined by an in-memory PeerConn.
//
// Frames from the manager are handed to the target and the target's replies come back into the
// manager, which is the same shape the relay produces. Nothing is stubbed at the tunnel layer, so a
// direction or opcode mismatch between the two shows up here.
func wireManagerToTarget(t *testing.T, allowedPort int) (*Manager, *Target, chan struct{}) {
	t.Helper()
	toTarget := make(chan Frame, 64)
	toManager := make(chan Frame, 64)
	stop := make(chan struct{})

	manager := NewManager("peer-test", "target-host", t.Logf)
	target := NewTarget(
		func() bool { return true },
		func() bool { return true },
		func() []int { return []int{allowedPort} },
	)
	t.Cleanup(func() {
		close(stop)
		_ = manager.Close()
		target.Close()
	})

	// Manager sees one PeerConn whose Frames() are the target's replies.
	manager.SetPeer(&chanPeer{send: toTarget, recv: toManager})

	// Drive the target from the manager's outgoing frames.
	go func() {
		for {
			select {
			case <-stop:
				return
			case frame := <-toTarget:
				target.HandleFrame(frame, func(outgoing Frame) error {
					select {
					case toManager <- outgoing:
					case <-stop:
					}
					return nil
				})
			}
		}
	}()
	return manager, target, stop
}

// chanPeer is a PeerConn backed by channels.
type chanPeer struct {
	send chan<- Frame
	recv <-chan Frame
}

func (p *chanPeer) Send(frame Frame) error {
	p.send <- frame
	return nil
}
func (p *chanPeer) Frames() <-chan Frame { return p.recv }
func (p *chanPeer) Err() error           { return nil }
func (p *chanPeer) Close() error         { return nil }

// An open acknowledgement survives the wire round trip in both outcomes.
func TestOpenAckRoundTrip(t *testing.T) {
	allowed, reason, ok := DecodeOpenAck(EncodeOpenAck(true, ""))
	if !ok || !allowed || reason != "" {
		t.Fatalf("grant decoded as allowed=%v reason=%q ok=%v", allowed, reason, ok)
	}

	allowed, reason, ok = DecodeOpenAck(EncodeOpenAck(false, "Port 22 is not in the tunnel allowlist."))
	if !ok || allowed {
		t.Fatalf("denial decoded as allowed=%v ok=%v", allowed, ok)
	}
	if reason != "Port 22 is not in the tunnel allowlist." {
		t.Fatalf("denial reason = %q", reason)
	}

	if _, _, ok := DecodeOpenAck(nil); ok {
		t.Fatal("an empty payload must not decode as an acknowledgement")
	}

	port, ok := DecodeOpenPayload(EncodeOpenPayload(5432))
	if !ok || port != 5432 {
		t.Fatalf("port round trip = %d, %v", port, ok)
	}
}
