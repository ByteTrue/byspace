package e2ee

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// ClientSession is the initiator side of the E2EE handshake.
//
// The daemon only ever needed the responder side before: it serves browsers, which are clients.
// Daemon tunnels invert that — a daemon in the initiator role opens a relay connection to another
// daemon — so the same handshake has to run from the other end. The wire messages are identical;
// only who sends `e2ee_hello` first changes.
type ClientSession struct {
	transport Transport
	keyPair   KeyPair

	mu               sync.Mutex
	sharedKey        SharedKey
	handshaked       bool
	binaryCiphertext bool
}

// NewClientSession builds the initiator. `daemonKeyPair` is the local key; the peer's public key
// comes from the pairing offer and is passed to Begin.
func NewClientSession(transport Transport, daemonKeyPair KeyPair) *ClientSession {
	return &ClientSession{transport: transport, keyPair: daemonKeyPair}
}

// IsReady reports whether the handshake completed.
func (s *ClientSession) IsReady() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.handshaked
}

// Begin sends the hello that starts the handshake.
//
// Separate from Receive because the initiator must speak first: a responder waiting for a hello
// and an initiator waiting for a ready would otherwise deadlock.
func (s *ClientSession) Begin(peerPublicKey [KeySize]byte) error {
	shared, err := DeriveSharedKey(s.keyPair.SecretKey, peerPublicKey)
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.sharedKey = shared
	s.mu.Unlock()

	hello := HelloMessage{
		Type:         "e2ee_hello",
		Key:          ExportKey(s.keyPair.PublicKey),
		Capabilities: &Capabilities{BinaryCiphertext: true},
	}
	payload, err := json.Marshal(hello)
	if err != nil {
		return err
	}
	return s.transport.SendText(string(payload))
}

// Receive advances the handshake and decrypts application frames.
//
// Returns (nil, nil) for frames that are part of the handshake itself, mirroring DaemonSession:
// the caller's read loop treats them as "nothing to deliver".
func (s *ClientSession) Receive(raw Frame) (*Frame, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.handshaked {
		if raw.IsBinary {
			return nil, errors.New("invalid ready message: binary frame received before handshake")
		}
		var ready ReadyMessage
		if err := json.Unmarshal(raw.Data, &ready); err != nil || ready.Type != "e2ee_ready" {
			return nil, fmt.Errorf("invalid ready message: %s", string(raw.Data))
		}
		s.binaryCiphertext = ready.Capabilities != nil && ready.Capabilities.BinaryCiphertext
		s.handshaked = true
		return nil, nil
	}

	if !raw.IsBinary {
		// A plaintext frame after the handshake is either a repeated hello (harmless, the peer
		// retrying) or a protocol error. Never application data: that would be unencrypted.
		trimmed := strings.TrimSpace(string(raw.Data))
		if strings.HasPrefix(trimmed, "{") {
			var probe struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal([]byte(trimmed), &probe); err == nil {
				switch probe.Type {
				case "e2ee_ready", "e2ee_hello":
					return nil, nil
				}
			}
		}
		return nil, errors.New("received plaintext frame on encrypted channel")
	}

	// Both sides carry the ciphertext in binary frames, so decryption is the same either way;
	// `binaryCiphertext` only matters for Send, where the choice is per-session.
	plaintext, err := Decrypt(s.sharedKey, raw.Data)
	if err != nil {
		return nil, err
	}
	return &Frame{Data: plaintext, IsBinary: s.binaryCiphertext}, nil
}

// Send encrypts and transmits one frame.
func (s *ClientSession) Send(plain Frame) error {
	s.mu.Lock()
	if !s.handshaked {
		s.mu.Unlock()
		return errors.New("e2ee session not ready")
	}
	key := s.sharedKey
	binaryCiphertext := s.binaryCiphertext
	s.mu.Unlock()

	sealed, err := Encrypt(key, plain.Data)
	if err != nil {
		return err
	}
	if binaryCiphertext {
		return s.transport.SendBinary(sealed)
	}
	return s.transport.SendText(string(sealed))
}
