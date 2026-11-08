package tunnel

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
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
	id           string
	conn         net.Conn
	framesUp     atomic.Uint64
	framesDown   atomic.Uint64
	closeReason  atomic.Value // string
	upstreamDone atomic.Bool
	writeMu      sync.Mutex
	send         func(Frame) error
	resume       chan struct{}
	closed       bool
	disconnected bool
	downstream   replayBuffer
	resuming     bool
	resumable    bool
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

	id := tunnelID
	if id == "" {
		id = "s" + strconv.FormatUint(t.nextID.Add(1), 10)
	}
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return OpenResult{Allowed: false, Reason: "Host is shutting down."}, nil
	}
	if existing, ok := t.streams[id]; ok {
		t.mu.Unlock()
		existing.writeMu.Lock()
		if !existing.disconnected {
			existing.writeMu.Unlock()
			return OpenResult{TunnelID: id, Allowed: false, Reason: "stream ID is already active"}, nil
		}
		existing.send = send
		existing.disconnected = false
		existing.closed = false
		existing.closeReason.Store("")
		if existing.resume != nil {
			close(existing.resume)
			existing.resume = nil
		}
		existing.writeMu.Unlock()
		return OpenResult{TunnelID: id, Allowed: true}, nil
	}
	conn, err := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(remotePort)))
	if err != nil {
		t.mu.Unlock()
		return OpenResult{Allowed: false, Reason: fmt.Sprintf("Failed to connect to %s:%d: %v", host, remotePort, err)}, nil
	}
	stream := &targetStream{id: id, conn: conn, send: send}
	t.streams[id] = stream
	t.mu.Unlock()

	go t.pumpDownstream(stream)
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
		if len(frame.Payload) >= 3 && frame.Payload[2]&OpenResumeRequested != 0 {
			if stream := t.streams[frame.TunnelID]; stream != nil {
				stream.resumable = true
			}
		}
		if err != nil {
			_ = send(Frame{
				Opcode:   OpcodeOpenAck,
				TunnelID: frame.TunnelID,
				Payload:  EncodeOpenAck(false, err.Error()),
			})
			return
		}
		ack := EncodeOpenAck(result.Allowed, result.Reason)
		if result.Allowed && len(frame.Payload) >= 3 && frame.Payload[2]&OpenResumeRequested != 0 {
			ack[0] |= OpenResumeCapable
		}
		_ = send(Frame{
			Opcode:   OpcodeOpenAck,
			TunnelID: frame.TunnelID,
			Payload:  ack,
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
	case OpcodeDataAck:
		if len(frame.Payload) != 8 {
			return
		}
		stream.writeMu.Lock()
		stream.downstream.acknowledge(binary.BigEndian.Uint64(frame.Payload))
		stream.writeMu.Unlock()
		return
	case OpcodeResumeAck:
		if len(frame.Payload) != 8 {
			return
		}
		next := binary.BigEndian.Uint64(frame.Payload)
		stream.writeMu.Lock()
		if !stream.resuming {
			stream.downstream.acknowledge(next)
			stream.writeMu.Unlock()
			return
		}
		frames := stream.downstream.replayFrom(next)
		send := stream.send
		stream.writeMu.Unlock()

		// Replay while the stream is still marked resuming, so live frames stay parked and cannot
		// overtake the sequence numbers they depend on. Releasing the waiter first put them on the
		// wire ahead of the replay, and the peer's cursor drops every frame it cannot place.
		failed := false
		for _, replay := range frames {
			if err := send(Frame{Opcode: OpcodeDataDownstreamSeq, TunnelID: stream.id, Payload: encodeSequencedPayload(replay)}); err != nil {
				failed = true
				break
			}
		}

		stream.writeMu.Lock()
		if failed {
			stream.disconnected = true
			if stream.resume == nil {
				stream.resume = make(chan struct{})
			}
			stream.writeMu.Unlock()
			return
		}
		// Cleared here rather than in resumeStream: a stream can be resumed more than once, and a
		// flag that only ever rose made every resume after the first skip its replay.
		stream.resuming = false
		if stream.resume != nil {
			close(stream.resume)
			stream.resume = nil
		}
		stream.writeMu.Unlock()
		return
	case OpcodeResume:
		t.resumeStream(stream, send)
		return
	// Upstream: the initiator's local client sent bytes, so they go into the dialled socket.
	// This side previously listened for Downstream, the direction it sends — so each end ignored
	// exactly what the other one produced and no byte ever crossed.
	case OpcodeDataUpstream:
		stream.framesUp.Add(1)
		if _, err := stream.conn.Write(frame.Payload); err != nil {
			stream.closeReason.Store("upstream write failed: " + err.Error())
			t.closeStream(stream)
		}
	case OpcodeClose:
		if len(frame.Payload) > 0 && frame.Payload[0] == CloseWrite {
			stream.upstreamDone.Store(true)
			if tcp, ok := stream.conn.(*net.TCPConn); ok {
				_ = tcp.CloseWrite()
			}
			return
		}
		stream.closeReason.Store("peer closed")
		t.closeStream(stream)
	}
}

// pumpDownstream moves bytes from the dialled port back to the peer.
func (t *Target) pumpDownstream(stream *targetStream) {
	buf := make([]byte, 32*1024)
	for {
		_ = stream.conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
		stream.writeMu.Lock()
		disconnected := stream.disconnected
		stream.writeMu.Unlock()
		if disconnected {
			stream.writeMu.Lock()
			if stream.resume == nil {
				stream.resume = make(chan struct{})
			}
			resume := stream.resume
			stream.writeMu.Unlock()
			select {
			case <-resume:
				continue
			case <-time.After(30 * time.Second):
				stream.closeReason.Store("peer reconnect grace expired")
				t.closeStream(stream)
				return
			}
		}
		n, err := stream.conn.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			frame := Frame{Opcode: OpcodeDataDownstream, TunnelID: stream.id, Payload: chunk}
			if !t.sendOrPause(stream, frame) {
				return
			}
		}
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			if errors.Is(err, io.EOF) {
				if !t.sendOrPause(stream, Frame{Opcode: OpcodeClose, TunnelID: stream.id}) {
					return
				}
			}
			stream.closeReason.Store(err.Error())
			t.closeStream(stream)
			return
		}
	}
}

// sendOrPause holds a failed frame and stops further TCP reads until a replacement transport
// arrives. This is the backpressure boundary: a lost socket must not become lost response bytes.
// Ownership is the failing send itself — the socket that owns a stream is the one whose writes
// fail — so a departing transport never touches another one's streams.
func (t *Target) resumeStream(stream *targetStream, send func(Frame) error) {
	stream.writeMu.Lock()
	if stream.closed {
		stream.writeMu.Unlock()
		_ = send(Frame{Opcode: OpcodeOpenAck, TunnelID: stream.id, Payload: EncodeOpenAck(false, "stream is closed")})
		return
	}
	stream.send = send
	stream.resuming = true
	stream.disconnected = false
	if stream.resume != nil {
		close(stream.resume)
	}
	stream.resume = make(chan struct{})
	stream.writeMu.Unlock()
	_ = send(Frame{Opcode: OpcodeOpenAck, TunnelID: stream.id, Payload: EncodeOpenAck(true, "")})
}

func (t *Target) sendOrPause(stream *targetStream, frame Frame) bool {
	// Appended and encoded once here. The retry after a pause used to re-enter this block with the
	// payload already carrying its sequence suffix and take the next counter value, so a retried
	// frame was misnumbered and eight bytes longer than the one it claimed to be.
	stream.writeMu.Lock()
	sequenced := frame.Opcode == OpcodeDataDownstream && stream.resumable
	if sequenced {
		if !stream.downstream.append(frame.Payload) {
			stream.closeReason.Store("unacknowledged downstream buffer exceeded 16 MiB")
			t.closeStream(stream)
			stream.writeMu.Unlock()
			return false
		}
		frame = Frame{
			Opcode:   OpcodeDataDownstreamSeq,
			TunnelID: frame.TunnelID,
			Payload:  encodeSequencedPayload(sequencedFrame{Sequence: stream.downstream.next - 1, Payload: frame.Payload}),
		}
	}
	stream.writeMu.Unlock()

	paused := false
	for {
		stream.writeMu.Lock()
		resuming := stream.resuming
		send := stream.send
		stream.writeMu.Unlock()
		if resuming {
			if !t.parkStream(stream) {
				return false
			}
			paused = true
			continue
		}
		if paused && sequenced {
			// The replay that ended the pause re-sent this frame from the buffer. Sending it again
			// would duplicate the bytes under a new sequence number.
			return true
		}
		if err := send(frame); err == nil {
			if frame.Opcode == OpcodeDataDownstream || frame.Opcode == OpcodeDataDownstreamSeq {
				stream.framesDown.Add(1)
			}
			return true
		}
		stream.writeMu.Lock()
		closed := stream.closed
		stream.disconnected = true
		stream.writeMu.Unlock()
		if closed {
			return false
		}
		if !t.parkStream(stream) {
			return false
		}
		paused = true
	}
}

// parkStream waits for a replacement transport to take over the stream.
//
// This is the backpressure boundary: a lost socket must not become lost response bytes. A stream
// whose own sends fail is the only one that pauses — a socket closing somewhere else in the daemon
// never touches a live tunnel.
func (t *Target) parkStream(stream *targetStream) bool {
	stream.writeMu.Lock()
	if stream.resume == nil {
		stream.resume = make(chan struct{})
	}
	resume := stream.resume
	stream.writeMu.Unlock()
	select {
	case <-resume:
		return true
	case <-time.After(30 * time.Second):
		stream.closeReason.Store("peer reconnect grace expired")
		t.closeStream(stream)
		return false
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
	stream.writeMu.Lock()
	stream.closed = true
	if stream.resume != nil {
		close(stream.resume)
	}
	stream.writeMu.Unlock()
	_ = stream.conn.Close()
	reason, _ := stream.closeReason.Load().(string)
	slog.Info("tunnel target stream closed", "streamId", stream.id, "framesUp", stream.framesUp.Load(), "framesDown", stream.framesDown.Load(), "reason", reason)
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
		s.closeReason.Store("target closed")
		s.writeMu.Lock()
		s.closed = true
		if s.resume != nil {
			close(s.resume)
		}
		s.writeMu.Unlock()
		_ = s.conn.Close()
	}
}

// ActiveStreams reports how many forwards are live, for the stats response.
func (t *Target) ActiveStreams() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.streams)
}
