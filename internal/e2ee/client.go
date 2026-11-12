package e2ee

import (
	"encoding/base64"
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
		if ready.Challenge != "" {
			// Answer inside the channel. The daemon drops every frame until it sees this nonce, which a
			// replay of an older session cannot contain.
			if err := s.sendChallengeEchoLocked(ready.Challenge); err != nil {
				return nil, err
			}
		}
		return nil, nil
	}

	if !raw.IsBinary {
		// A plaintext frame after the handshake is either a repeated hello (harmless, the peer
		// retrying) or a protocol error. Text ciphertext is base64, not JSON, so it must continue
		// to the decrypt path rather than being rejected before its encoding is examined.
		trimmed := strings.TrimSpace(string(raw.Data))
		if strings.HasPrefix(trimmed, "{") {
			var probe struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal([]byte(trimmed), &probe); err == nil {
				switch probe.Type {
				case "e2ee_ready", "e2ee_hello":
					return nil, nil
				default:
					return nil, errors.New("received plaintext frame on encrypted channel")
				}
			}
		}
	}

	var ciphertext []byte
	if s.binaryCiphertext {
		if raw.IsBinary {
			ciphertext = raw.Data
		} else {
			decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw.Data)))
			if err != nil {
				return nil, fmt.Errorf("invalid base64 ciphertext: %w", err)
			}
			ciphertext = decoded
		}
	} else {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw.Data)))
		if err != nil {
			// COMPAT(binaryCiphertext): added in v0.2.3, remove base64-only receive mode after
			// 2027-01-27. Peers that never negotiated the capability may send raw binary ciphertext.
			if raw.IsBinary {
				ciphertext = raw.Data
			} else {
				return nil, fmt.Errorf("invalid legacy base64 ciphertext: %w", err)
			}
		} else {
			ciphertext = decoded
		}
	}
	plaintext, err := Decrypt(s.sharedKey, ciphertext)
	if err != nil {
		return nil, err
	}
	return &Frame{Data: plaintext, IsBinary: raw.IsBinary}, nil
}

// Send encrypts and transmits one frame.
func (s *ClientSession) Send(plain Frame) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.handshaked {
		return errors.New("e2ee session not ready")
	}
	key := s.sharedKey
	binaryCiphertext := s.binaryCiphertext

	sealed, err := Encrypt(key, plain.Data)
	if err != nil {
		return err
	}
	if binaryCiphertext && plain.IsBinary {
		return s.transport.SendBinary(sealed)
	}
	return s.transport.SendText(base64.StdEncoding.EncodeToString(sealed))
}

// sendChallengeEchoLocked answers the daemon's nonce. Called with s.mu held, straight after the
// handshake, before any application frame.
func (s *ClientSession) sendChallengeEchoLocked(challenge string) error {
	body, err := json.Marshal(map[string]string{"type": "e2ee_challenge", "challenge": challenge})
	if err != nil {
		return err
	}
	sealed, err := Encrypt(s.sharedKey, body)
	if err != nil {
		return err
	}
	return s.transport.SendText(base64.StdEncoding.EncodeToString(sealed))
}
