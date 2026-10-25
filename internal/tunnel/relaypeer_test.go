package tunnel

import (
	"strings"
	"testing"

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
