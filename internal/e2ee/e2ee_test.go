package e2ee

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
)

type mockTransport struct {
	sent []Frame
	code int
	rsn  string
}

func (m *mockTransport) SendText(text string) error {
	m.sent = append(m.sent, Frame{Data: []byte(text), IsBinary: false})
	return nil
}

func (m *mockTransport) SendBinary(data []byte) error {
	cp := append([]byte(nil), data...)
	m.sent = append(m.sent, Frame{Data: cp, IsBinary: true})
	return nil
}

func (m *mockTransport) Close(code int, reason string) error {
	m.code = code
	m.rsn = reason
	return nil
}

func TestCryptoRoundTripAndTamper(t *testing.T) {
	alice, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	bob, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	sharedA, err := DeriveSharedKey(alice.SecretKey, bob.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	sharedB, err := DeriveSharedKey(bob.SecretKey, alice.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if sharedA != sharedB {
		t.Fatal("derived shared keys do not match")
	}

	msg := []byte("hello from go e2ee")
	sealed, err := Encrypt(sharedA, msg)
	if err != nil {
		t.Fatal(err)
	}
	if len(sealed) != len(msg)+OverheadSize {
		t.Fatalf("unexpected bundle length: got %d, want %d", len(sealed), len(msg)+OverheadSize)
	}

	opened, err := Decrypt(sharedB, sealed)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(opened, msg) {
		t.Fatalf("decrypted mismatch: got %q, want %q", opened, msg)
	}

	// Tamper with ciphertext
	sealed[len(sealed)-1] ^= 0xff
	if _, err := Decrypt(sharedB, sealed); err == nil {
		t.Fatal("expected tampered bundle to fail authentication")
	}
}

func TestDaemonSessionHandshakeAndFrames(t *testing.T) {
	daemonKP, _ := GenerateKeyPair()
	clientKP, _ := GenerateKeyPair()
	clientShared, _ := DeriveSharedKey(clientKP.SecretKey, daemonKP.PublicKey)

	tr := &mockTransport{}
	sess := NewDaemonSession(tr, daemonKP)

	helloBytes, _ := json.Marshal(HelloMessage{
		Type:         "e2ee_hello",
		Key:          ExportKey(clientKP.PublicKey),
		Capabilities: &Capabilities{BinaryCiphertext: true},
	})

	out, err := sess.Receive(Frame{Data: helloBytes, IsBinary: false})
	if err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	if out != nil {
		t.Fatalf("expected nil frame on hello, got %+v", out)
	}
	if !sess.IsReady() || len(tr.sent) != 1 {
		t.Fatalf("expected 1 e2ee_ready frame, got %d", len(tr.sent))
	}

	// Client sends encrypted JSON text frame (base64 encoded)
	plainJSON := []byte(`{"type":"ping"}`)
	cipherJSON, _ := Encrypt(clientShared, plainJSON)
	b64JSON := base64.StdEncoding.EncodeToString(cipherJSON)

	decText, err := sess.Receive(Frame{Data: []byte(b64JSON), IsBinary: false})
	if err != nil {
		t.Fatalf("decrypt text frame failed: %v", err)
	}
	if decText.IsBinary || string(decText.Data) != string(plainJSON) {
		t.Fatalf("unexpected decrypted text frame: %+v", decText)
	}

	// Daemon sends binary frame (terminal output)
	termBytes := []byte{0x01, 0x00, 'h', 'i'}
	if err := sess.Send(Frame{Data: termBytes, IsBinary: true}); err != nil {
		t.Fatal(err)
	}
	lastSent := tr.sent[len(tr.sent)-1]
	if !lastSent.IsBinary {
		t.Fatal("expected binary ciphertext frame when binaryCiphertext=true")
	}
	openedTerm, err := Decrypt(clientShared, lastSent.Data)
	if err != nil || !bytes.Equal(openedTerm, termBytes) {
		t.Fatalf("failed to decrypt daemon binary frame: %v", err)
	}

	// Re-hello with different key must be rejected with 1008
	attackerKP, _ := GenerateKeyPair()
	badHello, _ := json.Marshal(HelloMessage{
		Type: "e2ee_hello",
		Key:  ExportKey(attackerKP.PublicKey),
	})
	if _, err := sess.Receive(Frame{Data: badHello, IsBinary: false}); err == nil {
		t.Fatal("expected key rotation re-hello to be rejected")
	}
	if tr.code != RehandshakeRejectionCode {
		t.Fatalf("expected close code %d, got %d", RehandshakeRejectionCode, tr.code)
	}
}
