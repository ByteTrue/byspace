package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/e2ee"
	"github.com/ByteTrue/byspace/internal/relay"
	"github.com/ByteTrue/byspace/internal/terminal"
)

// relaySession dials a daemon through an in-process relay and completes the E2EE handshake,
// the way a remote client does. It returns the socket and the shared key the frames travel under.
func relaySession(t *testing.T, srv *Server) (*websocket.Conn, e2ee.SharedKey, func()) {
	t.Helper()
	relaySrv := relay.NewServer(relay.Options{})
	relayTS := httptest.NewServer(relaySrv)
	relayWSURL := "ws" + strings.TrimPrefix(relayTS.URL, "http") + "/ws"

	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = srv.ConnectRelay(ctx, relayWSURL) }()
	time.Sleep(40 * time.Millisecond)

	dialCtx, dialCancel := context.WithTimeout(context.Background(), 5*time.Second)
	conn, _, err := websocket.Dial(dialCtx, relayWSURL+"?serverId="+srv.ServerID()+"&role=client&v=2&connectionId=conn_pw", nil)
	if err != nil {
		dialCancel()
		cancel()
		relayTS.Close()
		t.Fatal(err)
	}

	clientKP, _ := e2ee.GenerateKeyPair()
	daemonPub, _ := e2ee.ImportKey(srv.PublicKeyB64())
	shared, _ := e2ee.DeriveSharedKey(clientKP.SecretKey, daemonPub)

	hello, _ := json.Marshal(e2ee.HelloMessage{
		Type:         "e2ee_hello",
		Key:          e2ee.ExportKey(clientKP.PublicKey),
		Capabilities: &e2ee.Capabilities{BinaryCiphertext: true},
	})
	if err := conn.Write(dialCtx, websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	if _, raw, err := conn.Read(dialCtx); err != nil || !strings.Contains(string(raw), "e2ee_ready") {
		t.Fatalf("expected e2ee_ready, got %q (err=%v)", raw, err)
	} else {
		// Answer the daemon's nonce or it will swallow the first real frame.
		var ready e2ee.ReadyMessage
		_ = json.Unmarshal(raw, &ready)
		if ready.Challenge != "" {
			body, _ := json.Marshal(map[string]string{"type": "e2ee_challenge", "challenge": ready.Challenge})
			cipher, _ := e2ee.Encrypt(shared, body)
			if err := conn.Write(dialCtx, websocket.MessageText, []byte(base64.StdEncoding.EncodeToString(cipher))); err != nil {
				t.Fatal(err)
			}
		}
	}
	dialCancel()

	cleanup := func() {
		conn.CloseNow()
		cancel()
		relayTS.Close()
	}
	return conn, shared, cleanup
}

// writeEncrypted sends one BySpace frame the way the relay transport does: ciphertext, base64.
func writeEncrypted(t *testing.T, conn *websocket.Conn, shared e2ee.SharedKey, plain string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cipher, err := e2ee.Encrypt(shared, []byte(plain))
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(base64.StdEncoding.EncodeToString(cipher))); err != nil {
		t.Fatal(err)
	}
}

// readEncrypted reads one frame back and decrypts it.
func readEncrypted(t *testing.T, conn *websocket.Conn, shared e2ee.SharedKey) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, raw, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	cipher, err := base64.StdEncoding.DecodeString(string(raw))
	if err != nil {
		t.Fatalf("frame was not base64 ciphertext: %s", raw)
	}
	plain, err := e2ee.Decrypt(shared, cipher)
	if err != nil {
		t.Fatal(err)
	}
	return string(plain)
}

func passwordFrame(password string) string {
	b, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "auth.password.submit.request",
			"requestId": "req_pw",
			"password":  password,
		},
	})
	return string(b)
}

// A daemon with no password refuses a relay connection instead of serving it.
func TestRelayConnectionRefusedWhenNoPasswordSet(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	conn, shared, cleanup := relaySession(t, srv)
	defer cleanup()

	writeEncrypted(t, conn, shared, passwordFrame(""))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := conn.Read(ctx)
	if err == nil {
		t.Fatal("passwordless daemon accepted a relay connection")
	}
}

// The wrong password is refused, and the daemon answers nothing useful before it.
func TestRelayConnectionRefusedOnWrongPassword(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	setDaemonPassword(t, srv, "correct")
	conn, shared, cleanup := relaySession(t, srv)
	defer cleanup()

	writeEncrypted(t, conn, shared, passwordFrame("wrong"))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := conn.Read(ctx)
	if err == nil {
		t.Fatal("daemon accepted a relay connection with the wrong password")
	}
}

// The right password, sent inside the encrypted channel, unlocks the session.
func TestRelayConnectionAcceptsPasswordInsideChannel(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	setDaemonPassword(t, srv, "correct")
	conn, shared, cleanup := relaySession(t, srv)
	defer cleanup()

	writeEncrypted(t, conn, shared, passwordFrame("correct"))
	reply := readEncrypted(t, conn, shared)
	if !strings.Contains(reply, `"auth.password.submit.response"`) || !strings.Contains(reply, `"ok":true`) {
		t.Fatalf("password was not accepted: %s", reply)
	}

	writeEncrypted(t, conn, shared, `{"type":"hello","clientId":"remote","protocolVersion":1}`)
	info := readEncrypted(t, conn, shared)
	if !strings.Contains(info, `"status":"server_info"`) || !strings.Contains(info, srv.ServerID()) {
		t.Fatalf("no server_info after authentication: %s", info)
	}
}

// Saying hello before the password is refused: the password is not optional.
func TestRelayConnectionRefusesHelloBeforePassword(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	setDaemonPassword(t, srv, "correct")
	conn, shared, cleanup := relaySession(t, srv)
	defer cleanup()

	writeEncrypted(t, conn, shared, `{"type":"hello","clientId":"remote","protocolVersion":1}`)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := conn.Read(ctx)
	if err == nil {
		t.Fatal("daemon accepted a hello before the password")
	}
}

// writeEncryptedBinary sends one binary frame the way the relay transport seals terminal and
// tunnel traffic: ciphertext in a WebSocket binary message.
func writeEncryptedBinary(t *testing.T, conn *websocket.Conn, shared e2ee.SharedKey, plain []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cipher, err := e2ee.Encrypt(shared, plain)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageBinary, cipher); err != nil {
		t.Fatal(err)
	}
}

// A relay socket that answered the e2ee challenge but never proved the daemon password is a
// tunnel peer at best. Terminal input is an operator surface, so it must not spawn a session:
// before this gate, any socket holding a pairing offer got a shell on the host.
func TestRelayConnectionCannotSpawnTerminalWithoutPassword(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	setDaemonPassword(t, srv, "correct")
	conn, shared, cleanup := relaySession(t, srv)
	defer cleanup()

	writeEncryptedBinary(t, conn, shared, terminal.EncodeFrame(terminal.OpcodeInput, 7, []byte("id\n")))

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		srv.mu.Lock()
		_, spawned := srv.terminals[7]
		srv.mu.Unlock()
		if spawned {
			t.Fatal("an unauthenticated relay socket spawned a terminal session")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// The same socket, once it proves the password, is the operator and may drive a terminal.
	writeEncrypted(t, conn, shared, passwordFrame("correct"))
	if reply := readEncrypted(t, conn, shared); !strings.Contains(reply, `"ok":true`) {
		t.Fatalf("password was not accepted: %s", reply)
	}
	writeEncryptedBinary(t, conn, shared, terminal.EncodeFrame(terminal.OpcodeInput, 7, []byte("id\n")))
	waitForTerminalSlot(t, srv, 7)
}

// waitForTerminalSlot polls until the slot exists; the frame is handled on the read loop's
// goroutine, so the test observes state instead of waiting on a signal.
func waitForTerminalSlot(t *testing.T, srv *Server, slot uint8) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		srv.mu.Lock()
		_, ok := srv.terminals[slot]
		srv.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("terminal slot %d was never created", slot)
}

// Broadcasts are session data: agent output, status, workspaces. A relay socket joins the
// broadcast set only when it proves the password, not when the socket opens. Every broadcast walks
// s.clients and skips the entries marked unhandshaked, so the mark is the property under test.
func TestRelayConnectionReceivesNoBroadcastBeforePassword(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	setDaemonPassword(t, srv, "correct")
	conn, shared, cleanup := relaySession(t, srv)
	defer cleanup()

	// The socket is registered but unhandshaked: excluded from every broadcast.
	if !soleClientUnhandshaked(t, srv) {
		t.Fatal("a relay socket that proved no password is in the broadcast set")
	}

	writeEncrypted(t, conn, shared, passwordFrame("correct"))
	if reply := readEncrypted(t, conn, shared); !strings.Contains(reply, `"ok":true`) {
		t.Fatalf("password was not accepted: %s", reply)
	}

	// The password flips the same socket into the broadcast set.
	if soleClientUnhandshaked(t, srv) {
		t.Fatal("an authenticated relay socket is still outside the broadcast set")
	}
}

// soleClientUnhandshaked waits for the relay socket to appear in s.clients and reports whether it
// is still marked unhandshaked.
func soleClientUnhandshaked(t *testing.T, srv *Server) bool {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		srv.mu.Lock()
		count := len(srv.clients)
		unhandshaked := false
		for _, handshaked := range srv.clients {
			unhandshaked = !handshaked
		}
		srv.mu.Unlock()
		if count == 1 {
			return unhandshaked
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("relay socket never registered in s.clients (have %d)", len(srv.clients))
	return false
}
