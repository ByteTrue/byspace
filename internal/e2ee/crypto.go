package e2ee

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/nacl/box"
)

const (
	KeySize      = 32
	NonceSize    = 24
	OverheadSize = NonceSize + box.Overhead // 24 + 16 = 40 bytes
)

// KeyPair holds a 32-byte Curve25519 public/secret key pair.
type KeyPair struct {
	PublicKey [KeySize]byte
	SecretKey [KeySize]byte
}

// SharedKey holds a 32-byte precomputed XSalsa20-Poly1305 shared key.
type SharedKey [KeySize]byte

var zeroSharedKey [KeySize]byte

// GenerateKeyPair creates a new random Curve25519 key pair.
func GenerateKeyPair() (KeyPair, error) {
	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return KeyPair{}, err
	}
	return KeyPair{
		PublicKey: *pub,
		SecretKey: *priv,
	}, nil
}

// ExportKey encodes a 32-byte key as standard base64.
func ExportKey(key [KeySize]byte) string {
	return base64.StdEncoding.EncodeToString(key[:])
}

// ImportKey decodes a 32-byte key from standard base64.
func ImportKey(b64 string) ([KeySize]byte, error) {
	var out [KeySize]byte
	if b64 == "" || len(b64)%4 != 0 {
		return out, errors.New("invalid key encoding")
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return out, fmt.Errorf("invalid base64 key: %w", err)
	}
	if len(raw) != KeySize {
		return out, fmt.Errorf("invalid key length: got %d, expected %d", len(raw), KeySize)
	}
	copy(out[:], raw)
	return out, nil
}

// DeriveSharedKey computes the precomputed NaCl box shared key (HSalsa20(X25519(secret, peerPub))).
// Rejects all-zero shared secrets caused by small-order public keys.
func DeriveSharedKey(secretKey, peerPublicKey [KeySize]byte) (SharedKey, error) {
	var shared [KeySize]byte
	box.Precompute(&shared, &peerPublicKey, &secretKey)
	if subtle.ConstantTimeCompare(shared[:], zeroSharedKey[:]) == 1 {
		return SharedKey{}, errors.New("invalid peer public key (low-order point)")
	}
	return SharedKey(shared), nil
}

// Encrypt seals plaintext using XSalsa20-Poly1305 with a random 24-byte nonce.
// Output format matches packages/relay/src/crypto.ts: [nonce (24 bytes)][ciphertext...].
func Encrypt(sharedKey SharedKey, plaintext []byte) ([]byte, error) {
	var nonce [NonceSize]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
		return nil, err
	}
	shared := [KeySize]byte(sharedKey)
	out := make([]byte, NonceSize, len(plaintext)+OverheadSize)
	copy(out, nonce[:])
	out = box.SealAfterPrecomputation(out, plaintext, &nonce, &shared)
	return out, nil
}

// Decrypt opens a bundle produced by Encrypt: [nonce (24 bytes)][ciphertext...].
func Decrypt(sharedKey SharedKey, bundle []byte) ([]byte, error) {
	if len(bundle) < OverheadSize {
		return nil, errors.New("ciphertext bundle too short")
	}
	var nonce [NonceSize]byte
	copy(nonce[:], bundle[:NonceSize])
	shared := [KeySize]byte(sharedKey)
	plaintext, ok := box.OpenAfterPrecomputation(nil, bundle[NonceSize:], &nonce, &shared)
	if !ok {
		return nil, errors.New("decryption failed: authentication error")
	}
	return plaintext, nil
}
