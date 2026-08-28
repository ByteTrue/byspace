package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestDialClientSocketRejectsBinaryCiphertextDowngrade(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		socket, err := websocket.Accept(writer, request, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		challenge, _ := json.Marshal(clientChallengeMessage{
			Type:       "e2ee_challenge",
			AuthScheme: ClientAuthScheme,
			Challenge:  base64.StdEncoding.EncodeToString(make([]byte, ClientAuthSize)),
		})
		if err := socket.Write(request.Context(), websocket.MessageText, challenge); err != nil {
			return
		}
		if _, _, err := socket.Read(request.Context()); err != nil {
			return
		}
		ready := []byte(`{"type":"e2ee_ready","capabilities":{"binaryCiphertext":false}}`)
		_ = socket.Write(request.Context(), websocket.MessageText, ready)
	}))
	defer server.Close()

	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	offer := testPairingOffer()
	offer.Relay.Endpoint = parsed.Host
	offer.Relay.UseTLS = false
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	if _, err := DialEncryptedClient(ctx, offer); err == nil || !strings.Contains(err.Error(), "binary ciphertext") {
		t.Fatalf("binary ciphertext downgrade error = %v", err)
	}
}
