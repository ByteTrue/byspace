// Package relay implements the daemon side of the Relay wire contract.
package relay

import (
	"crypto/rand"
	"errors"
	"fmt"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/box"
)

const (
	KeySize            = 32
	NonceSize          = 24
	EncryptionOverhead = box.Overhead
)

var (
	ErrInvalidPeerPublicKey = errors.New("invalid peer public key")
	ErrAuthentication       = errors.New("relay message authentication failed")
)

func GenerateKeyPair() ([KeySize]byte, [KeySize]byte, error) {
	publicKey, secretKey, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return [KeySize]byte{}, [KeySize]byte{}, err
	}
	return *publicKey, *secretKey, nil
}

// DeriveSharedKey implements NaCl box.before. It rejects low-order peer keys
// instead of allowing box.Precompute to derive a key from an all-zero X25519 result.
func DeriveSharedKey(secretKey, peerPublicKey []byte) ([KeySize]byte, error) {
	var sharedKey [KeySize]byte
	if len(secretKey) != KeySize {
		return sharedKey, fmt.Errorf("invalid secret key length: got %d, want %d", len(secretKey), KeySize)
	}
	if len(peerPublicKey) != KeySize {
		return sharedKey, fmt.Errorf("invalid peer public key length: got %d, want %d", len(peerPublicKey), KeySize)
	}
	if _, err := curve25519.X25519(secretKey, peerPublicKey); err != nil {
		return sharedKey, fmt.Errorf("%w: %v", ErrInvalidPeerPublicKey, err)
	}

	var secret, peer [KeySize]byte
	copy(secret[:], secretKey)
	copy(peer[:], peerPublicKey)
	box.Precompute(&sharedKey, &peer, &secret)
	return sharedKey, nil
}

// Seal returns the copied Web Relay framing: nonce followed by the authenticated
// XSalsa20-Poly1305 ciphertext. The caller must never reuse a nonce with a key.
func Seal(sharedKey [KeySize]byte, nonce, plaintext []byte) ([]byte, error) {
	if len(nonce) != NonceSize {
		return nil, fmt.Errorf("invalid nonce length: got %d, want %d", len(nonce), NonceSize)
	}
	var nonceArray [NonceSize]byte
	copy(nonceArray[:], nonce)

	bundle := make([]byte, NonceSize, NonceSize+EncryptionOverhead+len(plaintext))
	copy(bundle, nonce)
	return box.SealAfterPrecomputation(bundle, plaintext, &nonceArray, &sharedKey), nil
}

// Open authenticates and decrypts a nonce-prefixed Relay bundle.
func Open(sharedKey [KeySize]byte, bundle []byte) ([]byte, error) {
	if len(bundle) < NonceSize+EncryptionOverhead {
		return nil, fmt.Errorf("encrypted relay bundle too short: got %d, want at least %d", len(bundle), NonceSize+EncryptionOverhead)
	}
	var nonce [NonceSize]byte
	copy(nonce[:], bundle[:NonceSize])
	plaintext, ok := box.OpenAfterPrecomputation(nil, bundle[NonceSize:], &nonce, &sharedKey)
	if !ok {
		return nil, ErrAuthentication
	}
	return plaintext, nil
}
