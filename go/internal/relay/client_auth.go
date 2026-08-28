package relay

import (
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
)

const (
	ClientAuthScheme = "hmac-sha256-v1"
	ClientAuthSize   = 32
)

var clientAuthDomain = []byte("byspace-relay-client-auth-v1\x00")

// CreateClientAuthProof binds a pairing secret to one fresh challenge, client
// ephemeral public key, and ciphertext representation negotiation.
func CreateClientAuthProof(token, challenge, clientPublicKey []byte, binaryCiphertext bool) ([ClientAuthSize]byte, error) {
	if len(token) != ClientAuthSize {
		return [ClientAuthSize]byte{}, fmt.Errorf("invalid client auth token length: got %d, want %d", len(token), ClientAuthSize)
	}
	if len(challenge) != ClientAuthSize {
		return [ClientAuthSize]byte{}, fmt.Errorf("invalid client auth challenge length: got %d, want %d", len(challenge), ClientAuthSize)
	}
	if len(clientPublicKey) != KeySize {
		return [ClientAuthSize]byte{}, fmt.Errorf("invalid client public key length: got %d, want %d", len(clientPublicKey), KeySize)
	}
	mac := hmac.New(sha256.New, token)
	_, _ = mac.Write(clientAuthDomain)
	_, _ = mac.Write(challenge)
	_, _ = mac.Write(clientPublicKey)
	if binaryCiphertext {
		_, _ = mac.Write([]byte{1})
	} else {
		_, _ = mac.Write([]byte{0})
	}
	var proof [ClientAuthSize]byte
	copy(proof[:], mac.Sum(nil))
	return proof, nil
}

// VerifyClientAuthProof compares a client proof in constant time.
func VerifyClientAuthProof(token, challenge, clientPublicKey []byte, binaryCiphertext bool, proof []byte) bool {
	if len(proof) != ClientAuthSize {
		return false
	}
	expected, err := CreateClientAuthProof(token, challenge, clientPublicKey, binaryCiphertext)
	return err == nil && hmac.Equal(expected[:], proof)
}
