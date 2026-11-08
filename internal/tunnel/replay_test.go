package tunnel

import (
	"bytes"
	"testing"
)

func TestReplayBufferKeepsOnlyUnacknowledgedFrames(t *testing.T) {
	var buffer replayBuffer
	for _, payload := range [][]byte{[]byte("one"), []byte("two"), []byte("three")} {
		if !buffer.append(payload) {
			t.Fatal("within-budget append rejected")
		}
	}
	buffer.acknowledge(2)
	frames := buffer.replayFrom(2)
	if len(frames) != 1 || frames[0].Sequence != 2 || !bytes.Equal(frames[0].Payload, []byte("three")) {
		t.Fatalf("replay = %+v", frames)
	}
	buffer.acknowledge(3)
	if len(buffer.replayFrom(3)) != 0 {
		t.Fatal("acknowledged frame retained")
	}
}

func TestReplayBufferRejectsCapacityAndInvalidCursor(t *testing.T) {
	var buffer replayBuffer
	buffer.limit = 5
	if buffer.append([]byte("1234")) != true {
		t.Fatal("first frame rejected")
	}
	if buffer.append([]byte("56")) {
		t.Fatal("capacity overflow accepted")
	}
	buffer.acknowledge(1)
	if !buffer.append([]byte("56")) {
		t.Fatal("acknowledged bytes were not released")
	}
	buffer.acknowledge(99)
	if len(buffer.replayFrom(0)) != 0 {
		t.Fatal("invalid cursor must not fabricate a replay")
	}
}

func TestSequencedFrameKeepsMetadataOutOfTCPPayload(t *testing.T) {
	encoded, err := EncodeSequencedFrame(OpcodeDataDownstreamSeq, "stream-1", sequencedFrame{Sequence: 42, Payload: []byte("data: body\n\n")})
	if err != nil {
		t.Fatal(err)
	}
	frame, ok := DecodeFrame(encoded)
	if !ok || frame.Opcode != OpcodeDataDownstreamSeq {
		t.Fatalf("decode = %+v ok=%v", frame, ok)
	}
	sequence, payload, ok := decodeSequencedPayload(frame.Payload)
	if !ok || sequence != 42 || string(payload) != "data: body\n\n" {
		t.Fatalf("sequence=%d payload=%q ok=%v", sequence, payload, ok)
	}
}

func TestReceiveCursorAcceptsOnlyContiguousFrames(t *testing.T) {
	var cursor receiveCursor
	if _, ok := cursor.accept(sequencedFrame{Sequence: 1, Payload: []byte("second")}); ok {
		t.Fatal("gap accepted")
	}
	payload, ok := cursor.accept(sequencedFrame{Sequence: 0, Payload: []byte("first")})
	if !ok || string(payload) != "first" || cursor.next != 1 {
		t.Fatalf("first frame = %q ok=%v next=%d", payload, ok, cursor.next)
	}
	if _, ok := cursor.accept(sequencedFrame{Sequence: 0, Payload: []byte("first")}); ok {
		t.Fatal("duplicate accepted")
	}
}
