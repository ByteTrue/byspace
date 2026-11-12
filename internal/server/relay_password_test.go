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
