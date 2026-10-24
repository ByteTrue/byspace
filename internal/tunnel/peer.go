package tunnel

import "errors"

// PeerConn is the initiator's connection to the target daemon.
//
// An interface rather than a concrete relay client for the same reason the rest of this codebase
// uses interfaces at process boundaries: the tunnel logic — listeners, byte pumping, teardown,
// reconnection — is what needs testing, and it should not require a relay and two E2EE handshakes
// to exercise. The production implementation wraps the relay client; tests inject an in-memory
// pair through Pipe().
type PeerConn interface {
	// Send transmits one tunnel frame.
	Send(frame Frame) error
	// Frames delivers inbound frames. Closed when the connection ends.
	Frames() <-chan Frame
	// Err reports why the connection ended, or nil for a clean close.
	Err() error
	// Close tears the connection down.
	Close() error
}

// ErrPeerClosed is returned by Send after the peer went away.
var ErrPeerClosed = errors.New("tunnel peer connection closed")

// pipePair is an in-memory PeerConn pair for tests.
type pipePair struct {
	sendCh      chan Frame
	recvCh      chan Frame
	closed      chan struct{}
	ownClosed   chan struct{}
	onPeerClose chan struct{}
	closeBoth   func()
	err         error
}

// Pipe returns two connected PeerConns: frames sent on one arrive on the other.
//
// This is the test seam. It carries the same Frame values the relay carries, so a byte-pumping
// bug shows up here exactly as it would in production.
func Pipe(buffer int) (PeerConn, PeerConn) {
	aToB := make(chan Frame, buffer)
	bToA := make(chan Frame, buffer)
	closedA := make(chan struct{})
	closedB := make(chan struct{})

	a := &pipePair{sendCh: aToB, recvCh: bToA, closed: closedA}
	b := &pipePair{sendCh: bToA, recvCh: aToB, closed: closedB}
	a.onPeerClose = closedB
	b.onPeerClose = closedA
	a.ownClosed = closedA
	b.ownClosed = closedB
	// Closing one side must unblock the other side's Frames() reader, or a reader goroutine
	// outlives the test that owned it.
	a.closeBoth = func() { closeOnce(closedA); closeOnce(closedB) }
	b.closeBoth = a.closeBoth
	return a, b
}

// closeOnce guards against double-closing a channel.
func closeOnce(ch chan struct{}) {
	defer func() { _ = recover() }()
	close(ch)
}

func (p *pipePair) Send(frame Frame) error {
	select {
	case <-p.closed:
		return ErrPeerClosed
	default:
	}
	select {
	case p.sendCh <- frame:
		return nil
	case <-p.closed:
		return ErrPeerClosed
	}
}

func (p *pipePair) Frames() <-chan Frame { return p.recvCh }

func (p *pipePair) Err() error { return p.err }

func (p *pipePair) Close() error {
	p.closeBoth()
	return nil
}
