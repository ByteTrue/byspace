package tunnel

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// tunnelDialTimeout bounds the target's outbound dial. Without it a black-holed destination pins
// the open (and the caller's stream) for the OS default, which is minutes.
var tunnelDialTimeout = 10 * time.Second

// tunnelIdleTimeout closes a stream that carried no bytes in either direction for this long. A
// peer that vanishes without a Close, or a client that forgets an open connection, otherwise holds
// a dialled socket forever. Captured into an instance field at construction so sweeper goroutines
// never read the mutable global (tests shorten it).
//
// Two hours, not minutes: TCP keepalives do not cross the tunnel as data, so a pooled database
// connection, an SSE subscription without a heartbeat, or a debugger parked at a breakpoint looks
// exactly like a leak to this sweep. The bound only has to reclaim sockets whose owner is gone.
var tunnelIdleTimeout = 2 * time.Hour

// idleCloseReason labels a sweep so the manager can tell hygiene from a real failure.
const idleCloseReason = "idle timeout"

// Target serves a peer's open requests: it dials the requested destination and pumps bytes back
// over the tunnel.
//
// Ported from session/tunnel/tunnel-session.ts. This is the D2 half — the machine whose ports are
// being forwarded. Three gates before anything is dialled, all of them server-side because a
// client can lie about all three:
//
//  1. the experimental feature gate (issue 063) — tunnels are off until the operator opts in;
//  2. a daemon password must be configured — an unauthenticated forwarder is an open proxy;
//  3. the requested destination must be on the allowlist. A destination is host:port, so allowing
//     a port on loopback does not also open the same port on every machine this one can reach.
type Target struct {
	// Enabled is the feature gate. Read per request so a config change applies without a restart.
	Enabled func() bool
	// PasswordSet reports whether a daemon password is configured.
	PasswordSet func() bool
	// Allowed is the destination whitelist. Read per request for the same reason.
	Allowed func() []Endpoint
	// DialHost is where forwarded connections go when the request names no host. Empty means
	// 127.0.0.1.
	DialHost string

	mu      sync.Mutex
	streams map[string]*targetStream
	nextID  atomic.Uint64
	closed  bool
	// stop ends the idle sweeper. Closed once in Close.
	stop chan struct{}
	// dialTimeout bounds Open's dial; only the request path reads it. idleTimeout is atomic because
	// the sweeper goroutine reads it concurrently with tests shortening it. Both are captured from
	// the globals at construction.
	dialTimeout time.Duration
	idleTimeout atomic.Int64 // nanoseconds
}

// targetStream is one forwarded connection on the target side.
type targetStream struct {
	id   string
	conn net.Conn
	// ownerKey is the peer public key that opened this stream, or "" for a local or
	// password-proven operator. A non-empty owner is immutable: every later frame for this stream
	// must come from the same peer, so a relay socket that learns a stream id cannot inject bytes
	// into, resume, or close someone else's tunnel.
	ownerKey     string
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
	// pendingUp queues peer→local writes so the shared sink read loop never blocks on a slow
	// dialled socket. That loop also carries terminal and file frames, so one stuck stream used to
	// stall every other frame on the socket behind its conn.Write. The writer drains this in order;
	// overflow resets just this stream.
	pendingUp      []upItem
	pendingUpBytes int
	upCap          int
	upNotify       chan struct{}
	// lastActivity is the UnixNano of the last byte moved in either direction. The idle sweeper
	// closes a stream that has carried nothing for idleTimeout.
	lastActivity atomic.Int64
}

// upItem is one queued local write, or a terminal close marker. closeWrite signals upstream EOF
// after every queued write drains; closeStream tears the stream down after they drain. Ordering
// them behind the writes keeps a half-close from truncating the request the service is still reading.
type upItem struct {
	payload     []byte
	closeWrite  bool
	closeStream bool
}

// enqueueUp appends a local write under the byte budget. It returns false (and marks the stream
// closed) when the budget is exceeded; the caller then closes just this stream.
func (s *targetStream) enqueueUp(item upItem) bool {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if s.closed {
		return false
	}
	// Streams built without Open (tests, resumed placeholders) still need a live queue.
	if s.upNotify == nil {
		s.upNotify = make(chan struct{}, 1)
	}
	if s.upCap == 0 {
		s.upCap = 16 * 1024 * 1024
	}
	if s.pendingUpBytes+len(item.payload) > s.upCap {
		s.closed = true
		return false
	}
	s.pendingUp = append(s.pendingUp, item)
	s.pendingUpBytes += len(item.payload)
	select {
	case s.upNotify <- struct{}{}:
	default:
	}
	return true
}

// OpenResult reports the outcome of an open request.
type OpenResult struct {
	TunnelID string
	Allowed  bool
	Reason   string
}

// NewTarget builds a target-side server.
func NewTarget(enabled func() bool, passwordSet func() bool, allowed func() []Endpoint) *Target {
	t := &Target{
		Enabled:     enabled,
		PasswordSet: passwordSet,
		Allowed:     allowed,
		streams:     make(map[string]*targetStream),
		stop:        make(chan struct{}),
		dialTimeout: tunnelDialTimeout,
	}
	t.idleTimeout.Store(int64(tunnelIdleTimeout))
	go t.sweepIdle()
	return t
}

// sweepIdle closes streams that carried no bytes in either direction for idleTimeout. A peer that
// vanishes without a Close, or a client that forgets an open connection, otherwise holds a dialled
// socket forever. One goroutine per target, stopped by Close.
func (t *Target) sweepIdle() {
	for {
		// Re-read each pass so a shortened timeout takes effect within one capped poll, and so the
		// sweeper never reads a plain field a test writes concurrently.
		timeout := time.Duration(t.idleTimeout.Load())
		interval := timeout / 2
		if interval > 500*time.Millisecond {
			interval = 500 * time.Millisecond
		}
		if interval < time.Millisecond {
			interval = time.Millisecond
		}
		select {
		case <-t.stop:
			return
		case <-time.After(interval):
		}
		cutoff := time.Now().Add(-timeout).UnixNano()
		t.mu.Lock()
		var stale []*targetStream
		for _, s := range t.streams {
			last := s.lastActivity.Load()
			// A zero stamp is a hand-built placeholder with no dialled socket; nothing to reclaim.
			if last != 0 && last < cutoff {
				stale = append(stale, s)
			}
		}
		t.mu.Unlock()
		for _, s := range stale {
			s.closeReason.Store(idleCloseReason)
			t.closeStream(s)
		}
	}
}

// Open answers a tunnel.open request.
//
// The denials are distinguished in the reason text rather than a code because the client shows
// it verbatim: "192.168.1.9:5432 is not in the tunnel allowlist" tells the user what to fix, while a
// bare refusal leaves them guessing which of the three gates closed.
//
// tunnelID is the initiator's id for this stream. The target adopts it rather than minting its own,
// because every frame after the open is routed by that id: a target that invented one would answer
// with a name the initiator never sent.
func (t *Target) Open(tunnelID string, remotePort int, remoteHost string, ownerKey string, send func(Frame) error) (OpenResult, error) {
	if t.Enabled != nil && !t.Enabled() {
		return OpenResult{Allowed: false, Reason: "Tunnels are disabled on this host."}, nil
	}
	if t.PasswordSet != nil && !t.PasswordSet() {
		return OpenResult{Allowed: false, Reason: "This host has no daemon password set, so tunnels are disabled."}, nil
	}
	if remotePort < 1 || remotePort > 65535 {
		return OpenResult{Allowed: false, Reason: fmt.Sprintf("Port %d is out of range.", remotePort)}, nil
	}
	if err := ValidateRemoteHost(remoteHost); err != nil {
		return OpenResult{Allowed: false, Reason: fmt.Sprintf("%v.", err)}, nil
	}
	requestHost := strings.TrimSpace(remoteHost)
	destination := FormatEndpoint(requestHost, remotePort)
	if !t.endpointAllowed(requestHost, remotePort) {
		return OpenResult{Allowed: false, Reason: fmt.Sprintf("%s is not in the tunnel allowlist.", destination)}, nil
	}

	host := requestHost
	if host == "" {
		host = t.DialHost
	}
	if host == "" {
		host = loopbackHost
	}
	dialed := net.JoinHostPort(unbracket(host), strconv.Itoa(remotePort))

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
		// A stream belongs to the peer that opened it. Another peer asking to resume it is not a
		// reconnect, it is a takeover attempt.
		if existing.ownerKey != ownerKey {
			return OpenResult{TunnelID: id, Allowed: false, Reason: "stream belongs to another peer"}, nil
		}
		existing.writeMu.Lock()
		if !existing.disconnected {
			existing.writeMu.Unlock()
			return OpenResult{TunnelID: id, Allowed: false, Reason: "stream ID is already active"}, nil
		}
		existing.send = send
		existing.disconnected = false
		existing.closed = false
		existing.closeReason.Store("")
		existing.lastActivity.Store(time.Now().UnixNano())
		if existing.resume != nil {
			close(existing.resume)
			existing.resume = nil
		}
		existing.writeMu.Unlock()
		return OpenResult{TunnelID: id, Allowed: true}, nil
	}
	conn, err := net.DialTimeout("tcp", dialed, t.dialTimeout)
	if err != nil {
		t.mu.Unlock()
		return OpenResult{Allowed: false, Reason: fmt.Sprintf("Failed to connect to %s: %v", dialed, err)}, nil
	}
	stream := &targetStream{id: id, conn: conn, send: send, ownerKey: ownerKey, upCap: 16 * 1024 * 1024, upNotify: make(chan struct{}, 1)}
	stream.lastActivity.Store(time.Now().UnixNano())
	t.streams[id] = stream
	t.mu.Unlock()

	go t.pumpDownstream(stream)
	go t.pumpUpstream(stream)
	return OpenResult{TunnelID: id, Allowed: true}, nil
}

// endpointAllowed checks the whitelist. Comparison is on the canonical endpoint, so a loopback
// request matches a bare port entry and nothing else can borrow that entry's permission.
func (t *Target) endpointAllowed(host string, port int) bool {
	if t.Allowed == nil {
		return false
	}
	want := FormatEndpoint(host, port)
	for _, allowed := range t.Allowed() {
		if FormatEndpoint(allowed.Host, allowed.Port) == want {
			return true
		}
	}
	return false
}

// HandleFrame routes a downstream frame into a stream.
//
// peerKey is the proven public key of the relay socket the frame arrived on. operator marks a local
// socket or one that proved the daemon password: it may drive any stream, because it is the
// person who holds this machine. A peer may only drive the streams it opened.
func (t *Target) HandleFrame(frame Frame, peerKey string, operator bool, send func(Frame) error) {
	// An open creates the stream, so it is answered before the lookup below: the id is not in the
	// table yet, and treating it like a stale frame is exactly what dropped every new stream.
	if frame.Opcode == OpcodeOpen {
		port, remoteHost, ok := DecodeOpenPayload(frame.Payload)
		if !ok {
			_ = send(Frame{
				Opcode:   OpcodeOpenAck,
				TunnelID: frame.TunnelID,
				Payload:  EncodeOpenAck(false, "Malformed tunnel open request."),
			})
			return
		}
		result, err := t.Open(frame.TunnelID, port, remoteHost, peerKey, send)
		if len(frame.Payload) >= 3 && frame.Payload[2]&OpenResumeRequested != 0 {
			// The map read needs t.mu (closeStream deletes under it) and resumable needs writeMu
			// (sendOrPause reads it under that lock). Open returns before either, so this lookup
			// raced the stream's own teardown goroutines once a peer asked to resume.
			t.mu.Lock()
			stream := t.streams[frame.TunnelID]
			t.mu.Unlock()
			if stream != nil {
				stream.writeMu.Lock()
				stream.resumable = true
				stream.writeMu.Unlock()
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
		if result.Allowed {
			if len(frame.Payload) >= 3 && frame.Payload[2]&OpenResumeRequested != 0 {
				ack[0] |= OpenResumeCapable
			}
			// Only when the request carried a host. An initiator from before hosts rejects a status
			// byte it does not know, so a loopback stream must keep the old answer; a request with a
			// host can only come from a build that understands this bit.
			if len(frame.Payload) > 3 {
				ack[0] |= OpenHostCapable
			}
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
	// Ownership: a peer may only drive the streams it opened. An operator drives everything it can
	// reach, which is what makes "close this tunnel" work on a stream a peer opened. The two cases
	// cannot be folded into one empty-key check: an operator stream has an empty owner, and an
	// empty-owner stream must still reject a keyed peer.
	if !operator && stream.ownerKey != peerKey {
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
		stream.lastActivity.Store(time.Now().UnixNano())
		if !stream.enqueueUp(upItem{payload: frame.Payload}) {
			stream.closeReason.Store("upstream buffer exceeded 16 MiB")
			t.closeStream(stream)
		}
	case OpcodeClose:
		if len(frame.Payload) > 0 && frame.Payload[0] == CloseWrite {
			// Queue the half-close behind pending writes so the service reads the whole request
			// before it sees EOF. Closing the write side here would truncate the tail.
			if !stream.enqueueUp(upItem{closeWrite: true}) {
				stream.upstreamDone.Store(true)
				if tcp, ok := stream.conn.(*net.TCPConn); ok {
					_ = tcp.CloseWrite()
				}
			}
			return
		}
		if !stream.enqueueUp(upItem{closeStream: true}) {
			stream.closeReason.Store("peer closed")
			t.closeStream(stream)
		}
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
			stream.lastActivity.Store(time.Now().UnixNano())
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

// pumpUpstream writes queued peer→local bytes on a dedicated goroutine, so a slow dialled socket
// blocks only this stream. The shared sink read loop enqueues under a byte budget; overflow closes
// the stream instead of stalling every other frame on the socket behind one conn.Write. Terminal
// close markers drain after the writes ahead of them.
func (t *Target) pumpUpstream(stream *targetStream) {
	for {
		stream.writeMu.Lock()
		if stream.closed {
			stream.writeMu.Unlock()
			return
		}
		if len(stream.pendingUp) == 0 {
			stream.writeMu.Unlock()
			select {
			case <-stream.upNotify:
			case <-time.After(250 * time.Millisecond):
			}
			continue
		}
		item := stream.pendingUp[0]
		stream.pendingUp[0] = upItem{}
		stream.pendingUp = stream.pendingUp[1:]
		stream.pendingUpBytes -= len(item.payload)
		stream.writeMu.Unlock()

		if item.closeStream {
			stream.closeReason.Store("peer closed")
			t.closeStream(stream)
			return
		}
		if item.closeWrite {
			stream.upstreamDone.Store(true)
			if tcp, ok := stream.conn.(*net.TCPConn); ok {
				_ = tcp.CloseWrite()
			}
			continue
		}
		if _, err := stream.conn.Write(item.payload); err != nil {
			stream.closeReason.Store("upstream write failed: " + err.Error())
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
	stream.lastActivity.Store(time.Now().UnixNano())
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
	// Wake an upstream writer parked on an empty queue so it observes closed and exits.
	select {
	case stream.upNotify <- struct{}{}:
	default:
	}
	_ = stream.conn.Close()
	reason, _ := stream.closeReason.Load().(string)
	slog.Info("tunnel target stream closed", "streamId", stream.id, "framesUp", stream.framesUp.Load(), "framesDown", stream.framesDown.Load(), "reason", reason)
}

// Close tears down every forwarded connection.
func (t *Target) Close() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.closed = true
	close(t.stop)
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
