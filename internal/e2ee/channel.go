package e2ee

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
)

const (
	RehandshakeRejectionCode       = 1008
	RehandshakeMismatchCloseReason = "E2EE re-handshake key mismatch"
)

type Capabilities struct {
	BinaryCiphertext bool `json:"binaryCiphertext,omitempty"`
}

type HelloMessage struct {
	Type         string        `json:"type"`
	Key          string        `json:"key"`
	Capabilities *Capabilities `json:"capabilities,omitempty"`
}

type ReadyMessage struct {
	Type         string        `json:"type"`
	Capabilities *Capabilities `json:"capabilities,omitempty"`
}

// Frame represents a decrypted or raw WebSocket message.
type Frame struct {
	Data     []byte
	IsBinary bool
}

// Transport abstracts the underlying WebSocket connection.
type Transport interface {
	SendText(text string) error
	SendBinary(data []byte) error
	Close(code int, reason string) error
}

// DaemonSession wraps a responder (daemon-side) encrypted channel after e2ee_hello.
type DaemonSession struct {
	mu               sync.Mutex
	transport        Transport
	daemonKeyPair    KeyPair
	sharedKey        SharedKey
	binaryCiphertext bool
	handshaked       bool
}

// NewDaemonSession creates a responder state machine that expects an e2ee_hello text frame first.
func NewDaemonSession(transport Transport, daemonKeyPair KeyPair) *DaemonSession {
	return &DaemonSession{
		transport:     transport,
		daemonKeyPair: daemonKeyPair,
	}
}

// IsReady reports whether the E2EE handshake has completed.
func (s *DaemonSession) IsReady() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.handshaked
}

// Receive processes an incoming raw frame from the transport.
// During handshake, it consumes e2ee_hello, sends e2ee_ready, and returns (nil, nil).
// Once open, it decrypts application frames and returns the plaintext Frame.
func (s *DaemonSession) Receive(raw Frame) (*Frame, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.handshaked {
		if raw.IsBinary {
			return nil, errors.New("invalid hello message: binary frame received before handshake")
		}
		var hello HelloMessage
		if err := json.Unmarshal(raw.Data, &hello); err != nil || hello.Type != "e2ee_hello" || strings.TrimSpace(hello.Key) == "" {
			return nil, fmt.Errorf("invalid hello message: %s", string(raw.Data))
		}
		clientPub, err := ImportKey(strings.TrimSpace(hello.Key))
		if err != nil {
			return nil, fmt.Errorf("invalid client public key: %w", err)
		}
		shared, err := DeriveSharedKey(s.daemonKeyPair.SecretKey, clientPub)
		if err != nil {
			return nil, err
		}
		s.sharedKey = shared
		s.binaryCiphertext = hello.Capabilities != nil && hello.Capabilities.BinaryCiphertext
		s.handshaked = true

		if err := s.sendReadyLocked(); err != nil {
			return nil, err
		}
		return nil, nil
	}

	// Check for stray plaintext handshake frames (e.g. client retrying e2ee_hello).
	if !raw.IsBinary {
		trimmed := strings.TrimSpace(string(raw.Data))
		if strings.HasPrefix(trimmed, "{") {
			var probe struct {
				Type         string        `json:"type"`
				Key          string        `json:"key"`
				Capabilities *Capabilities `json:"capabilities,omitempty"`
			}
			if err := json.Unmarshal([]byte(trimmed), &probe); err == nil {
				switch probe.Type {
				case "e2ee_hello":
					clientPub, err := ImportKey(strings.TrimSpace(probe.Key))
					if err != nil {
						_ = s.transport.Close(RehandshakeRejectionCode, RehandshakeMismatchCloseReason)
						return nil, errors.New(RehandshakeMismatchCloseReason)
					}
					retryKey, err := DeriveSharedKey(s.daemonKeyPair.SecretKey, clientPub)
					if err != nil || subtle.ConstantTimeCompare(retryKey[:], s.sharedKey[:]) != 1 {
						_ = s.transport.Close(RehandshakeRejectionCode, RehandshakeMismatchCloseReason)
						return nil, errors.New(RehandshakeMismatchCloseReason)
					}
					_ = s.sendReadyLocked()
					return nil, nil
				case "e2ee_ready":
					return nil, nil
				default:
					return nil, errors.New("received plaintext frame on encrypted channel")
				}
			}
		}
	}

	var ciphertext []byte
	var isBinaryPlaintext bool
	if s.binaryCiphertext {
		if raw.IsBinary {
			ciphertext = raw.Data
			isBinaryPlaintext = true
		} else {
			decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw.Data)))
			if err != nil {
				return nil, fmt.Errorf("invalid base64 ciphertext: %w", err)
			}
			ciphertext = decoded
			isBinaryPlaintext = false
		}
	} else {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw.Data)))
		if err != nil {
			if raw.IsBinary {
				ciphertext = raw.Data
				isBinaryPlaintext = true
			} else {
				return nil, fmt.Errorf("invalid legacy base64 ciphertext: %w", err)
			}
		} else {
			ciphertext = decoded
			isBinaryPlaintext = false
		}
	}

	plaintext, err := Decrypt(s.sharedKey, ciphertext)
	if err != nil {
		return nil, err
	}
	return &Frame{
		Data:     plaintext,
		IsBinary: isBinaryPlaintext,
	}, nil
}

// Send encrypts and transmits an application frame over the transport.
func (s *DaemonSession) Send(plain Frame) error {
	s.mu.Lock()
	if !s.handshaked {
		s.mu.Unlock()
		return errors.New("encrypted channel not open")
	}
	shared := s.sharedKey
	binaryCap := s.binaryCiphertext
	s.mu.Unlock()

	ciphertext, err := Encrypt(shared, plain.Data)
	if err != nil {
		return err
	}
	if binaryCap && plain.IsBinary {
		return s.transport.SendBinary(ciphertext)
	}
	return s.transport.SendText(base64.StdEncoding.EncodeToString(ciphertext))
}

func (s *DaemonSession) sendReadyLocked() error {
	ready := ReadyMessage{Type: "e2ee_ready"}
	if s.binaryCiphertext {
		ready.Capabilities = &Capabilities{BinaryCiphertext: true}
	}
	b, err := json.Marshal(ready)
	if err != nil {
		return err
	}
	return s.transport.SendText(string(b))
}
