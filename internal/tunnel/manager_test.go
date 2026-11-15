package tunnel

import (
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// echoPeer implements PeerConn's far side in-process: it echoes upstream bytes back as
// downstream, which is what a working tunnel to an echo service produces.
func echoPeer(conn PeerConn, stop <-chan struct{}) {
	go func() {
		for {
			select {
			case <-stop:
				return
			case frame, ok := <-conn.Frames():
				if !ok {
					return
				}
				switch frame.Opcode {
				case OpcodeOpen:
					// The far side grants every stream, which is what a target with the port on its
					// allowlist does. The manager will not move bytes until it sees this.
					_ = conn.Send(Frame{
						Opcode:   OpcodeOpenAck,
						TunnelID: frame.TunnelID,
						Payload:  EncodeOpenAck(true, ""),
					})
				case OpcodeDataUpstream:
					_ = conn.Send(Frame{Opcode: OpcodeDataDownstream, TunnelID: frame.TunnelID, Payload: frame.Payload})
				case OpcodeClose:
					_ = conn.Send(Frame{Opcode: OpcodeClose, TunnelID: frame.TunnelID})
				}
			}
		}
	}()
}

// The whole point of a tunnel: a connection to the local port reaches the peer and its bytes come
// back. Everything below the relay is real — listener, accepted socket, frame encoding, pumps.
func TestLocalPortReachesPeerAndBack(t *testing.T) {
	m := NewManager("peer-1", "target-host", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(ForwardConfig{RemotePort: 3000, Label: "dev server"}); err != nil {
		t.Fatal(err)
	}
	localPort, ok := m.LocalPort(3000)
	if !ok {
		t.Fatal("no local port")
	}

	peer, far := Pipe(64)
	stop := make(chan struct{})
	defer close(stop)
	echoPeer(far, stop)
	m.SetPeer(peer)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	payload := []byte("GET / HTTP/1.1\r\n\r\n")
	if _, err := conn.Write(payload); err != nil {
		t.Fatal(err)
	}

	got := make([]byte, len(payload))
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.ReadFull(conn, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("echoed %q, want %q", got, payload)
	}
}

// A port with no live peer must fail fast rather than accept and hang: accepting then hanging
// looks to the user like the remote service is slow.
func TestConnectionWithoutPeerFails(t *testing.T) {
	m := NewManager("peer-2", "", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(ForwardConfig{RemotePort: 3001, Label: ""}); err != nil {
		t.Fatal(err)
	}
	localPort, _ := m.LocalPort(3001)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	// The daemon closes the accepted socket; the client observes EOF rather than silence.
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 1)
	if _, readErr := conn.Read(buf); readErr == nil {
		t.Fatal("expected the connection to be closed")
	}

	if !m.WaitForState(3001, StateError, 2*time.Second) {
		t.Fatal("the port should report an error")
	}
}

// Replacing the peer tears down live streams: their ids belonged to the old connection.
func TestPeerReplacementTearsDownStreams(t *testing.T) {
	m := NewManager("peer-3", "", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(ForwardConfig{RemotePort: 3002, Label: ""}); err != nil {
		t.Fatal(err)
	}
	localPort, _ := m.LocalPort(3002)

	first, farFirst := Pipe(16)
	stop := make(chan struct{})
	defer close(stop)
	echoPeer(farFirst, stop)
	m.SetPeer(first)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	// Drain the echo first: otherwise the buffered reply is what the next Read returns, and the
	// test would pass or fail depending on whether the pump won a race.
	echoed := make([]byte, 1)
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.ReadFull(conn, echoed); err != nil {
		t.Fatalf("stream never worked, so teardown cannot be tested: %v", err)
	}

	// New connection; the old stream must be dropped.
	second, farSecond := Pipe(16)
	echoPeer(farSecond, stop)
	m.SetPeer(second)

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 1)
	if _, readErr := conn.Read(buf); readErr == nil {
		t.Fatal("the old stream should have been closed")
	}
}

func TestStreamCloseLogIdentifiesFramesAndReason(t *testing.T) {
	var logs strings.Builder
	closed := make(chan struct{})
	var closeOnce sync.Once
	m := NewManager("peer-log", "", func(format string, args ...any) {
		fmt.Fprintf(&logs, format+"\n", args...)
		if strings.Contains(format, "closed: up=") {
			closeOnce.Do(func() { close(closed) })
		}
	})
	defer func() { _ = m.Close() }()
	_, err := m.AddForward(ForwardConfig{RemotePort: 3002, Label: ""})
	if err != nil {
		t.Fatal(err)
	}
	peer, far := Pipe(16)
	stop := make(chan struct{})
	defer close(stop)
	echoPeer(far, stop)
	m.SetPeer(peer)
	localPort, _ := m.LocalPort(3002)
	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	response := make([]byte, 4)
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.ReadFull(conn, response); err != nil {
		t.Fatal(err)
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("stream close was not logged")
	}
	// Stream ids carry a per-manager prefix, so the assertion pins the shape rather than the number.
	logged := logs.String()
	if !strings.Contains(logged, "stream t") || !strings.Contains(logged, "closed: up=1 down=1 reason=upstream finished") {
		t.Fatalf("missing stream lifecycle log: %q", logged)
	}
}

func TestAddForwardRejectsBadPort(t *testing.T) {
	m := NewManager("peer-4", "", t.Logf)
	defer func() { _ = m.Close() }()
	for _, port := range []int{0, -1, 70000} {
		if _, err := m.AddForward(ForwardConfig{RemotePort: port, Label: ""}); err == nil {
			t.Fatalf("port %d should be rejected", port)
		}
	}
}

// The list output is sorted, so the UI does not reorder rows between polls.
func TestStatusIsSorted(t *testing.T) {
	m := NewManager("peer-5", "", t.Logf)
	defer func() { _ = m.Close() }()
	for _, port := range []int{3005, 3001, 3003} {
		if _, err := m.AddForward(ForwardConfig{RemotePort: port, Label: ""}); err != nil {
			t.Fatal(err)
		}
	}
	statuses := m.Status()
	for i := 1; i < len(statuses); i++ {
		if statuses[i-1].RemotePort > statuses[i].RemotePort {
			t.Fatalf("unsorted: %+v", statuses)
		}
	}
}

// Close releases the listeners; the ports must be free afterwards.
func TestCloseReleasesListeners(t *testing.T) {
	m := NewManager("peer-6", "", t.Logf)
	if _, err := m.AddForward(ForwardConfig{RemotePort: 3006, Label: ""}); err != nil {
		t.Fatal(err)
	}
	localPort, _ := m.LocalPort(3006)
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}

	// Binding the same port again proves the listener is gone.
	listener, err := net.Listen("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatalf("port still held after Close: %v", err)
	}
	_ = listener.Close()
}

// itoa avoids importing strconv in a test that only needs decimal ports.
func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := make([]byte, 0, 6)
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}

// A forward whose peer never answered must not report "connected".
//
// The relay keeps a client socket open when no daemon is registered for that serverId, so a
// successful dial proved nothing. `Status` treated the presence of a connection object as proof of
// life, which reported a tunnel as Connected for a host that had been stopped — the tunnels page
// showed a green badge for a daemon that was not running.
func TestStatusDoesNotInferConnectedFromAPeerObject(t *testing.T) {
	manager := NewManager("srv_peer", "peer-host", t.Logf)
	t.Cleanup(func() { _ = manager.Close() })
	if _, err := manager.AddForward(ForwardConfig{RemotePort: 5432, Label: "db"}); err != nil {
		t.Fatal(err)
	}

	// Before any connection exists the forward is connecting, not connected.
	for _, state := range manager.Status() {
		if state.State == StateConnected {
			t.Fatalf("a forward reported connected before any peer answered: %+v", state)
		}
	}

	// A connection object that has not been proven alive changes nothing.
	manager.SetPeer(&stubPeer{})
	for _, state := range manager.Status() {
		if state.State == StateConnected {
			t.Fatalf("a peer object alone flipped the state to connected: %+v", state)
		}
	}

	// Only an explicit connected event does.
	manager.SetPeerState(StateConnected)
	states := manager.Status()
	if len(states) != 1 || states[0].State != StateConnected {
		t.Fatalf("SetPeerState(connected) did not reach the forward: %+v", states)
	}

	// And losing it takes the state back down.
	manager.SetPeerState(StateDisconnected)
	if states := manager.Status(); states[0].State == StateConnected {
		t.Fatalf("a disconnected event left the forward connected: %+v", states)
	}
}

// stubPeer is a PeerConn that never delivers anything, standing in for a socket the relay holds
// open with no daemon behind it.
type stubPeer struct{}

func (stubPeer) Send(Frame) error     { return nil }
func (stubPeer) Frames() <-chan Frame { return make(chan Frame) }
func (stubPeer) Err() error           { return nil }
func (stubPeer) Close() error         { return nil }

// A target from before host support read the port, ignored the host and dialled its own loopback,
// then answered allowed. Refusing that stream is the difference between an update notice and
// silently serving a different machine's service.
func TestNonLoopbackForwardRequiresHostCapableTarget(t *testing.T) {
	m := NewManager("peer-host", "target-host", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(ForwardConfig{RemotePort: 3600, RemoteHost: "192.168.1.9"}); err != nil {
		t.Fatal(err)
	}
	localPort, ok := m.LocalPort(3600)
	if !ok {
		t.Fatal("no local listener")
	}

	peer, far := Pipe(16)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			case frame, open := <-far.Frames():
				if !open {
					return
				}
				if frame.Opcode == OpcodeOpen {
					// An older target's answer: allowed, with no host bit.
					_ = far.Send(Frame{Opcode: OpcodeOpenAck, TunnelID: frame.TunnelID, Payload: EncodeOpenAck(true, "")})
				}
			}
		}
	}()
	m.SetPeer(peer)

	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, readErr := conn.Read(make([]byte, 1)); readErr == nil {
		t.Fatal("a stream to a destination the target did not dial must be closed, not served")
	}
	if !m.WaitForState(3600, StateError, 2*time.Second) {
		t.Fatal("the forward should report an error, so the UI can name the update")
	}
}

// The same port on two different machines is two rules, not an edit of one.
func TestForwardsDistinguishHostsWithTheSamePort(t *testing.T) {
	m := NewManager("peer-hosts", "target-host", t.Logf)
	defer func() { _ = m.Close() }()

	if _, err := m.AddForward(ForwardConfig{RemotePort: 3700}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddForward(ForwardConfig{RemotePort: 3700, RemoteHost: "192.168.1.9"}); err != nil {
		t.Fatal(err)
	}
	states := m.Status()
	if len(states) != 2 {
		t.Fatalf("expected two forwards, got %+v", states)
	}
	seen := make(map[string]bool)
	for _, state := range states {
		seen[FormatEndpoint(state.RemoteHost, state.RemotePort)] = true
	}
	if !seen["127.0.0.1:3700"] || !seen["192.168.1.9:3700"] {
		t.Fatalf("destinations = %v", seen)
	}
}

// An edit names the destination it replaces, not the new one, so it can land on a destination another
// rule already uses. Two rules for one destination collide in the manager and one silently replaces
// the other, so the edit is refused instead.
func TestRegistryRejectsDuplicateDestinationOnEdit(t *testing.T) {
	// The rule being replaced comes last in the second case: putting the collision second was the
	// order that slipped through the merge and deleted the other rule.
	cases := [][]ForwardConfig{
		{{RemotePort: 5432}, {RemotePort: 5433}},
		{{RemotePort: 5433}, {RemotePort: 5432}},
	}
	for index, forwards := range cases {
		r := NewRegistry(t.TempDir(), t.Logf)
		r.SetPeerFactory(func(PeerConfig) (PeerConn, error) { return nil, nil })
		r.SetEnabled(true)

		if err := r.Add(PeerConfig{
			PeerID:   "peer-dup",
			URL:      "wss://relay.example.com",
			Forwards: forwards,
		}); err != nil {
			r.Close()
			t.Fatal(err)
		}

		err := r.AddOrUpdate(PeerConfig{
			PeerID:   "peer-dup",
			Forwards: []ForwardConfig{{RemotePort: 5433}},
		}, ForwardConfig{RemotePort: 5432})
		if err == nil {
			r.Close()
			t.Fatalf("case %d: editing a rule onto an existing destination must be refused", index)
		}

		// The rejected edit changed nothing: both rules are still there.
		kept := r.List()[0].Forwards
		if len(kept) != 2 {
			r.Close()
			t.Fatalf("case %d: rejected edit mutated the rules: %+v", index, kept)
		}
		ports := map[int]bool{}
		for _, fw := range kept {
			ports[fw.RemotePort] = true
		}
		if !ports[5432] || !ports[5433] {
			r.Close()
			t.Fatalf("case %d: rules = %+v", index, kept)
		}
		r.Close()
	}
}

// The manager keys forwards by destination, so a duplicate would overwrite the map entry and leave
// the first listener running untracked.
func TestAddForwardRejectsDuplicateDestination(t *testing.T) {
	m := NewManager("peer-dup", "", t.Logf)
	defer m.Close()
	if _, err := m.AddForward(ForwardConfig{RemotePort: 3800}); err != nil {
		t.Fatal(err)
	}
	localPort, _ := m.LocalPort(3800)
	if _, err := m.AddForward(ForwardConfig{RemotePort: 3800}); err == nil {
		t.Fatal("a second forward to the same destination must be refused")
	}
	if _, ok := m.LocalPort(3800); !ok {
		t.Fatal("the first forward should still be registered")
	}
	conn, err := net.Dial("tcp", "127.0.0.1:"+itoa(localPort))
	if err != nil {
		t.Fatalf("the first listener was closed by the rejected duplicate: %v", err)
	}
	_ = conn.Close()
}

// The listen address in the rule form has to reach the bind. Before it was wired, the manager
// hardwired loopback and the UI's "open to the network" warning described behavior the daemon
// never performed.
func TestAddForwardBindsRequestedListenHost(t *testing.T) {
	m := NewManager("peer", "peer-host", nil)
	defer m.Close()

	f, err := m.AddForward(ForwardConfig{RemotePort: 3500, ListenHost: "127.0.0.1", Label: "loopback"})
	if err != nil {
		t.Fatal(err)
	}
	if f.listenHost != "127.0.0.1" {
		t.Fatalf("expected loopback bind, got %q", f.listenHost)
	}

	// Empty means the default, which is loopback.
	defaultForward, err := m.AddForward(ForwardConfig{RemotePort: 3501, Label: "default"})
	if err != nil {
		t.Fatal(err)
	}
	if defaultForward.listenHost != "127.0.0.1" {
		t.Fatalf("empty listen host should bind loopback, got %q", defaultForward.listenHost)
	}

	// Status reports the bound address so the rule list shows the truth.
	states := m.Status()
	var found bool
	for _, state := range states {
		if state.RemotePort == 3500 {
			found = true
			if state.ListenHost != "127.0.0.1" {
				t.Fatalf("status listenHost = %q", state.ListenHost)
			}
		}
	}
	if !found {
		t.Fatal("forward 3500 missing from status")
	}
}
