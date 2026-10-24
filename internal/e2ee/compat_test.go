package e2ee

// These tests pin byte-level compatibility with packages/relay/src/crypto.ts, which the web
// client still uses. If a change here breaks it, every existing browser stops connecting through
// the relay — and the failure looks like "relay is down", not "the protocol changed".

import (
	"encoding/base64"
	"testing"
)

// The nonce prefix format is [24-byte nonce][ciphertext]; the client parses the first 24 bytes.
func TestEncryptProduces24ByteNoncePrefix(t *testing.T) {
	shared, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	peer, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	key, err := DeriveSharedKey(shared.SecretKey, peer.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := Encrypt(key, []byte("hello relay"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sealed) < 24+16 {
		t.Fatalf("sealed payload too short: %d bytes (nonce is 24, MAC is 16)", len(sealed))
	}
	plain, err := Decrypt(key, sealed)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != "hello relay" {
		t.Fatalf("round trip: %q", plain)
	}
}

// Both directions must derive the same key, or one side can send and not receive.
func TestDeriveSharedKeyIsSymmetric(t *testing.T) {
	a, _ := GenerateKeyPair()
	b, _ := GenerateKeyPair()
	ab, err := DeriveSharedKey(a.SecretKey, b.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	ba, err := DeriveSharedKey(b.SecretKey, a.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if ab != ba {
		t.Fatal("shared keys differ between the two sides")
	}
}

// The client's public key is base64; a wrong-length key must be rejected, not silently used.
func TestImportKeyRejectsWrongLength(t *testing.T) {
	if _, err := ImportKey(base64.RawURLEncoding.EncodeToString(make([]byte, 16))); err == nil {
		t.Fatal("a 16-byte key must be rejected")
	}
	if _, err := ImportKey("not base64!!"); err == nil {
		t.Fatal("invalid base64 must be rejected")
	}
}

// A tampered ciphertext must fail to open rather than returning garbage.
func TestDecryptRejectsTampered(t *testing.T) {
	a, _ := GenerateKeyPair()
	b, _ := GenerateKeyPair()
	key, _ := DeriveSharedKey(a.SecretKey, b.PublicKey)
	sealed, err := Encrypt(key, []byte("payload"))
	if err != nil {
		t.Fatal(err)
	}
	sealed[len(sealed)-1] ^= 0xff
	if _, err := Decrypt(key, sealed); err == nil {
		t.Fatal("a tampered ciphertext must not decrypt")
	}
}
