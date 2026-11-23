package tunnel

import (
	"errors"
	"io"
	"net"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

// TestUpstreamResumesAfterPumpExit checks that a client can still send after the tunnel reconnected.
//
// resumeStream refuses to spawn a writer when writeDone is non-nil, intending "a pump is already
// running". But writeDone is created at stream birth and closed when its pump exits, never cleared.
// When a Send fails the pump requeues the payload and returns, so after that exit the guard blocks
// the restart permanently: downstream resumes, upstream is dead, and every later request is queued
// into a buffer nothing drains. For a database forward every request after a flap goes unanswered.
//
// The peer the running pump holds must be the one that fails. Replacing the peer object does not do
// it: the old pump keeps writing through the old object, which still works.
func TestUpstreamResumesAfterPumpExit(t *testing.T) {
	requireTCP(t)
	port, stop := startEchoService(t)
	defer stop()

	target := NewTarget(func() bool { return true }, func() bool { return true }, loopbackAllowlist(port))
	defer target.Close()
	// The pumps can outlive the test, so t.Logf here would race the test's own completion.
	manager := NewManager("peer-test", "target-host", func(string, ...any) {})
	defer manager.Close()

	peer := &flakyPeer{toTarget: make(chan Frame, 64), fromTarget: make(chan Frame, 64), stop: make(chan struct{})}
	driverDone := make(chan struct{})
	go func() {
		defer close(driverDone)
		for {
			select {
			case <-peer.stop:
				return
			case frame := <-peer.toTarget:
				target.HandleFrame(frame, "", true, func(outgoing Frame) error {
					select {
					case peer.fromTarget <- outgoing:
					case <-peer.stop:
					}
					return nil
				})
			}
		}
	}()
	defer func() {
		close(peer.stop)
		<-driverDone
	}()

	manager.SetPeer(peer)
	if _, err := manager.AddForward(ForwardConfig{RemotePort: port, Label: "echo"}); err != nil {
		t.Fatalf("add forward: %v", err)
	}
	localPort, ok := manager.LocalPort(port)
	if !ok {
		t.Fatal("no local listener")
	}
	conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(localPort)))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	roundTrip := func(label string) {
		t.Helper()
		if _, err := conn.Write([]byte(label)); err != nil {
			t.Fatalf("write %q: %v", label, err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		got := make([]byte, len(label))
		if _, err := io.ReadFull(conn, got); err != nil {
			t.Fatalf("read echo of %q: %v", label, err)
		}
		if string(got) != label {
			t.Fatalf("echo = %q, want %q", got, label)
		}
	}

	roundTrip("before")

	// The link dies while the client is sending: the pump requeues and exits.
	peer.fail.Store(true)
	if _, err := conn.Write([]byte("x")); err != nil {
		t.Fatalf("write into the dead link: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	// The link comes back. Resume succeeds on the target, so upstream must work again.
	peer.fail.Store(false)
	manager.SetPeer(peer)
	time.Sleep(300 * time.Millisecond)

	// The requeued "x" is delivered first, then the new request.
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	drain := make([]byte, 1)
	if _, err := io.ReadFull(conn, drain); err != nil {
		t.Fatalf("the requeued byte never reached the service: %v", err)
	}
	roundTrip("after")
}

// flakyPeer is a PeerConn whose Send can be made to fail, which is what a relay drop looks like to a
// running pump.
type flakyPeer struct {
	fail       atomic.Bool
	toTarget   chan Frame
	fromTarget chan Frame
	stop       chan struct{}
}

func (p *flakyPeer) Send(frame Frame) error {
	if p.fail.Load() {
		return errors.New("peer is gone")
	}
	select {
	case p.toTarget <- frame:
		return nil
	case <-p.stop:
		return errors.New("peer is gone")
	}
}

func (p *flakyPeer) Frames() <-chan Frame { return p.fromTarget }
func (p *flakyPeer) Err() error           { return nil }
func (p *flakyPeer) Close() error         { return nil }
