package terminal

import (
	"bytes"
	"testing"
)

// A truncated chunk written to disk would corrupt the file, and the upload would then "succeed"
// with bad content — so a malformed frame is an error, not a partial result.
func TestFileFrameRoundTrip(t *testing.T) {
	begin, err := EncodeFileBegin("req-1", FileBeginMetadata{
		Mime: "image/png", Size: 5, Encoding: "binary", ModifiedAt: "2026-01-01T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	frame, err := DecodeFileFrame(begin)
	if err != nil {
		t.Fatal(err)
	}
	if frame.Opcode != OpcodeFileBegin || frame.RequestID != "req-1" {
		t.Fatalf("begin: %+v", frame)
	}
	if frame.Metadata == nil || frame.Metadata.Mime != "image/png" || frame.Metadata.Size != 5 {
		t.Fatalf("metadata: %+v", frame.Metadata)
	}

	chunk, err := EncodeFileChunk("req-1", []byte("hello"))
	if err != nil {
		t.Fatal(err)
	}
	frame, err = DecodeFileFrame(chunk)
	if err != nil {
		t.Fatal(err)
	}
	if frame.Opcode != OpcodeFileChunk || !bytes.Equal(frame.Payload, []byte("hello")) {
		t.Fatalf("chunk: %+v", frame)
	}

	end, err := EncodeFileEnd("req-1")
	if err != nil {
		t.Fatal(err)
	}
	frame, err = DecodeFileFrame(end)
	if err != nil {
		t.Fatal(err)
	}
	if frame.Opcode != OpcodeFileEnd || frame.RequestID != "req-1" {
		t.Fatalf("end: %+v", frame)
	}
}

func TestDecodeFileFrameRejectsMalformed(t *testing.T) {
	cases := [][]byte{
		{},
		{byte(OpcodeFileChunk)},
		{byte(OpcodeFileChunk), 10, 'a'}, // id truncated
		{byte(OpcodeFileBegin), 3, 'a', 'b', 'c'}, // metadata length missing
		{byte(OpcodeOutput), 1, 'a'},              // not a file frame
	}
	for _, raw := range cases {
		if _, err := DecodeFileFrame(raw); err == nil {
			t.Fatalf("%v should have been rejected", raw)
		}
	}
}

// A terminal frame must not be mistaken for a file frame, or an upload would be written to a pty.
func TestIsFileTransferOpcode(t *testing.T) {
	for _, op := range []Opcode{OpcodeFileBegin, OpcodeFileChunk, OpcodeFileEnd} {
		if !IsFileTransferOpcode(op) {
			t.Fatalf("0x%02x should be a file opcode", op)
		}
	}
	for _, op := range []Opcode{OpcodeOutput, OpcodeInput, OpcodeResize, OpcodeSnapshot, OpcodeRestore} {
		if IsFileTransferOpcode(op) {
			t.Fatalf("0x%02x must not be a file opcode", op)
		}
	}
}

// The frame is length-prefixed by a single byte, so a long request id must fail rather than
// silently truncate the length and desynchronise the stream.
func TestFileFrameRejectsLongRequestID(t *testing.T) {
	long := make([]byte, 300)
	for i := range long {
		long[i] = 'a'
	}
	if _, err := EncodeFileChunk(string(long), nil); err == nil {
		t.Fatal("a request id over 255 bytes must be rejected")
	}
}
