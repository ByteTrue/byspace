package tunnel

import (
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
)

// Target serves a peer's open requests: it dials the requested loopback port and pumps bytes
// back over the tunnel.
//
// Ported from session/tunnel/tunnel-session.ts. This is the D2 half — the machine whose ports are
// being forwarded. Three gates before anything is dialled, all of them server-side because a
// client can lie about all three:
//
//  1. the experimental feature gate (issue 063) — tunnels are off until the operator opts in;
//  2. a daemon password must be configured — an unauthenticated forwarder is an open proxy;
//  3. the requested port must be on the allowlist.
type Target struct {
	// Enabled is the feature gate. Read per request so a config change applies without a restart.
	Enabled func() bool
	// PasswordSet reports whether a daemon password is configured.
	PasswordSet func() bool
	// AllowedPorts is the forward whitelist. Read per request for the same reason.
	AllowedPorts func() []int
	// DialHost is where forwarded connections go. Empty means 127.0.0.1.
	DialHost string

	mu      sync.Mutex
	streams map[string]*targetStream
	nextID  atomic.Uint64
	closed  bool
}

// targetStream is one forwarded connection on the target side.
type targetStream struct {
	id   string
	conn net.Conn
}

// OpenResult reports the outcome of an open request.
type OpenResult struct {
	TunnelID string
	Allowed  bool
	Reason   string
}

// NewTarget builds a target-side server.
func NewTarget(enabled func() bool, passwordSet func() bool, allowed func() []int) *Target {
	return &Target{
		Enabled:      enabled,
		PasswordSet:  passwordSet,
		AllowedPorts: allowed,
		streams:      make(map[string]*targetStream),
	}
}

// Open answers a tunnel.open request.
//
// The denials are distinguished in the reason text rather than a code because the client shows
// it verbatim: "port 9999 is not in the tunnel allowlist" tells the user what to fix, while a bare
// refusal leaves them guessing which of the three gates closed.
//
// tunnelID is the initiator's id for this stream. The target adopts it rather than minting its own,
// because every frame after the open is routed by that id: a target that invented one would answer
// with a name the initiator never sent.
func (t *Target) Open(tunnelID string, remotePort int, send func(Frame) error) (OpenResult, error) {
	if t.Enabled != nil && !t.Enabled() {
		return OpenResult{Allowed: false, Reason: "Tunnels are disabled on this host."}, nil
	}
	if t.PasswordSet != nil && !t.PasswordSet() {
		return OpenResult{Allowed: false, Reason: "This host has no daemon password set, so tunnels are disabled."}, nil
	}
	if !t.portAllowed(remotePort) {
		return OpenResult{
			Allowed: false,
			Reason:  fmt.Sprintf("Port %d is not in the tunnel allowlist.", remotePort),
		}, nil
	}

	host := t.DialHost
	if host == "" {
		host = "127.0.0.1"
	}
	conn, err := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(remotePort)))
	if err != nil {
		return OpenResult{Allowed: false, Reason: fmt.Sprintf("Failed to connect to %s:%d: %v", host, remotePort, err)}, nil
	}

	id := tunnelID
	if id == "" {
		id = "s" + strconv.FormatUint(t.nextID.Add(1), 10)
	}
	stream := &targetStream{id: id, conn: conn}

	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		_ = conn.Close()
		return OpenResult{Allowed: false, Reason: "Host is shutting down."}, nil
	}
	// An id collision means two initiators picked the same name. Replace rather than leak: the old
	// stream is unreachable either way.
	if existing, ok := t.streams[id]; ok {
		_ = existing.conn.Close()
	}
	t.streams[id] = stream
	t.mu.Unlock()

	go t.pumpDownstream(stream, send)
	return OpenResult{TunnelID: id, Allowed: true}, nil
}

// portAllowed checks the whitelist.
func (t *Target) portAllowed(port int) bool {
	if t.AllowedPorts == nil {
		return false
	}
	for _, allowed := range t.AllowedPorts() {
		if allowed == port {
			return true
		}
	}
	return false
}

// HandleFrame routes a downstream frame into a stream.
func (t *Target) HandleFrame(frame Frame, send func(Frame) error) {
	// An open creates the stream, so it is answered before the lookup below: the id is not in the
	// table yet, and treating it like a stale frame is exactly what dropped every new stream.
	if frame.Opcode == OpcodeOpen {
		port, ok := DecodeOpenPayload(frame.Payload)
		if !ok {
			_ = send(Frame{
				Opcode:   OpcodeOpenAck,
				TunnelID: frame.TunnelID,
				Payload:  EncodeOpenAck(false, "Malformed tunnel open request."),
			})
			return
		}
		result, err := t.Open(frame.TunnelID, port, send)
		if err != nil {
			_ = send(Frame{
				Opcode:   OpcodeOpenAck,
				TunnelID: frame.TunnelID,
				Payload:  EncodeOpenAck(false, err.Error()),
			})
			return
		}
		_ = send(Frame{
			Opcode:   OpcodeOpenAck,
			TunnelID: frame.TunnelID,
			Payload:  EncodeOpenAck(result.Allowed, result.Reason),
		})
		return
	}

	t.mu.Lock()
	stream := t.streams[frame.TunnelID]
	t.mu.Unlock()
	if stream == nil {
		// A frame for a stream we already closed. Late bytes after a teardown are normal.
		return
	}

	switch frame.Opcode {
	// Upstream: the initiator's local client sent bytes, so they go into the dialled socket.
	// This side previously listened for Downstream, the direction it sends — so each end ignored
	// exactly what the other one produced and no byte ever crossed.
	case OpcodeDataUpstream:
		if _, err := stream.conn.Write(frame.Payload); err != nil {
			t.closeStream(stream)
		}
	case OpcodeClose:
		t.closeStream(stream)
	}
}

// pumpDownstream moves bytes from the dialled port back to the peer.
func (t *Target) pumpDownstream(stream *targetStream, send func(Frame) error) {
	buf := make([]byte, 32*1024)
	for {
		n, err := stream.conn.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			if sendErr := send(Frame{
				// Downstream: bytes read from the dialled service travelling back to the initiator.
				Opcode:   OpcodeDataDownstream,
				TunnelID: stream.id,
				Payload:  chunk,
			}); sendErr != nil {
				t.closeStream(stream)
				return
			}
		}
		if err != nil {
			// EOF means the dialled service closed its side; tell the peer and stop reading.
			if errors.Is(err, io.EOF) {
				_ = send(Frame{Opcode: OpcodeClose, TunnelID: stream.id})
			}
			t.closeStream(stream)
			return
		}
	}
}

// closeStream drops a stream and closes its socket.
func (t *Target) closeStream(stream *targetStream) {
	t.mu.Lock()
	if _, ok := t.streams[stream.id]; !ok {
		t.mu.Unlock()
		return
	}
	delete(t.streams, stream.id)
	t.mu.Unlock()
	_ = stream.conn.Close()
}

// Close tears down every forwarded connection.
func (t *Target) Close() {
	t.mu.Lock()
	t.closed = true
	streams := make([]*targetStream, 0, len(t.streams))
	for _, s := range t.streams {
		streams = append(streams, s)
	}
	t.streams = make(map[string]*targetStream)
	t.mu.Unlock()
	for _, s := range streams {
		_ = s.conn.Close()
	}
}

// ActiveStreams reports how many forwards are live, for the stats response.
func (t *Target) ActiveStreams() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.streams)
}
