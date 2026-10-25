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
func (t *Target) Open(remotePort int, send func(Frame) error) (OpenResult, error) {
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

	id := "s" + strconv.FormatUint(t.nextID.Add(1), 10)
	stream := &targetStream{id: id, conn: conn}

	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		_ = conn.Close()
		return OpenResult{Allowed: false, Reason: "Host is shutting down."}, nil
	}
	t.streams[id] = stream
	t.mu.Unlock()

	go t.pumpUpstream(stream, send)
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
	t.mu.Lock()
	stream := t.streams[frame.TunnelID]
	t.mu.Unlock()
	if stream == nil {
		// A frame for a stream we already closed. Late bytes after a teardown are normal.
		return
	}

	switch frame.Opcode {
	case OpcodeDataDownstream:
		if _, err := stream.conn.Write(frame.Payload); err != nil {
			t.closeStream(stream)
		}
	case OpcodeClose:
		t.closeStream(stream)
	}
}

// pumpUpstream moves bytes from the dialled port back to the peer.
func (t *Target) pumpUpstream(stream *targetStream, send func(Frame) error) {
	buf := make([]byte, 32*1024)
	for {
		n, err := stream.conn.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			if sendErr := send(Frame{
				Opcode:   OpcodeDataUpstream,
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
