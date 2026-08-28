package daemon

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"byspace/internal/relay"
	"github.com/coder/websocket"
)

const relayWireReadLimit = 2 << 20

type relayChallengeMessage struct {
	Type       string `json:"type"`
	Challenge  string `json:"challenge"`
	AuthScheme string `json:"authScheme"`
}

type relayHelloMessage struct {
	Type         string `json:"type"`
	Key          string `json:"key"`
	Capabilities struct {
		BinaryCiphertext bool `json:"binaryCiphertext"`
	} `json:"capabilities"`
	Auth struct {
		Scheme string `json:"scheme"`
		Proof  string `json:"proof"`
	} `json:"auth"`
}

type relayEncryptedSocket struct {
	socket          *websocket.Conn
	identity        relay.Identity
	challenge       [relay.ClientAuthSize]byte
	clientPublicKey [relay.KeySize]byte
	channel         *relay.EncryptedSocket
}

func acceptRelayEncryptedSocket(ctx context.Context, socket *websocket.Conn, identity relay.Identity) (*relayEncryptedSocket, error) {
	socket.SetReadLimit(relayWireReadLimit)
	connection := &relayEncryptedSocket{socket: socket, identity: identity}
	if _, err := rand.Read(connection.challenge[:]); err != nil {
		return nil, fmt.Errorf("generate Relay handshake challenge: %w", err)
	}
	challenge := relayChallengeMessage{
		Type:       "e2ee_challenge",
		Challenge:  base64.StdEncoding.EncodeToString(connection.challenge[:]),
		AuthScheme: "hmac-sha256-v1",
	}
	data, err := json.Marshal(challenge)
	if err != nil {
		return nil, fmt.Errorf("encode Relay handshake challenge: %w", err)
	}
	if err := socket.Write(ctx, websocket.MessageText, data); err != nil {
		return nil, fmt.Errorf("send Relay handshake challenge: %w", err)
	}
	messageType, helloData, err := socket.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("read Relay E2EE hello: %w", err)
	}
	if messageType != websocket.MessageText {
		return nil, errors.New("Relay E2EE hello must be a text frame")
	}
	if err := connection.acceptHello(helloData); err != nil {
		return nil, err
	}
	if err := connection.writeReady(ctx); err != nil {
		return nil, err
	}
	return connection, nil
}

func (connection *relayEncryptedSocket) acceptHello(data []byte) error {
	var hello relayHelloMessage
	if err := decodeSingleJSON(data, &hello); err != nil || hello.Type != "e2ee_hello" {
		return errors.New("invalid Relay E2EE hello")
	}
	if !hello.Capabilities.BinaryCiphertext {
		return errors.New("authenticated Relay clients must support binary ciphertext")
	}
	if hello.Auth.Scheme != "hmac-sha256-v1" {
		return errors.New("Relay client authentication is required")
	}
	clientPublicKey, err := decodeCanonicalBase64(hello.Key, relay.KeySize)
	if err != nil {
		return fmt.Errorf("invalid Relay client public key: %w", err)
	}
	proof, err := decodeCanonicalBase64(hello.Auth.Proof, relay.ClientAuthSize)
	if err != nil {
		return fmt.Errorf("invalid Relay client authentication proof: %w", err)
	}
	if !relay.VerifyClientAuthProof(
		connection.identity.ClientAuthToken[:],
		connection.challenge[:],
		clientPublicKey,
		true,
		proof,
	) {
		return errors.New("Relay client authentication failed")
	}
	if connection.channel != nil && !bytes.Equal(clientPublicKey, connection.clientPublicKey[:]) {
		return errors.New("Relay client attempted E2EE key rotation")
	}
	sharedKey, err := relay.DeriveSharedKey(connection.identity.SecretKey[:], clientPublicKey)
	if err != nil {
		return fmt.Errorf("derive Relay shared key: %w", err)
	}
	if connection.channel == nil {
		copy(connection.clientPublicKey[:], clientPublicKey)
		connection.channel, err = relay.NewEncryptedSocket(connection.socket, sharedKey, relayWireReadLimit)
		if err != nil {
			return err
		}
	}
	return nil
}

func (connection *relayEncryptedSocket) writeReady(ctx context.Context) error {
	if connection.channel == nil {
		return errors.New("Relay encrypted channel is not ready")
	}
	return connection.channel.WritePlaintext(ctx, websocket.MessageText, []byte(`{"type":"e2ee_ready","capabilities":{"binaryCiphertext":true}}`))
}

func (connection *relayEncryptedSocket) Read(ctx context.Context) (websocket.MessageType, []byte, error) {
	if connection.channel == nil {
		return 0, nil, errors.New("Relay encrypted channel is not ready")
	}
	for {
		messageType, data, err := connection.socket.Read(ctx)
		if err != nil {
			return 0, nil, err
		}
		if messageType == websocket.MessageText {
			var hello relayHelloMessage
			if decodeSingleJSON(data, &hello) == nil && hello.Type == "e2ee_hello" {
				if err := connection.acceptHello(data); err != nil {
					return 0, nil, err
				}
				if err := connection.writeReady(ctx); err != nil {
					return 0, nil, err
				}
				continue
			}
		}
		return connection.channel.OpenMessage(messageType, data)
	}
}

func (connection *relayEncryptedSocket) Write(ctx context.Context, messageType websocket.MessageType, data []byte) error {
	wireSize, err := relayEncryptedWireSize(messageType, len(data))
	if err != nil {
		return err
	}
	if wireSize > relayWireReadLimit {
		return fmt.Errorf("encrypted Relay frame exceeds %d-byte limit", relayWireReadLimit)
	}
	if connection.channel == nil {
		return errors.New("Relay encrypted channel is not ready")
	}
	return connection.channel.Write(ctx, messageType, data)
}

func relayEncryptedWireSize(messageType websocket.MessageType, plaintextSize int) (int, error) {
	return relay.EncryptedWireSize(messageType, plaintextSize, relayWireReadLimit)
}

func (connection *relayEncryptedSocket) Close(status websocket.StatusCode, reason string) error {
	return connection.socket.Close(status, reason)
}

func (connection *relayEncryptedSocket) CloseNow() error {
	return connection.socket.CloseNow()
}

func decodeCanonicalBase64(encoded string, size int) ([]byte, error) {
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.StdEncoding.EncodeToString(decoded) != encoded {
		return nil, errors.New("invalid base64")
	}
	if size >= 0 && len(decoded) != size {
		return nil, fmt.Errorf("invalid decoded length: got %d, want %d", len(decoded), size)
	}
	return decoded, nil
}
