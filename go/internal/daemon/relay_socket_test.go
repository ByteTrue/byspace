package daemon

import (
	"testing"

	"byspace/internal/relay"
	"github.com/coder/websocket"
)

func TestRelayEncryptedWireSizeBoundaries(t *testing.T) {
	binaryMax := relayWireReadLimit - relay.NonceSize - relay.EncryptionOverhead
	textMax := (relayWireReadLimit/4)*3 - relay.NonceSize - relay.EncryptionOverhead
	for _, test := range []struct {
		name          string
		messageType   websocket.MessageType
		plaintextSize int
		wantWireSize  int
	}{
		{name: "binary exact", messageType: websocket.MessageBinary, plaintextSize: binaryMax, wantWireSize: relayWireReadLimit},
		{name: "binary oversized", messageType: websocket.MessageBinary, plaintextSize: binaryMax + 1, wantWireSize: relayWireReadLimit + 1},
		{name: "text exact", messageType: websocket.MessageText, plaintextSize: textMax, wantWireSize: relayWireReadLimit},
		{name: "text oversized", messageType: websocket.MessageText, plaintextSize: textMax + 1, wantWireSize: relayWireReadLimit + 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := relayEncryptedWireSize(test.messageType, test.plaintextSize)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.wantWireSize {
				t.Fatalf("wire size = %d, want %d", got, test.wantWireSize)
			}
		})
	}
}

func TestRelayEncryptedSocketRejectsOversizedOutboundFramesBeforeWrite(t *testing.T) {
	connection := &relayEncryptedSocket{}
	binaryMax := relayWireReadLimit - relay.NonceSize - relay.EncryptionOverhead
	if err := connection.Write(t.Context(), websocket.MessageBinary, make([]byte, binaryMax+1)); err == nil {
		t.Fatal("oversized binary frame was accepted")
	}
	textMax := (relayWireReadLimit/4)*3 - relay.NonceSize - relay.EncryptionOverhead
	if err := connection.Write(t.Context(), websocket.MessageText, make([]byte, textMax+1)); err == nil {
		t.Fatal("oversized text frame was accepted")
	}
}
