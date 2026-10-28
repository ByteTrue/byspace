package tunnel

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/e2ee"
)

// The initiator URL must carry the peer's serverId and the client role; the relay rejects a
// missing role with a 400 and an unknown path with a 404, and both look like "the tunnel is
// broken" from the outside.
func TestClientURL(t *testing.T) {
	r := &TunnelReconnector{RelayURL: "wss://relay.example.com/", PeerServerID: "srv_abc", ClientID: "tun-1"}
	got, err := r.clientURL()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"serverId=srv_abc", "role=client", "v=2", "clientId=tun-1", "/ws?"} {
		if !strings.Contains(got, want) {
			t.Fatalf("URL %q missing %q", got, want)
		}
	}
	if _, err := (&TunnelReconnector{RelayURL: "ws://x"}).clientURL(); err == nil {
		t.Fatal("a tunnel without a peer serverId must fail before dialling")
	}
}

// The initiator side of the E2EE handshake is what a daemon never needed: it only ever served
// browsers. Driving it against the real daemon-side session is the only way to know the two
// halves agree, and it needs no relay.
func TestClientSessionHandshakeAndFrame(t *testing.T) {
	daemonKeys, err := e2ee.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	clientKeys, err := e2ee.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	clientSide := &memoryTransport{}
	daemonSide := &memoryTransport{}
	clientSide.peer = daemonSide
	daemonSide.peer = clientSide

	client := e2ee.NewClientSession(clientSide, clientKeys)
	daemon := e2ee.NewDaemonSession(daemonSide, daemonKeys)

	if err := client.Begin(daemonKeys.PublicKey); err != nil {
		t.Fatal(err)
	}

	// The daemon consumes the hello and answers with ready; the client consumes the ready.
	hello := daemonSide.take()
	if plain, recvErr := daemon.Receive(hello); recvErr != nil || plain != nil {
		t.Fatalf("daemon handshake: plain=%v err=%v", plain, recvErr)
	}
	ready := clientSide.take()
	if plain, recvErr := client.Receive(ready); recvErr != nil || plain != nil {
		t.Fatalf("client handshake: plain=%v err=%v", plain, recvErr)
	}
	if !client.IsReady() || !daemon.IsReady() {
		t.Fatalf("handshake incomplete: client=%v daemon=%v", client.IsReady(), daemon.IsReady())
	}

	// A tunnel frame sealed by the client must decrypt on the daemon side.
	encoded, err := EncodeFrame(OpcodeDataUpstream, "s1", []byte("payload"))
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Send(e2ee.Frame{Data: encoded, IsBinary: true}); err != nil {
		t.Fatal(err)
	}
	sealed := daemonSide.take()
	plain, err := daemon.Receive(sealed)
	if err != nil || plain == nil {
		t.Fatalf("daemon decrypt: plain=%v err=%v", plain, err)
	}
	frame, ok := DecodeFrame(plain.Data)
	if !ok || frame.TunnelID != "s1" || string(frame.Payload) != "payload" {
		t.Fatalf("frame = %+v ok=%v", frame, ok)
	}
}

// memoryTransport is a one-slot in-memory e2ee.Transport pair.
type memoryTransport struct {
	peer  *memoryTransport
	boxed []e2ee.Frame
}

func (m *memoryTransport) SendText(text string) error {
	m.peer.boxed = append(m.peer.boxed, e2ee.Frame{Data: []byte(text), IsBinary: false})
	return nil
}

func (m *memoryTransport) SendBinary(data []byte) error {
	m.peer.boxed = append(m.peer.boxed, e2ee.Frame{Data: append([]byte(nil), data...), IsBinary: true})
	return nil
}

func (m *memoryTransport) Close(int, string) error { return nil }

// take pops the oldest delivered frame.
func (m *memoryTransport) take() e2ee.Frame {
	if len(m.boxed) == 0 {
		panic("no frame delivered")
	}
	f := m.boxed[0]
	m.boxed = m.boxed[1:]
	return f
}

// A tunnel must keep its socket busy even when it is forwarding nothing.
//
// The relay drops a WebSocket that has been silent for about a minute. A tunnel is silent by nature
// — it forwards only while a local client is connected — so it was torn down and rebuilt roughly
// every minute, which is the `StatusServiceRestart "Server disconnected"` that appeared in the
// daemon log while both ends were healthy. A rebuild landing mid-stream would cut a response in half.
func TestTunnelKeepaliveCadence(t *testing.T) {
	// The relay's idle tolerance is about a minute. Pinging must be comfortably inside it, or the
	// socket is reaped before the first ping of the next window.
	if tunnelPingInterval >= time.Minute {
		t.Fatalf("tunnelPingInterval = %v, want well below the relay's one-minute idle window", tunnelPingInterval)
	}
	// A ping must have time to complete, but not so long that a dead socket looks alive.
	if tunnelPingTimeout <= 0 || tunnelPingTimeout >= tunnelPingInterval {
		t.Fatalf("tunnelPingTimeout = %v, want a positive value below the interval", tunnelPingTimeout)
	}
}

// The keepalive actually pings, and a failed ping finishes the peer.
//
// Without this the loop could be wired but never fire — the constants would still look right and
// every existing test would pass, because nothing shortens the twenty-second cadence.
func TestKeepalivePingsAndDiesOnFailure(t *testing.T) {
	prevInterval, prevTimeout := tunnelPingInterval, tunnelPingTimeout
	tunnelPingInterval, tunnelPingTimeout = 20*time.Millisecond, 20*time.Millisecond
	t.Cleanup(func() { tunnelPingInterval, tunnelPingTimeout = prevInterval, prevTimeout })

	var calls atomic.Int32
	var transport relayTransport
	peer := &relayPeer{
		transport: &transport,
		frames:    make(chan Frame, 8),
		done:      make(chan struct{}),
		logf:      t.Logf,
		ping: func(context.Context) error {
			if calls.Add(1) >= 2 {
				return errors.New("ping failed")
			}
			return nil
		},
	}
	peer.startKeepalive()

	select {
	case <-peer.done:
	case <-time.After(3 * time.Second):
		t.Fatal("a failing ping did not finish the peer")
	}
	if calls.Load() < 2 {
		t.Fatalf("pinged %d times, want at least 2", calls.Load())
	}
	if peer.err == nil {
		t.Fatal("the peer finished without recording why")
	}
}

// A closed peer stops its keepalive, and closing twice is safe.
//
// The loop waits on the peer's done channel; without that it would outlive the connection and keep
// pinging a socket that belongs to nobody.
func TestRelayPeerKeepaliveStopsOnClose(t *testing.T) {
	peer := &relayPeer{
		frames: make(chan Frame, 8),
		done:   make(chan struct{}),
		logf:   t.Logf,
	}
	peer.startKeepalive()

	peer.finish(nil)
	select {
	case <-peer.done:
	case <-time.After(2 * time.Second):
		t.Fatal("finish did not close done")
	}
	// A second close must not panic; sync.Once guards it.
	peer.finish(errors.New("again"))
}
