package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"

	"github.com/coder/websocket"
)

const DefaultWireReadLimit = 2 << 20

type clientChallengeMessage struct {
	Type       string `json:"type"`
	Challenge  string `json:"challenge"`
	AuthScheme string `json:"authScheme"`
}

type clientHelloMessage struct {
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

type clientReadyMessage struct {
	Type         string `json:"type"`
	Capabilities struct {
		BinaryCiphertext bool `json:"binaryCiphertext"`
	} `json:"capabilities"`
}

func DialEncryptedClient(ctx context.Context, offer PairingOfferV3) (*EncryptedSocket, error) {
	if err := offer.Validate(); err != nil {
		return nil, err
	}
	scheme := "ws"
	if offer.Relay.UseTLS {
		scheme = "wss"
	}
	endpoint := url.URL{Scheme: scheme, Host: offer.Relay.Endpoint, Path: "/ws"}
	query := endpoint.Query()
	query.Set("role", "client")
	query.Set("serverId", offer.ServerID)
	query.Set("v", "2")
	endpoint.RawQuery = query.Encode()

	socket, response, err := websocket.Dial(ctx, endpoint.String(), nil)
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		return nil, fmt.Errorf("connect to Relay: %w", err)
	}
	ready := false
	defer func() {
		if !ready {
			_ = socket.CloseNow()
		}
	}()
	socket.SetReadLimit(DefaultWireReadLimit)

	messageType, data, err := socket.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("read Relay E2EE challenge: %w", err)
	}
	if messageType != websocket.MessageText {
		return nil, errors.New("Relay E2EE challenge must be a text frame")
	}
	var challenge clientChallengeMessage
	if err := decodeStrictJSON(data, &challenge); err != nil || challenge.Type != "e2ee_challenge" || challenge.AuthScheme != ClientAuthScheme {
		return nil, errors.New("invalid Relay E2EE challenge")
	}
	challengeBytes, err := decodeCanonicalBase64(challenge.Challenge, ClientAuthSize)
	if err != nil {
		return nil, errors.New("invalid Relay E2EE challenge")
	}

	clientPublicKey, clientSecretKey, err := GenerateKeyPair()
	if err != nil {
		return nil, fmt.Errorf("generate Relay client key: %w", err)
	}
	token, err := offer.ClientAuthToken()
	if err != nil {
		return nil, err
	}
	proof, err := CreateClientAuthProof(token[:], challengeBytes, clientPublicKey[:], true)
	if err != nil {
		return nil, err
	}
	hello := clientHelloMessage{Type: "e2ee_hello", Key: base64.StdEncoding.EncodeToString(clientPublicKey[:])}
	hello.Capabilities.BinaryCiphertext = true
	hello.Auth.Scheme = ClientAuthScheme
	hello.Auth.Proof = base64.StdEncoding.EncodeToString(proof[:])
	helloData, err := json.Marshal(hello)
	if err != nil {
		return nil, fmt.Errorf("encode Relay E2EE hello: %w", err)
	}
	if err := socket.Write(ctx, websocket.MessageText, helloData); err != nil {
		return nil, fmt.Errorf("send Relay E2EE hello: %w", err)
	}

	messageType, data, err = socket.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("read Relay E2EE ready: %w", err)
	}
	if messageType != websocket.MessageText {
		return nil, errors.New("Relay E2EE ready must be a text frame")
	}
	var confirmation clientReadyMessage
	if err := decodeStrictJSON(data, &confirmation); err != nil || confirmation.Type != "e2ee_ready" {
		return nil, errors.New("invalid Relay E2EE ready confirmation")
	}
	if !confirmation.Capabilities.BinaryCiphertext {
		return nil, errors.New("Relay E2EE peer did not confirm required binary ciphertext capability")
	}
	daemonPublicKey, err := offer.DaemonPublicKey()
	if err != nil {
		return nil, err
	}
	sharedKey, err := DeriveSharedKey(clientSecretKey[:], daemonPublicKey[:])
	if err != nil {
		return nil, fmt.Errorf("derive Relay shared key: %w", err)
	}
	connection, err := NewEncryptedSocket(socket, sharedKey, DefaultWireReadLimit)
	if err != nil {
		return nil, err
	}
	ready = true
	return connection, nil
}
