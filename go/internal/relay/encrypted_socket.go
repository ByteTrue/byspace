package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"sync"

	"github.com/coder/websocket"
)

type EncryptedSocket struct {
	socket          *websocket.Conn
	sharedKey       [KeySize]byte
	wireLimit       int
	sendNoncePrefix [16]byte
	sendSequence    uint64
	sendExhausted   bool
	recvNoncePrefix [16]byte
	recvSequence    uint64
	recvInitialized bool
	recvExhausted   bool
	writeMu         sync.Mutex
}

func NewEncryptedSocket(socket *websocket.Conn, sharedKey [KeySize]byte, wireLimit int) (*EncryptedSocket, error) {
	if wireLimit <= NonceSize+EncryptionOverhead {
		return nil, errors.New("encrypted Relay wire limit is too small")
	}
	connection := &EncryptedSocket{socket: socket, sharedKey: sharedKey, wireLimit: wireLimit}
	if _, err := rand.Read(connection.sendNoncePrefix[:]); err != nil {
		return nil, fmt.Errorf("generate Relay nonce prefix: %w", err)
	}
	return connection, nil
}

func (connection *EncryptedSocket) Read(ctx context.Context) (websocket.MessageType, []byte, error) {
	messageType, data, err := connection.socket.Read(ctx)
	if err != nil {
		return 0, nil, err
	}
	return connection.OpenMessage(messageType, data)
}

func (connection *EncryptedSocket) OpenMessage(messageType websocket.MessageType, data []byte) (websocket.MessageType, []byte, error) {
	var bundle []byte
	var err error
	switch messageType {
	case websocket.MessageText:
		bundle, err = decodeCanonicalBase64(string(data), -1)
		if err != nil {
			return 0, nil, errors.New("received plaintext frame on encrypted Relay channel")
		}
	case websocket.MessageBinary:
		bundle = data
	default:
		return 0, nil, errors.New("unsupported Relay WebSocket frame")
	}
	plaintext, err := Open(connection.sharedKey, bundle)
	if err != nil {
		return 0, nil, err
	}
	if err := connection.acceptInboundNonce(bundle); err != nil {
		return 0, nil, err
	}
	return messageType, plaintext, nil
}

func (connection *EncryptedSocket) Write(ctx context.Context, messageType websocket.MessageType, data []byte) error {
	wireSize, err := EncryptedWireSize(messageType, len(data), connection.wireLimit)
	if err != nil {
		return err
	}
	if wireSize > connection.wireLimit {
		return fmt.Errorf("encrypted Relay frame exceeds %d-byte limit", connection.wireLimit)
	}
	connection.writeMu.Lock()
	defer connection.writeMu.Unlock()
	if connection.sendExhausted {
		return errors.New("Relay encrypted channel nonce sequence exhausted")
	}
	var nonce [NonceSize]byte
	copy(nonce[:16], connection.sendNoncePrefix[:])
	binary.BigEndian.PutUint64(nonce[16:], connection.sendSequence)
	if connection.sendSequence == ^uint64(0) {
		connection.sendExhausted = true
	} else {
		connection.sendSequence++
	}
	bundle, err := Seal(connection.sharedKey, nonce[:], data)
	if err != nil {
		return err
	}
	if messageType == websocket.MessageText {
		bundle = []byte(base64.StdEncoding.EncodeToString(bundle))
	}
	return connection.socket.Write(ctx, messageType, bundle)
}

func EncryptedWireSize(messageType websocket.MessageType, plaintextSize, wireLimit int) (int, error) {
	if messageType != websocket.MessageText && messageType != websocket.MessageBinary {
		return 0, errors.New("unsupported daemon WebSocket frame")
	}
	if plaintextSize < 0 || plaintextSize > wireLimit {
		return wireLimit + 1, nil
	}
	encryptedSize := NonceSize + EncryptionOverhead + plaintextSize
	if messageType == websocket.MessageText {
		return base64.StdEncoding.EncodedLen(encryptedSize), nil
	}
	return encryptedSize, nil
}

func (connection *EncryptedSocket) acceptInboundNonce(bundle []byte) error {
	if connection.recvExhausted {
		return errors.New("Relay encrypted channel nonce sequence exhausted")
	}
	prefix := bundle[:16]
	sequence := binary.BigEndian.Uint64(bundle[16:NonceSize])
	if !connection.recvInitialized {
		if sequence != 0 {
			return errors.New("Relay encrypted channel nonce sequence did not start at zero")
		}
		copy(connection.recvNoncePrefix[:], prefix)
		connection.recvInitialized = true
	} else if !bytes.Equal(prefix, connection.recvNoncePrefix[:]) {
		return errors.New("Relay encrypted channel nonce prefix changed")
	}
	if sequence != connection.recvSequence {
		return errors.New("Relay encrypted channel frame was replayed or reordered")
	}
	if connection.recvSequence == ^uint64(0) {
		connection.recvExhausted = true
	} else {
		connection.recvSequence++
	}
	return nil
}

func (connection *EncryptedSocket) WritePlaintext(ctx context.Context, messageType websocket.MessageType, data []byte) error {
	connection.writeMu.Lock()
	defer connection.writeMu.Unlock()
	return connection.socket.Write(ctx, messageType, data)
}

func (connection *EncryptedSocket) Close(status websocket.StatusCode, reason string) error {
	return connection.socket.Close(status, reason)
}

func (connection *EncryptedSocket) CloseNow() error {
	return connection.socket.CloseNow()
}
