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
	// opened receives the target's answer to the open request. Buffered so the reader never blocks
	// on a stream nobody is waiting for any more.
	opened chan openResult
	// openOnce guards the single delivery into opened: the answer arrives once, but a disconnect
	// can also fail every waiting stream.
	openOnce sync.Once
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
	}
}

// AddForward exposes one remote port locally.
//
// Binding happens immediately so the caller learns about a port collision at configuration time
// rather than when the first request arrives.
func (m *Manager) AddForward(remotePort int, label string) (*forward, error) {
	if remotePort < 1 || remotePort > 65535 {
		return nil, fmt.Errorf("remotePort %d out of range", remotePort)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("cannot open local listener for %d: %w", remotePort, err)
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
// Replacing the peer is how reconnection works: the registry builds a new connection and hands it
// over, and every live stream is torn down because its ids belong to the old connection.
func (m *Manager) SetPeer(peer PeerConn) {
	m.mu.Lock()
	previous := m.peer
	m.peer = peer
	m.mu.Unlock()

	if previous != nil {
		// Close before tearing down: the old connection's frames must not race with the new
		// connection's ids, and the stream teardown has to happen for the ids that belonged to it.
		_ = previous.Close()
		m.teardownStreams("peer reconnected")
	}
	if peer == nil {
		return
	}
	go m.pumpPeer(peer)
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
		state := f.state
		if state == StateConnecting && m.peer != nil {
			state = StateConnected
		}
		out = append(out, ForwardState{
			RemotePort: f.remotePort,
			Label:      f.label,
			LocalPort:  f.localPort,
			State:      state,
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
	s := &stream{id: id, conn: conn, opened: make(chan openResult, 1)}

	m.mu.Lock()
	f.streams[id] = s
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
		Payload:  EncodeOpenPayload(f.remotePort),
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

	go m.pumpLocalToPeer(peer, f, s)
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

// pumpLocalToPeer moves bytes from the accepted socket into the tunnel.
func (m *Manager) pumpLocalToPeer(peer PeerConn, f *forward, s *stream) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.conn.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			if sendErr := peer.Send(Frame{
				Opcode:   OpcodeDataUpstream,
				TunnelID: s.id,
				Payload:  chunk,
			}); sendErr != nil {
				m.dropStream(f, s, "peer send failed: "+sendErr.Error())
				return
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				s.upstreamDone.Store(true)
				// Half-close: tell the peer this direction is done, keep reading the other way.
				_ = peer.Send(Frame{Opcode: OpcodeClose, TunnelID: s.id})
				return
			}
			m.dropStream(f, s, err.Error())
			return
		}
	}
}

// pumpPeer reads inbound frames and routes them to their streams.
func (m *Manager) pumpPeer(peer PeerConn) {
	for {
		select {
		case <-m.closeCh:
			return
		case frame, ok := <-peer.Frames():
			if !ok {
				m.SetPeerState(StateDisconnected)
				return
			}
			m.handleFrame(frame)
		}
	}
}

// handleFrame dispatches one inbound frame.
func (m *Manager) handleFrame(frame Frame) {
	m.mu.Lock()
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
	case OpcodeDataDownstream:
		if _, err := target.conn.Write(frame.Payload); err != nil {
			m.dropStream(owner, target, err.Error())
		}
	case OpcodeClose:
		m.dropStream(owner, target, "")
	}
}

// dropStream closes one stream's socket and forgets it.
func (m *Manager) dropStream(f *forward, s *stream, reason string) {
	m.mu.Lock()
	if f != nil {
		if _, ok := f.streams[s.id]; !ok {
			m.mu.Unlock()
			return
		}
		delete(f.streams, s.id)
	}
	m.mu.Unlock()

	_ = s.conn.Close()
	if reason != "" && !s.upstreamDone.Load() {
		m.setError(f, reason)
	}
}

// teardownStreams closes every live stream, keeping the listeners.
//
// Called when the peer connection is replaced: the stream ids belonged to the old connection, so
// the peer can no longer answer for them.
func (m *Manager) teardownStreams(reason string) {
	m.mu.Lock()
	type pair struct {
		f *forward
		s *stream
	}
	pairs := make([]pair, 0, 8)
	for _, f := range m.forwards {
		for _, s := range f.streams {
			pairs = append(pairs, pair{f, s})
		}
	}
	m.mu.Unlock()

	for _, p := range pairs {
		m.dropStream(p.f, p.s, "")
	}
	_ = reason
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
