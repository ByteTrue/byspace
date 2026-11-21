package tunnel

import (
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ForwardState is the per-port state reported to clients.
type ForwardState struct {
	RemotePort int `json:"remotePort"`
	// RemoteHost is the destination on the peer's side. Empty means its loopback.
	RemoteHost string `json:"remoteHost,omitempty"`
	Label      string `json:"label,omitempty"`
	LocalPort  int    `json:"localPort"`
	// ListenHost is the interface the local listener bound to. Loopback when the rule did not ask
	// for another address; 0.0.0.0 or :: when the port is deliberately exposed on the network.
	ListenHost string `json:"listenHost,omitempty"`
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
	// pendingDown queues peer→local writes so the shared read loop never blocks on a slow local
	// socket. One stuck stream used to stall every other stream's data and acks behind its
	// conn.Write. The writer goroutine drains this in order; overflow resets just this stream.
	pendingDown      []downItem
	pendingDownBytes int
	downCap          int
	downNotify       chan struct{}
	// owner is the forward this stream belongs to, so the downstream writer can clear f.streams
	// when a terminal Close drains. Set once at creation, never mutated.
	owner *forward
	// lastActivity is the UnixNano of the last byte moved in either direction. The idle sweeper
	// closes a stream that has carried nothing for idleTimeout.
	lastActivity atomic.Int64
}

// downItem is one queued local write. closeStream marks the terminal Close frame: the writer
// drains every queued write before it, so a response that arrived just before Close still reaches
// the local socket.
type downItem struct {
	payload     []byte
	closeStream bool
}

// enqueueDown appends a local write under the byte budget. It returns false (and marks the stream
// closed) when the budget is exceeded; the caller then drops just this stream.
func (s *stream) enqueueDown(item downItem) bool {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if s.closed {
		return false
	}
	if s.pendingDownBytes+len(item.payload) > s.downCap {
		s.closed = true
		return false
	}
	s.pendingDown = append(s.pendingDown, item)
	s.pendingDownBytes += len(item.payload)
	select {
	case s.downNotify <- struct{}{}:
	default:
	}
	return true
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
	// hostCapable reports that the target dialled the requested host rather than its own loopback.
	hostCapable bool
	reason      string
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

// forward is one destination on the peer, exposed as a local listener.
type forward struct {
	remotePort int
	// remoteHost is the destination on the peer's side. Empty means its loopback.
	remoteHost string
	label      string
	listener   net.Listener
	localPort  int
	// listenHost is the interface the local listener bound to. "" would have meant the manager
	// hardwired loopback; it is recorded so the status and the rule list can show the real address.
	listenHost string
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
	peerID   string
	peerHost string
	// forwards is keyed by FormatEndpoint, because one peer can forward the same port number on
	// two different hosts.
	forwards   map[string]*forward
	peer       PeerConn
	nextStream atomic.Uint64
	// idPrefix keeps stream ids unique per manager instance. The target keeps a stream for up to
	// 30 seconds after its peer goes away, so a rebuilt manager that numbered from t1 again handed
	// a new local connection the previous incarnation's dialled socket — the caller then read a
	// half-finished response as its own.
	idPrefix string

	mu      sync.Mutex
	closed  bool
	closeCh chan struct{}
	logf    func(format string, args ...any)
	grace   time.Duration
	// idleTimeout is atomic because the sweeper goroutine reads it concurrently with tests
	// shortening it. Captured from the global at construction.
	idleTimeout atomic.Int64 // nanoseconds
	streams     map[*stream]struct{}
}

// NewManager builds a manager for one peer.
func NewManager(peerID, peerHost string, logf func(string, ...any)) *Manager {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	m := &Manager{
		peerID:   peerID,
		peerHost: peerHost,
		forwards: make(map[string]*forward),
		closeCh:  make(chan struct{}),
		logf:     logf,
		grace:    30 * time.Second,
		streams:  make(map[*stream]struct{}),
		idPrefix: strconv.FormatInt(time.Now().UnixNano()%0xffffffff, 36),
	}
	m.idleTimeout.Store(int64(tunnelIdleTimeout))
	go m.sweepIdle()
	return m
}

// sweepIdle closes streams that carried no bytes in either direction for idleTimeout. A peer that
// vanishes without a Close, or a client that forgets an open connection, otherwise holds a local
// socket and its goroutines forever. One goroutine per manager, stopped by Close.
func (m *Manager) sweepIdle() {
	for {
		// Re-read each pass so a shortened timeout takes effect within one capped poll, and so the
		// sweeper never reads a plain field a test writes concurrently.
		timeout := time.Duration(m.idleTimeout.Load())
		interval := timeout / 2
		if interval > 500*time.Millisecond {
			interval = 500 * time.Millisecond
		}
		if interval < time.Millisecond {
			interval = time.Millisecond
		}
		select {
		case <-m.closeCh:
			return
		case <-time.After(interval):
		}
		cutoff := time.Now().Add(-timeout).UnixNano()
		m.mu.Lock()
		var stale []*stream
		for s := range m.streams {
			last := s.lastActivity.Load()
			if last != 0 && last < cutoff {
				stale = append(stale, s)
			}
		}
		m.mu.Unlock()
		for _, s := range stale {
			m.dropStream(s.owner, s, idleCloseReason)
		}
	}
}

// AddForward exposes one destination on the peer behind a local listener.
//
// cfg.LocalPort pins the local port when > 0 and lets the OS pick otherwise. cfg.ListenHost picks
// the interface; empty means loopback (127.0.0.1). Binding 0.0.0.0 or :: exposes the port on the
// network, which the UI warns about before it gets here. cfg.RemoteHost is the destination on the
// peer; empty means its loopback.
func (m *Manager) AddForward(cfg ForwardConfig) (*forward, error) {
	if cfg.RemotePort < 1 || cfg.RemotePort > 65535 {
		return nil, fmt.Errorf("remotePort %d out of range", cfg.RemotePort)
	}
	if err := ValidateRemoteHost(cfg.RemoteHost); err != nil {
		return nil, err
	}
	if cfg.LocalPort < 0 || cfg.LocalPort > 65535 {
		return nil, fmt.Errorf("localPort %d out of range", cfg.LocalPort)
	}

	host := strings.TrimSpace(cfg.ListenHost)
	if host == "" {
		host = "127.0.0.1"
	}
	remoteHost := strings.TrimSpace(cfg.RemoteHost)
	remote := FormatEndpoint(remoteHost, cfg.RemotePort)
	listenAddr := net.JoinHostPort(host, strconv.Itoa(cfg.LocalPort))
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("cannot open local listener on %s for %s: %w", listenAddr, remote, err)
	}
	addr := listener.Addr().(*net.TCPAddr)
	port := addr.Port
	listenHostUsed := addr.IP.String()

	f := &forward{
		remotePort: cfg.RemotePort,
		remoteHost: remoteHost,
		label:      cfg.Label,
		listener:   listener,
		localPort:  port,
		listenHost: listenHostUsed,
		state:      StateConnecting,
		streams:    make(map[string]*stream),
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		_ = listener.Close()
		return nil, errors.New("manager closed")
	}
	if _, exists := m.forwards[remote]; exists {
		// The registry rejects a duplicate rule; this is the last line of defence. Overwriting the map
		// entry kept the first listener running and untracked, so its port accepted connections
		// nobody could see or close.
		m.mu.Unlock()
		_ = listener.Close()
		return nil, fmt.Errorf("%s is already forwarded", remote)
	}
	m.forwards[remote] = f
	m.mu.Unlock()

	go m.acceptLoop(f)
	m.logf("tunnel %s: forwarding %s as %s:%d", m.peerID, remote, listenHostUsed, port)
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
	// The read loop advances this cursor in accept, so snapshot it here rather than reading the
	// field while frames land. A stale value would only make the target replay from an older
	// sequence, but the unsynchronized read is a real race.
	next := s.downstream.next
	s.writeMu.Unlock()
	s.lastActivity.Store(time.Now().UnixNano())
	if err := peer.Send(Frame{Opcode: OpcodeResume, TunnelID: s.id, Payload: encodeSequence(next)}); err != nil {
		m.logf("tunnel %s stream %s resume send failed: %v", m.peerID, s.id, err)
		return
	}
	m.logf("tunnel %s stream %s resume requested: next=%d", m.peerID, s.id, next)
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
	for _, f := range m.sortedForwards() {
		// The stored state is the answer. Inferring "connected" from `m.peer != nil` reported a
		// live tunnel whenever a connection object existed — and one always does after the first
		// dial, even when the peer daemon has been stopped and the relay is holding an idle socket.
		out = append(out, ForwardState{
			State:      f.state,
			RemotePort: f.remotePort,
			RemoteHost: f.remoteHost,
			Label:      f.label,
			LocalPort:  f.localPort,
			ListenHost: f.listenHost,
			LastError:  f.lastError,
		})
	}
	return out
}

// sortedForwards orders forwards by port, then host, so list output is stable. Caller holds m.mu.
func (m *Manager) sortedForwards() []*forward {
	out := make([]*forward, 0, len(m.forwards))
	for _, f := range m.forwards {
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].remotePort != out[j].remotePort {
			return out[i].remotePort < out[j].remotePort
		}
		return out[i].remoteHost < out[j].remoteHost
	})
	return out
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

	id := "t" + m.idPrefix + "." + strconv.FormatUint(m.nextStream.Add(1), 10)
	// downCap is twice the target's 16 MiB replay window. Acks now fire at accept, so this queue is
	// the only buffer holding accepted-but-unwritten bytes: a response larger than the replay window
	// (the 20 MiB test) must fit here while the writer drains, plus one window of scheduling slack so
	// a brief writer stall does not overflow a healthy transfer. pendingCap (disconnected replay) stays
	// at one window because it only holds bytes during a peer replacement, not a live write.
	s := &stream{id: id, conn: conn, opened: make(chan openResult, 1), remotePort: f.remotePort, pendingCap: 16 * 1024 * 1024, writeDone: make(chan struct{}), downCap: 32 * 1024 * 1024, downNotify: make(chan struct{}, 1), owner: f}
	s.lastActivity.Store(time.Now().UnixNano())

	m.mu.Lock()
	f.streams[id] = s
	m.streams[s] = struct{}{}
	m.mu.Unlock()
	go m.pumpDownstream(s)

	// Ask the target for the stream before moving any bytes.
	//
	// Without this the first chunk was sent into a tunnel id the target had never seen, so
	// `Target.HandleFrame` treated it as "a frame for a stream we already closed" and dropped it.
	// The local socket stayed open and the caller saw a connection that never answered — a hang,
	// not an error.
	if err := peer.Send(Frame{
		Opcode:   OpcodeOpen,
		TunnelID: id,
		Payload:  EncodeOpenPayload(f.remotePort, f.remoteHost),
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
		// dropStream publishes the error state after it logs; setting it here first would let a
		// waiter observe StateError and finish before the log line runs.
		m.dropStream(f, s, reason)
		return
	}
	// A rule that names a host needs a target that read it. An older one dialled its own loopback
	// and answered allowed, which would have silently served a different service (or a different
	// listener, when the host was a loopback alias the target resolves differently).
	if strings.TrimSpace(f.remoteHost) != "" && !result.hostCapable {
		reason := "The peer does not support forwarding to another host; update it to use this tunnel."
		// The target dialled its own loopback and is holding that socket for this stream id. Closing
		// the stream is what releases it; dropping only the local side would leave the target's
		// socket open until the peer socket dies.
		_ = peer.Send(Frame{Opcode: OpcodeClose, TunnelID: s.id})
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
	done := s.writeDone
	s.writeMu.Unlock()
	defer func() {
		// Clear the handle so resumeStream can tell "a pump is running" from "a pump exited".
		// Leaving it closed but non-nil blocked every restart after a Send failure, so upstream
		// stayed dead for the rest of the stream's life while downstream resumed normally.
		s.writeMu.Lock()
		if s.writeDone == done {
			s.writeDone = nil
		}
		s.writeMu.Unlock()
		close(done)
	}()
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
			s.lastActivity.Store(time.Now().UnixNano())
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
		ack, ok := DecodeOpenAck(frame.Payload)
		if !ok {
			ack = OpenAck{Reason: "malformed open acknowledgement"}
		}
		target.settleOpen(openResult{allowed: ack.Allowed, hostCapable: ack.HostCapable, reason: ack.Reason})
		if ack.Allowed {
			target.writeMu.Lock()
			next := target.downstream.next
			target.writeMu.Unlock()
			// The accepted cursor, not the written one. The queue survives a peer replacement, so
			// these bytes are still delivered; only a failed local write loses them, and that kills
			// the stream. Reporting the written cursor would need the writer to track it.
			_ = peer.Send(Frame{Opcode: OpcodeResumeAck, TunnelID: target.id, Payload: encodeSequence(next)})
		}
	case OpcodeDataDownstream:
		target.writeMu.Lock()
		resumable := target.resumable
		next := target.downstream.next
		target.writeMu.Unlock()
		if resumable {
			return
		}
		target.framesDown.Add(1)
		target.lastActivity.Store(time.Now().UnixNano())
		if !target.enqueueDown(downItem{payload: frame.Payload}) {
			m.dropStream(owner, target, fmt.Sprintf("downstream buffer exceeded %d MiB", target.downCap>>20))
			return
		}
		_ = peer.Send(Frame{Opcode: OpcodeDataAck, TunnelID: target.id, Payload: encodeSequence(next)})
	case OpcodeDataDownstreamSeq:
		sequence, payload, ok := decodeSequencedPayload(frame.Payload)
		if !ok {
			m.logf("tunnel %s stream %s malformed sequence frame", m.peerID, target.id)
			return
		}
		// resumeStream snapshots this cursor from another goroutine.
		target.writeMu.Lock()
		accepted, ok := target.downstream.accept(sequencedFrame{Sequence: sequence, Payload: payload})
		want := target.downstream.next
		target.writeMu.Unlock()
		if !ok {
			m.logf("tunnel %s stream %s sequence rejected: got=%d want=%d", m.peerID, target.id, sequence, want)
			return
		}
		target.framesDown.Add(1)
		target.lastActivity.Store(time.Now().UnixNano())
		m.logf("tunnel %s stream %s data received: sequence=%d", m.peerID, target.id, sequence)
		// Ack at accept, not at write. The queue holds the bytes until the local socket takes them
		// and survives a peer replacement; a failed write kills the stream, so an accepted byte is
		// never silently lost. Waiting for conn.Write to land tied the ack rate to the local socket:
		// one slow write froze the acks while the target kept sending, and its 16 MiB replay window
		// filled mid-response on a healthy transfer.
		if !target.enqueueDown(downItem{payload: accepted}) {
			m.dropStream(owner, target, fmt.Sprintf("downstream buffer exceeded %d MiB", target.downCap>>20))
			return
		}
		_ = peer.Send(Frame{Opcode: OpcodeDataAck, TunnelID: target.id, Payload: encodeSequence(sequence + 1)})
	case OpcodeResume:
		target.writeMu.Lock()
		next := target.downstream.next
		target.writeMu.Unlock()
		_ = peer.Send(Frame{Opcode: OpcodeResumeAck, TunnelID: target.id, Payload: encodeSequence(next)})
	case OpcodeClose:
		// Queue Close behind any writes still pending, so a response that arrived just before the
		// peer's Close reaches the local socket. Dropping here would close the socket early and
		// truncate the tail the client is still reading.
		if !target.enqueueDown(downItem{closeStream: true}) {
			m.dropStream(owner, target, "")
		}
	}
}

// pumpDownstream writes queued peer→local bytes on a dedicated goroutine, so a slow local socket
// blocks only this stream. The read loop enqueues under a byte budget; overflow drops the stream
// instead of stalling every other stream's data and acks behind one conn.Write.
func (m *Manager) pumpDownstream(s *stream) {
	for {
		s.writeMu.Lock()
		if s.closed {
			s.writeMu.Unlock()
			return
		}
		if len(s.pendingDown) == 0 {
			s.writeMu.Unlock()
			select {
			case <-s.downNotify:
			case <-m.closeCh:
				return
			}
			continue
		}
		// Coalesce every queued write into one conn.Write. Per-frame writes gave the shared read loop
		// a scheduling edge between each one: on a fast response it enqueued a full budget before this
		// writer's first Write landed and the queue overflowed on a healthy transfer. One batched write
		// drains the queue at socket speed instead of one scheduling slot per frame.
		var batch []byte
		var closeAfter bool
		for len(s.pendingDown) > 0 {
			item := s.pendingDown[0]
			s.pendingDown[0] = downItem{}
			s.pendingDown = s.pendingDown[1:]
			s.pendingDownBytes -= len(item.payload)
			if item.closeStream {
				closeAfter = true
				break
			}
			batch = append(batch, item.payload...)
		}
		s.writeMu.Unlock()

		if len(batch) > 0 {
			if _, err := s.conn.Write(batch); err != nil {
				m.dropStream(s.owner, s, err.Error())
				return
			}
		}
		if closeAfter {
			m.dropStream(s.owner, s, "")
			return
		}
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
	// Wake a downstream writer parked on an empty queue so it observes closed and exits.
	select {
	case s.downNotify <- struct{}{}:
	default:
	}
	if reason == "" {
		reason = "peer closed"
		if s.upstreamDone.Load() {
			reason = "upstream finished"
		}
	}
	m.logf("tunnel %s stream %s closed: up=%d down=%d reason=%s", m.peerID, s.id, s.framesUp.Load(), s.framesDown.Load(), reason)
	// Only a normal close is silent. The idle sweep is hygiene, not a failure: a pooled database
	// connection, a heartbeat-less SSE subscription, or a debugger parked at a breakpoint is silent
	// while the forward is healthy, and the listener stays up.
	// A genuine failure must surface even when the client already finished sending: an HTTP request
	// EOFs its upstream before the response arrives, so gating on upstreamDone hid every truncated
	// response behind a healthy-looking forward.
	if reason != "peer closed" && reason != "upstream finished" && reason != idleCloseReason {
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

// forwardState reads one forward's state by its remote port. Test helper: two hosts can use the
// same port, so a caller that needs an exact answer must key by endpoint.
func (m *Manager) forwardState(remotePort int) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, f := range m.forwards {
		if f.remotePort == remotePort {
			return f.state, true
		}
	}
	return "", false
}

// WaitForState blocks until the given port reaches want, or the deadline passes.
//
// Tests use it instead of sleeping: the connection state is what they assert on, and polling a
// mutex-protected field with a fixed sleep is how a passing test becomes a flaky one.
func (m *Manager) WaitForState(remotePort int, want string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if state, ok := m.forwardState(remotePort); ok && state == want {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

// LocalPort reports the bound local port for a remote port. Test helper: two hosts can use the same
// port, so a caller that needs an exact answer must key by endpoint.
func (m *Manager) LocalPort(remotePort int) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, f := range m.forwards {
		if f.remotePort == remotePort {
			return f.localPort, true
		}
	}
	return 0, false
}
