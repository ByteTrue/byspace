package tunnel

import (
	"bytes"
	"strings"
	"testing"
)

// The layout is `opcode | idLen | id | payload`, matching the TypeScript codec byte for byte.
// A Go daemon and a TypeScript client interoperate, so the bytes are not free to change.
func TestFrameRoundTrip(t *testing.T) {
	payload := []byte("hello bytes")
	encoded, err := EncodeFrame(OpcodeDataUpstream, "stream-1", payload)
	if err != nil {
		t.Fatal(err)
	}
	if encoded[0] != OpcodeDataUpstream {
		t.Fatalf("opcode = %#x", encoded[0])
	}
	if int(encoded[1]) != len("stream-1") {
		t.Fatalf("idLen = %d", encoded[1])
	}
	if string(encoded[2:2+len("stream-1")]) != "stream-1" {
		t.Fatalf("id = %q", encoded[2:2+len("stream-1")])
	}
	if !bytes.Equal(encoded[2+len("stream-1"):], payload) {
		t.Fatal("payload mismatch")
	}

	decoded, ok := DecodeFrame(encoded)
	if !ok {
		t.Fatal("decode failed")
	}
	if decoded.Opcode != OpcodeDataUpstream || decoded.TunnelID != "stream-1" {
		t.Fatalf("decoded %+v", decoded)
	}
	if !bytes.Equal(decoded.Payload, payload) {
		t.Fatalf("payload = %q", decoded.Payload)
	}
}

// A close frame carries no payload.
func TestCloseFrameHasNoPayload(t *testing.T) {
	encoded, err := EncodeFrame(OpcodeClose, "s", nil)
	if err != nil {
		t.Fatal(err)
	}
	decoded, ok := DecodeFrame(encoded)
	if !ok || decoded.Opcode != OpcodeClose || len(decoded.Payload) != 0 {
		t.Fatalf("%+v ok=%v", decoded, ok)
	}
}

// The demultiplexer tries each opcode family in turn, so "not a tunnel frame" must be a plain
// false rather than an error.
func TestDecodeRejectsForeignFrames(t *testing.T) {
	cases := [][]byte{
		nil,
		{0x20},                 // too short
		{0x01, 0x02, 'a', 'b'}, // terminal opcode
		{0x10, 0x02, 'a', 'b'}, // file-transfer opcode
		{0x20, 0x00},           // zero-length id
		{0x20, 0x05, 'a'},      // id longer than the buffer
	}
	for _, data := range cases {
		if _, ok := DecodeFrame(data); ok {
			t.Fatalf("decoded %v as a tunnel frame", data)
		}
	}
}

func TestEncodeRejectsBadIDs(t *testing.T) {
	if _, err := EncodeFrame(OpcodeDataUpstream, "", nil); err == nil {
		t.Fatal("empty id must fail")
	}
	long := strings.Repeat("x", MaxTunnelIDLength+1)
	if _, err := EncodeFrame(OpcodeDataUpstream, long, nil); err == nil {
		t.Fatal("over-long id must fail")
	}
	// Exactly at the limit is fine: the length fits in one byte.
	if _, err := EncodeFrame(OpcodeDataUpstream, strings.Repeat("x", MaxTunnelIDLength), nil); err != nil {
		t.Fatalf("id at the limit: %v", err)
	}
}

// The decoder copies the payload; the websocket reader reuses its buffer.
func TestDecodeCopiesPayload(t *testing.T) {
	encoded, err := EncodeFrame(OpcodeDataUpstream, "s", []byte("abc"))
	if err != nil {
		t.Fatal(err)
	}
	decoded, ok := DecodeFrame(encoded)
	if !ok {
		t.Fatal("decode failed")
	}
	for i := range encoded {
		encoded[i] = 0xFF
	}
	if string(decoded.Payload) != "abc" {
		t.Fatalf("payload aliased the input buffer: %q", decoded.Payload)
	}
}
