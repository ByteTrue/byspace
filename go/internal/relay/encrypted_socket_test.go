package relay

import (
	"encoding/base64"
	"encoding/binary"
	"testing"

	"github.com/coder/websocket"
)

func TestEncryptedSocketAcceptsCanonicalBase64BundlesOfVariableLength(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("variable length bundle"))
	decoded, err := decodeCanonicalBase64(encoded, -1)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != "variable length bundle" {
		t.Fatalf("decoded = %q", decoded)
	}
}

func TestEncryptedWireSizeBoundaries(t *testing.T) {
	const wireLimit = 2 << 20
	binaryMax := wireLimit - NonceSize - EncryptionOverhead
	textMax := (wireLimit/4)*3 - NonceSize - EncryptionOverhead
	for _, test := range []struct {
		messageType  websocket.MessageType
		plaintext    int
		wantWireSize int
	}{
		{websocket.MessageBinary, binaryMax, wireLimit},
		{websocket.MessageBinary, binaryMax + 1, wireLimit + 1},
		{websocket.MessageText, textMax, wireLimit},
		{websocket.MessageText, textMax + 1, wireLimit + 4},
	} {
		got, err := EncryptedWireSize(test.messageType, test.plaintext, wireLimit)
		if err != nil {
			t.Fatal(err)
		}
		if got != test.wantWireSize {
			t.Fatalf("wire size = %d, want %d", got, test.wantWireSize)
		}
	}
}

func TestEncryptedSocketRejectsOversizedOutboundFramesBeforeWrite(t *testing.T) {
	const wireLimit = 2 << 20
	connection, err := NewEncryptedSocket(nil, [KeySize]byte{}, wireLimit)
	if err != nil {
		t.Fatal(err)
	}
	binaryMax := wireLimit - NonceSize - EncryptionOverhead
	if err := connection.Write(t.Context(), websocket.MessageBinary, make([]byte, binaryMax+1)); err == nil {
		t.Fatal("oversized binary frame was accepted")
	}
	textMax := (wireLimit/4)*3 - NonceSize - EncryptionOverhead
	if err := connection.Write(t.Context(), websocket.MessageText, make([]byte, textMax+1)); err == nil {
		t.Fatal("oversized text frame was accepted")
	}
}

func TestEncryptedSocketRejectsReplayedAndReorderedFrames(t *testing.T) {
	connection := &EncryptedSocket{}
	first := make([]byte, NonceSize)
	copy(first[:16], []byte("0123456789abcdef"))
	if err := connection.acceptInboundNonce(first); err != nil {
		t.Fatalf("accept first nonce: %v", err)
	}
	if err := connection.acceptInboundNonce(first); err == nil {
		t.Fatal("replayed nonce was accepted")
	}

	connection = &EncryptedSocket{}
	second := make([]byte, NonceSize)
	copy(second[:16], []byte("0123456789abcdef"))
	binary.BigEndian.PutUint64(second[16:], 1)
	if err := connection.acceptInboundNonce(second); err == nil {
		t.Fatal("out-of-order initial nonce was accepted")
	}
}
