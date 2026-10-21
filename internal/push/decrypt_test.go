package push

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"io"
	"testing"

	"golang.org/x/crypto/hkdf"
)

// The only proof the encryption is right is a decryptor built from the subscriber's private key
// recovering the payload. A test that merely checks the bytes look plausible passes on a wrong
// key derivation too.
func TestEncryptPayloadRoundTrip(t *testing.T) {
	uaKey, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	authSecret := make([]byte, 16)
	if _, err := rand.Read(authSecret); err != nil {
		t.Fatal(err)
	}
	sub := Subscription{
		Endpoint: "https://fcm.googleapis.com/fcm/send/abc",
		P256DH:   base64.RawURLEncoding.EncodeToString(uaKey.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(authSecret),
	}

	payload := []byte(`{"title":"build finished","body":"all green"}`)
	body, err := EncryptPayload(sub, payload)
	if err != nil {
		t.Fatal(err)
	}

	// --- subscriber side, per RFC 8291 §4 ---
	salt := body[0:16]
	rs := binary.BigEndian.Uint32(body[16:20])
	_ = rs
	idLen := int(body[20])
	asPublic := body[21 : 21+idLen]
	ct := body[21+idLen:]

	asKey, err := ecdh.P256().NewPublicKey(asPublic)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := uaKey.ECDH(asKey)
	if err != nil {
		t.Fatal(err)
	}

	keyInfo := append([]byte("WebPush: info\x00"), uaKey.PublicKey().Bytes()...)
	keyInfo = append(keyInfo, asPublic...)
	prkKey := hkdf.Extract(sha256.New, shared, authSecret)
	ikm := readN(hkdf.Expand(sha256.New, prkKey, keyInfo), 32)

	prk := hkdf.Extract(sha256.New, ikm, salt)
	cek := readN(hkdf.Expand(sha256.New, prk, []byte("Content-Encoding: aes128gcm\x00")), 16)
	nonce := readN(hkdf.Expand(sha256.New, prk, []byte("Content-Encoding: nonce\x00")), 12)

	block, err := aes.NewCipher(cek)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		t.Fatalf("decryption failed: %v", err)
	}

	// The final record carries a 0x02 delimiter, which the delimiter-stripping step removes.
	if len(plaintext) == 0 || plaintext[len(plaintext)-1] != 0x02 {
		t.Fatalf("missing the final-record delimiter: %x", plaintext)
	}
	got := plaintext[:len(plaintext)-1]
	if !bytes.Equal(got, payload) {
		t.Fatalf("payload mismatch:\n got %q\nwant %q", got, payload)
	}
}

func readN(r io.Reader, n int) []byte {
	out := make([]byte, n)
	_, _ = io.ReadFull(r, out)
	return out
}
