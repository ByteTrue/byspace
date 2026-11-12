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
	client, daemon, clientTransport := handshake(t, impostor, target)
	if got, _ := daemon.PeerPublicKey(); got != victim.PublicKey {
		t.Fatal("setup: target should believe the claimed key until a frame arrives")
	}
	if err := client.Send(Frame{Data: []byte(`{"type":"tunnel.open.request"}`)}); err != nil {
		t.Fatal(err)
	}
	if plain, err := daemon.Receive(clientTransport.sent[len(clientTransport.sent)-1]); err == nil && plain != nil {
		t.Fatal("a frame from a key claimant decrypted; identity by public key would be forgeable")
	}
}

// Documents why authorization needs a per-session challenge: with static keys on both sides the
// shared key is identical across sessions, so frames recorded from one session open in the next.
// If this ever starts failing, the handshake gained per-session keys and the challenge can go.
func TestStaticKeySessionsAcceptReplayedFrames(t *testing.T) {
	source, _ := GenerateKeyPair()
	target, _ := GenerateKeyPair()

	client, _, clientTransport := handshake(t, source, target)
	if err := client.Send(Frame{Data: []byte(`{"type":"tunnel.open.request","remotePort":22}`)}); err != nil {
		t.Fatal(err)
	}
	recorded := clientTransport.sent[len(clientTransport.sent)-1]

	// A relay that recorded the session replays the hello and the frame into a fresh session.
	replayTarget := NewDaemonSession(&mockTransport{}, target)
	if _, err := replayTarget.Receive(clientTransport.sent[0]); err != nil {
		t.Fatal(err)
	}
	plain, err := replayTarget.Receive(recorded)
	if err != nil || plain == nil {
		t.Fatalf("replay did not open (err=%v); update the epic: the challenge may be unnecessary", err)
	}
}
