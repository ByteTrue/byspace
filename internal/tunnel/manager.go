package tunnel

import (
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// ForwardState is the per-port state reported to clients.
type ForwardState struct {
	RemotePort int    `json:"remotePort"`
	Label      string `json:"label,omitempty"`
	LocalPort  int    `json:"localPort"`
	State      string `json:"state"`
	Disabled   bool   `json:"disabled,omitempty"`
	LastError  string `json:"lastError,omitempty"`
}

// Per-port states, matching tunnel-manager.ts.
const (
	StateConnecting   = "connecting"
	StateConnected    = "connected"
	StateDisconnected = "disconnected"
	StateError        = "error"
)

// stream is one live tunnel: a local accepted socket plus its tunnel id.
type stream struct {
	id   string
	conn net.Conn
	// upstreamDone records that the local side finished sending, so the read pump should not
	// treat the resulting EOF as a failure.
	upstreamDone atomic.Bool
	framesUp     atomic.Uint64
	framesDown   atomic.Uint64
	// opened receives the target's answer to the open request. Buffered so the reader never blocks
	// on a stream nobody is waiting for any more.
	opened chan openResult
	// openOnce guards the single delivery into opened: the answer arrives once, but a disconnect
	// can also fail every waiting stream.
	openOnce     sync.Once
	remotePort   int
	pendingUp    [][]byte
	pendingBytes int
	pendingCap   int
	writeDone    chan struct{}
	writeMu      sync.Mutex
	connected    bool
	closed       bool
	halfClosed   bool
	generation   uint64
	downstream   receiveCursor
	resumable    bool
}

func (s *stream) enqueue(frame Frame) bool {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if s.closed {
		return false
	}
	if s.connected {
		return true
	}
	if s.pendingBytes+len(frame.Payload) > s.pendingCap {
		s.closed = true
		return false
	}
	s.pendingUp = append(s.pendingUp, frame.Payload)
	s.pendingBytes += len(frame.Payload)
	return true
}

// openResult is the target's answer to an open request.
type openResult struct {
	allowed bool
	reason  string
}

// settleOpen delivers an open result at most once.
func (s *stream) settleOpen(result openResult) {
	s.openOnce.Do(func() {
		select {
		case s.opened <- result:
		default:
		}
	})
}

// forward is one remote port exposed locally.
type forward struct {
	remotePort int
	label      string
	listener   net.Listener
	localPort  int
	state      string
	lastError  string
	// streams keyed by tunnel id.
	streams map[string]*stream
}

// Manager exposes a peer's whitelisted ports as local ports.
//
// Ported from tunnel-manager.ts. The manager owns the local listeners and the byte pumps; it does
// not own the relay connection, which arrives as a PeerConn.
type Manager struct {
	peerID     string
	peerHost   string
	forwards   map[int]*forward
	peer       PeerConn
	nextStream atomic.Uint64

	mu      sync.Mutex
	closed  bool
	closeCh chan struct{}
	logf    func(format string, args ...any)
	grace   time.Duration
	streams map[*stream]struct{}
}

// NewManager builds a manager for one peer.
func NewManager(peerID, peerHost string, logf func(string, ...any)) *Manager {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &Manager{
		peerID:   peerID,
		peerHost: peerHost,
		forwards: make(map[int]*forward),
		closeCh:  make(chan struct{}),
		logf:     logf,
		grace:    30 * time.Second,
		streams:  make(map[*stream]struct{}),
	}
}

// AddForward exposes one remote port locally on an ephemeral port (or use AddForwardWithLocalPort
// to bind a fixed local port).
func (m *Manager) AddForward(remotePort int, label string) (*forward, error) {
	return m.AddForwardWithLocalPort(remotePort, 0, label)
}

// AddForwardWithLocalPort exposes one remote port locally, binding preferredLocalPort when > 0.
func (m *Manager) AddForwardWithLocalPort(remotePort, preferredLocalPort int, label string) (*forward, error) {
	if remotePort < 1 || remotePort > 65535 {
		return nil, fmt.Errorf("remotePort %d out of range", remotePort)
	}
	if preferredLocalPort < 0 || preferredLocalPort > 65535 {
		return nil, fmt.Errorf("localPort %d out of range", preferredLocalPort)
	}

	listenAddr := "127.0.0.1:0"
	if preferredLocalPort > 0 {
		listenAddr = fmt.Sprintf("127.0.0.1:%d", preferredLocalPort)
	}
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("cannot open local listener on %s for remote %d: %w", listenAddr, remotePort, err)
	}
	port := listener.Addr().(*net.TCPAddr).Port

	f := &forward{
		remotePort: remotePort,
		label:      label,
		listener:   listener,
		localPort:  port,
		state:      StateConnecting,
		streams:    make(map[string]*stream),
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		_ = listener.Close()
		return nil, errors.New("manager closed")
	}
	m.forwards[remotePort] = f
	m.mu.Unlock()

	go m.acceptLoop(f)
	m.logf("tunnel %s: forwarding remote %d as 127.0.0.1:%d", m.peerID, remotePort, port)
	return f, nil
}

// SetPeer attaches the peer connection and starts pumping inbound frames.
//
// SetPeer swaps the transport without discarding the local TCP streams. The peer channel closes
// before a replacement is attached; that pause is what applies backpressure and queues writes.
func (m *Manager) SetPeer(peer PeerConn) {
	m.mu.Lock()
	previous := m.peer
	m.peer = peer
	m.mu.Unlock()

	if previous != nil {
		_ = previous.Close()
	}
	if peer == nil {
		return
	}
	m.mu.Lock()
	streams := make([]*stream, 0, 16)
	for _, f := range m.forwards {
		for _, s := range f.streams {
			s.writeMu.Lock()
			s.opened = make(chan openResult, 1)
			s.openOnce = sync.Once{}
			s.writeMu.Unlock()
			streams = append(streams, s)
		}
	}
	m.mu.Unlock()
	go m.pumpPeer(peer)
	for _, s := range streams {
		go m.resumeStream(peer, s)
	}
}

func (m *Manager) resumeStream(peer PeerConn, s *stream) {
	s.writeMu.Lock()
	s.connected = false
	s.resumable = true
	s.writeMu.Unlock()
	if err := peer.Send(Frame{Opcode: OpcodeResume, TunnelID: s.id, Payload: encodeSequence(s.downstream.next)}); err != nil {
		m.logf("tunnel %s stream %s resume send failed: %v", m.peerID, s.id, err)
		return
	}
	m.logf("tunnel %s stream %s resume requested: next=%d", m.peerID, s.id, s.downstream.next)
	result, ok := m.awaitOpen(s)
	m.mu.Lock()
	current := m.peer == peer
	m.mu.Unlock()
	if !current {
		return
	}
	if !ok || !result.allowed {
		m.dropStream(nil, s, "target refused to resume: "+result.reason)
		return
	}
	s.writeMu.Lock()
	if s.closed {
		s.writeMu.Unlock()
		return
	}
	if s.writeDone != nil {
		s.writeMu.Unlock()
		return
	}
	s.writeDone = make(chan struct{})
	s.generation++
	s.writeMu.Unlock()
	go m.pumpLocalToPeer(peer, s)
}

// SetPeerState updates every port's state after a connection event.
func (m *Manager) SetPeerState(state string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, f := range m.forwards {
		if f.state != StateError {
			f.state = state
		}
	}
}

// Status reports every forward, for the tunnel.list response.
func (m *Manager) Status() []ForwardState {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ForwardState, 0, len(m.forwards))
	for _, port := range m.sortedPorts() {
		f := m.forwards[port]
		// The stored state is the answer. Inferring "connected" from `m.peer != nil` reported a
		// live tunnel whenever a connection object existed — and one always does after the first
		// dial, even when the peer daemon has been stopped and the relay is holding an idle socket.
		out = append(out, ForwardState{
			State:      f.state,
			RemotePort: f.remotePort,
			Label:      f.label,
			LocalPort:  f.localPort,
			LastError:  f.lastError,
		})
	}
	return out
}

// sortedPorts returns the remote ports in ascending order, so list output is stable.
func (m *Manager) sortedPorts() []int {
	ports := make([]int, 0, len(m.forwards))
	for port := range m.forwards {
		ports = append(ports, port)
	}
	for i := 1; i < len(ports); i++ {
		for j := i; j > 0 && ports[j] < ports[j-1]; j-- {
			ports[j], ports[j-1] = ports[j-1], ports[j]
		}
	}
	return ports
}

// Close tears down every listener and stream.
func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	peer := m.peer
	m.peer = nil
	listeners := make([]net.Listener, 0, len(m.forwards))
	for _, f := range m.forwards {
		listeners = append(listeners, f.listener)
	}
	m.mu.Unlock()

	close(m.closeCh)
	for _, l := range listeners {
		_ = l.Close()
	}
	m.teardownStreams("manager closed")
	if peer != nil {
		_ = peer.Close()
	}
	return nil
}

// acceptLoop handles connections on one local listener.
func (m *Manager) acceptLoop(f *forward) {
	for {
		conn, err := f.listener.Accept()
		if err != nil {
			select {
			case <-m.closeCh:
				return
			default:
			}
			// A listener that fails for another reason is reported rather than retried in a tight
			// loop: the port is gone, and silently spinning would hide that.
			m.setError(f, err.Error())
			return
		}
		go m.handleLocalConn(f, conn)
	}
}

// handleLocalConn opens a tunnel stream and pumps the accepted socket.
func (m *Manager) handleLocalConn(f *forward, conn net.Conn) {
	m.mu.Lock()
	peer := m.peer
	closed := m.closed
	m.mu.Unlock()
	if peer == nil || closed {
		_ = conn.Close()
		m.setError(f, "peer not connected")
		return
	}

	id := "t" + strconv.FormatUint(m.nextStream.Add(1), 10)
	s := &stream{id: id, conn: conn, opened: make(chan openResult, 1), remotePort: f.remotePort, pendingCap: 16 * 1024 * 1024, writeDone: make(chan struct{})}

	m.mu.Lock()
	f.streams[id] = s
	m.streams[s] = struct{}{}
	m.mu.Unlock()

	// Ask the target for the stream before moving any bytes.
	//
	// Without this the first chunk was sent into a tunnel id the target had never seen, so
	// `Target.HandleFrame` treated it as "a frame for a stream we already closed" and dropped it.
	// The local socket stayed open and the caller saw a connection that never answered — a hang,
	// not an error.
	if err := peer.Send(Frame{
		Opcode:   OpcodeOpen,
		TunnelID: id,
		Payload:  append(EncodeOpenPayload(f.remotePort), OpenResumeRequested),
	}); err != nil {
		m.dropStream(f, s, "peer send failed: "+err.Error())
		return
	}

	result, ok := m.awaitOpen(s)
	if !ok {
		// The peer went away, or the manager closed, while the open was in flight.
		m.dropStream(f, s, "peer disconnected during open")
		return
	}
	if !result.allowed {
		reason := result.reason
		if reason == "" {
			reason = "target refused the stream"
		}
		m.setError(f, reason)
		m.dropStream(f, s, reason)
		return
	}

	m.mu.Lock()
	// The first stream on a port is what proves the path works; the state reflects that.
	if f.state != StateConnected {
		f.state = StateConnected
		f.lastError = ""
	}
	m.mu.Unlock()

	go m.pumpLocalToPeer(peer, s)
}

// awaitOpen waits for the target's answer, the manager closing, or the socket dying.
//
// A bound rather than an infinite wait: a target that never answers (an older daemon, a dropped
// frame) would otherwise pin the accepted socket and its goroutine forever.
func (m *Manager) awaitOpen(s *stream) (openResult, bool) {
	timeout := time.NewTimer(openTimeout)
	defer timeout.Stop()
	select {
	case result := <-s.opened:
		return result, true
	case <-m.closeCh:
		return openResult{}, false
	case <-timeout.C:
		return openResult{allowed: false, reason: "target did not answer the open request"}, true
	}
}

// openTimeout bounds how long a stream waits for its answer.
const openTimeout = 15 * time.Second

// pumpLocalToPeer moves bytes from the accepted socket into the tunnel. resumeStream has already
// reopened the stream on a replacement peer and switched the target's send callback.
func (m *Manager) pumpLocalToPeer(peer PeerConn, s *stream) {
	s.writeMu.Lock()
	generation := s.generation
	s.writeMu.Unlock()
	defer close(s.writeDone)
	for {
		s.writeMu.Lock()
		if s.generation != generation {
			s.writeMu.Unlock()
			return
		}
		s.writeMu.Unlock()
		for {
			s.writeMu.Lock()
			if len(s.pendingUp) == 0 {
				s.connected = true
				s.writeMu.Unlock()
				break
			}
			payload := s.pendingUp[0]
			s.pendingUp = s.pendingUp[1:]
			s.pendingBytes -= len(payload)
			s.writeMu.Unlock()
			if err := peer.Send(Frame{Opcode: OpcodeDataUpstream, TunnelID: s.id, Payload: payload}); err != nil {
				s.writeMu.Lock()
				if s.generation != generation {
					s.writeMu.Unlock()
					return
				}
				s.pendingUp = append([][]byte{payload}, s.pendingUp...)
				s.pendingBytes += len(payload)
				s.connected = false
				s.writeMu.Unlock()
				return
			}
			s.framesUp.Add(1)
		}
		s.writeMu.Lock()
		halfClosed := s.halfClosed
		s.halfClosed = false
		s.writeMu.Unlock()
		if halfClosed {
			if err := peer.Send(Frame{Opcode: OpcodeClose, TunnelID: s.id, Payload: []byte{CloseWrite}}); err != nil {
				s.writeMu.Lock()
				s.halfClosed = true
				s.connected = false
				s.writeMu.Unlock()
				return
			}
		}
		s.writeMu.Lock()
		disconnected := !s.connected
		s.writeMu.Unlock()
		if disconnected {
			return
		}

		buf := make([]byte, 32*1024)
		_ = s.conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
		n, err := s.conn.Read(buf)
		if n > 0 {
			frame := Frame{Opcode: OpcodeDataUpstream, TunnelID: s.id, Payload: append([]byte(nil), buf[:n]...)}
			if !s.enqueue(frame) {
				m.dropStream(nil, s, "disconnected buffer exceeded 16 MiB")
				return
			}
			s.writeMu.Lock()
			connected := s.connected
			s.writeMu.Unlock()
			if !connected {
				continue
			}
			if err := peer.Send(frame); err != nil {
				s.writeMu.Lock()
				if s.generation != generation {
					s.writeMu.Unlock()
					return
				}
				s.connected = false
				s.pendingUp = append([][]byte{frame.Payload}, s.pendingUp...)
				s.pendingBytes += len(frame.Payload)
				s.writeMu.Unlock()
				return
			}
			s.framesUp.Add(1)
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				s.upstreamDone.Store(true)
				s.writeMu.Lock()
				s.halfClosed = true
				connected := s.connected
				s.writeMu.Unlock()
				if connected {
					if err := peer.Send(Frame{Opcode: OpcodeClose, TunnelID: s.id, Payload: []byte{CloseWrite}}); err != nil {
						s.writeMu.Lock()
						s.connected = false
						s.writeMu.Unlock()
					}
				}
				return
			}
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			m.dropStream(nil, s, err.Error())
			return
		}
	}
}

// pumpPeer reads inbound frames and routes them to their streams.
func (m *Manager) pumpPeer(peer PeerConn) {
	defer func() {
		m.mu.Lock()
		if m.peer == peer {
			m.peer = nil
		}
		m.mu.Unlock()
	}()
	for {
		select {
		case <-m.closeCh:
			return
		case frame, ok := <-peer.Frames():
			if !ok {
				m.SetPeerState(StateDisconnected)
				m.logf("tunnel %s peer closed: %v", m.peerID, peer.Err())
				go m.expireDisconnected(peer)
				return
			}
			m.handleFrame(peer, frame)
		}
	}
}

func (m *Manager) expireDisconnected(peer PeerConn) {
	timer := time.NewTimer(m.grace)
	defer timer.Stop()
	select {
	case <-m.closeCh:
	case <-timer.C:
	}
	m.mu.Lock()
	unchanged := m.peer == peer
	m.mu.Unlock()
	if unchanged {
		m.teardownStreams("peer reconnect grace expired")
	}
}

// handleFrame dispatches one inbound frame.
func (m *Manager) handleFrame(peer PeerConn, frame Frame) {
	m.mu.Lock()
	if m.peer != peer {
		m.mu.Unlock()
		return
	}
	var target *stream
	var owner *forward
	for _, f := range m.forwards {
		if s, ok := f.streams[frame.TunnelID]; ok {
			target = s
			owner = f
			break
		}
	}
	m.mu.Unlock()

	if target == nil {
		// A frame for a stream we already dropped. Late bytes are normal after a teardown.
		return
	}

	switch frame.Opcode {
	case OpcodeOpenAck:
		allowed, reason, ok := DecodeOpenAck(frame.Payload)
		if !ok {
			allowed, reason = false, "malformed open acknowledgement"
		}
		target.settleOpen(openResult{allowed: allowed, reason: reason})
		if allowed {
			_ = peer.Send(Frame{Opcode: OpcodeResumeAck, TunnelID: target.id, Payload: encodeSequence(target.downstream.next)})
		}
	case OpcodeDataDownstream:
		if target.resumable {
			return
		}
		target.framesDown.Add(1)
		if _, err := target.conn.Write(frame.Payload); err != nil {
			m.dropStream(owner, target, err.Error())
			return
		}
		_ = peer.Send(Frame{Opcode: OpcodeDataAck, TunnelID: target.id, Payload: encodeSequence(target.downstream.next)})
	case OpcodeDataDownstreamSeq:
		sequence, payload, ok := decodeSequencedPayload(frame.Payload)
		if !ok {
			return
		}
		accepted, ok := target.downstream.accept(sequencedFrame{Sequence: sequence, Payload: payload})
		if !ok {
			m.logf("tunnel %s stream %s sequence rejected: got=%d want=%d", m.peerID, target.id, sequence, target.downstream.next)
			return
		}
		target.framesDown.Add(1)
		if _, err := target.conn.Write(accepted); err != nil {
			m.dropStream(owner, target, err.Error())
			return
		}
		if target.resumable {
			_ = peer.Send(Frame{Opcode: OpcodeDataAck, TunnelID: target.id, Payload: encodeSequence(target.downstream.next)})
		}
	case OpcodeResume:
		_ = peer.Send(Frame{Opcode: OpcodeResumeAck, TunnelID: target.id, Payload: encodeSequence(target.downstream.next)})
	case OpcodeClose:
		m.dropStream(owner, target, "")
	}
}

// dropStream closes one stream's socket and forgets it.
func (m *Manager) dropStream(f *forward, s *stream, reason string) {
	m.mu.Lock()
	if _, ok := m.streams[s]; !ok {
		m.mu.Unlock()
		return
	}
	delete(m.streams, s)
	if f != nil {
		delete(f.streams, s.id)
	}
	m.mu.Unlock()

	_ = s.conn.Close()
	s.writeMu.Lock()
	s.closed = true
	s.writeMu.Unlock()
	if reason == "" {
		reason = "peer closed"
		if s.upstreamDone.Load() {
			reason = "upstream finished"
		}
	}
	m.logf("tunnel %s stream %s closed: up=%d down=%d reason=%s", m.peerID, s.id, s.framesUp.Load(), s.framesDown.Load(), reason)
	if reason != "peer closed" && reason != "upstream finished" && !s.upstreamDone.Load() {
		m.setError(f, reason)
	}
}

// teardownStreams closes every live stream, keeping the listeners.
func (m *Manager) teardownStreams(reason string) {
	m.mu.Lock()
	streams := make([]*stream, 0, len(m.streams))
	for _, f := range m.forwards {
		f.streams = make(map[string]*stream)
	}
	for s := range m.streams {
		streams = append(streams, s)
	}
	m.streams = make(map[*stream]struct{})
	m.mu.Unlock()
	for _, s := range streams {
		m.dropStream(nil, s, reason)
	}
}

// setError records a per-port error.
func (m *Manager) setError(f *forward, message string) {
	if f == nil {
		return
	}
	m.mu.Lock()
	f.state = StateError
	f.lastError = message
	m.mu.Unlock()
}

// WaitForState blocks until the given port reaches want, or the deadline passes.
//
// Tests use it instead of sleeping: the connection state is what they assert on, and polling a
// mutex-protected field with a fixed sleep is how a passing test becomes a flaky one.
func (m *Manager) WaitForState(remotePort int, want string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		f, ok := m.forwards[remotePort]
		state := ""
		if ok {
			state = f.state
		}
		m.mu.Unlock()
		if ok && state == want {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

// LocalPort reports the bound local port for a remote port.
func (m *Manager) LocalPort(remotePort int) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.forwards[remotePort]
	if !ok {
		return 0, false
	}
	return f.localPort, true
}
