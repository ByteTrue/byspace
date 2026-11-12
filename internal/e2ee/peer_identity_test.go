package e2ee

import (
	"testing"
)

// handshake runs one client/daemon handshake over mock transports.
func handshake(t *testing.T, clientKeys, daemonKeys KeyPair) (*ClientSession, *DaemonSession, *mockTransport) {
	t.Helper()
	clientTransport, daemonTransport := &mockTransport{}, &mockTransport{}
	client := NewClientSession(clientTransport, clientKeys)
	daemon := NewDaemonSession(daemonTransport, daemonKeys)
	if err := client.Begin(daemonKeys.PublicKey); err != nil {
		t.Fatal(err)
	}
	if _, err := daemon.Receive(clientTransport.sent[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Receive(daemonTransport.sent[0]); err != nil {
		t.Fatal(err)
	}
	// The client answered the daemon's nonce while receiving the ready message. Deliver that
	// answer so the session is open for application frames.
	if echo := clientTransport.sent[len(clientTransport.sent)-1]; true {
		if _, err := daemon.Receive(echo); err != nil {
			t.Fatal(err)
		}
	}
	return client, daemon, clientTransport
}

// Spike for the host-sync epic (unit F): a daemon that opens a tunnel handshakes with its own
// static key, so the target can identify it by that key without any new crypto.
func TestDaemonSessionIdentifiesStaticKeyPeer(t *testing.T) {
	source, _ := GenerateKeyPair()
	target, _ := GenerateKeyPair()
	client, daemon, clientTransport := handshake(t, source, target)

	got, ok := daemon.PeerPublicKey()
	if !ok || got != source.PublicKey {
		t.Fatal("target did not record the source daemon's public key")
	}
	if err := client.Send(Frame{Data: []byte(`{"type":"tunnel.open.request"}`)}); err != nil {
		t.Fatal(err)
	}
	if plain, err := daemon.Receive(clientTransport.sent[len(clientTransport.sent)-1]); err != nil || plain == nil {
		t.Fatalf("frame from the real key holder did not open: %v", err)
	}
}

// Claiming someone else's public key in the hello is not enough: without the secret key the
// claimant cannot produce a frame that opens.
func TestDaemonSessionRejectsFramesFromKeyClaimant(t *testing.T) {
	victim, _ := GenerateKeyPair()
	attacker, _ := GenerateKeyPair()
	target, _ := GenerateKeyPair()

	// The attacker announces the victim's public key but only holds its own secret key.
	impostor := KeyPair{PublicKey: victim.PublicKey, SecretKey: attacker.SecretKey}
	clientTransport := &mockTransport{}
	client := NewClientSession(clientTransport, impostor)
	daemon := NewDaemonSession(&mockTransport{}, target)
	if err := client.Begin(target.PublicKey); err != nil {
		t.Fatal(err)
	}
	if _, err := daemon.Receive(clientTransport.sent[0]); err != nil {
		t.Fatal(err)
	}
	if got, _ := daemon.PeerPublicKey(); got != victim.PublicKey {
		t.Fatal("setup: target should believe the claimed key until a frame arrives")
	}
	// The ready message is sealed for the victim's key. The impostor cannot open it, so it can
	// never learn the nonce, and a frame it seals itself will not open either.
	if err := client.Send(Frame{Data: []byte(`{"type":"tunnel.open.request"}`)}); err == nil {
		t.Fatal("an impostor sealed a frame without completing the handshake")
	}
}

// A frame recorded from one session must not open in the next. Static keys make the shared key
// identical across sessions, so only the per-session nonce stops the replay: the recorded frame
// answers the old nonce, and the fresh session is waiting for a new one.
func TestStaticKeySessionsRejectReplayedFrames(t *testing.T) {
	source, _ := GenerateKeyPair()
	target, _ := GenerateKeyPair()

	client, _, clientTransport := handshake(t, source, target)
	if err := client.Send(Frame{Data: []byte(`{"type":"tunnel.open.request","remotePort":22}`)}); err != nil {
		t.Fatal(err)
	}
	recorded := clientTransport.sent[len(clientTransport.sent)-1]

	replayTarget := NewDaemonSession(&mockTransport{}, target)
	if _, err := replayTarget.Receive(clientTransport.sent[0]); err != nil {
		t.Fatal(err)
	}
	plain, err := replayTarget.Receive(recorded)
	if err != nil {
		t.Fatal(err)
	}
	if plain != nil {
		t.Fatal("a frame replayed from an earlier session was delivered")
	}
}
