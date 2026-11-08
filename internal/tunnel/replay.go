package tunnel

import "encoding/binary"

// EncodeSequencedFrame puts sequence metadata after the payload only in the
// negotiated sequenced frame type. Plain DataDownstream is unchanged.
func EncodeSequencedFrame(opcode byte, tunnelID string, frame sequencedFrame) ([]byte, error) {
	return EncodeFrame(opcode, tunnelID, encodeSequencedPayload(frame))
}

func encodeSequencedPayload(frame sequencedFrame) []byte {
	payload := make([]byte, len(frame.Payload)+8)
	copy(payload, frame.Payload)
	binary.BigEndian.PutUint64(payload[len(frame.Payload):], frame.Sequence)
	return payload
}

func decodeSequencedPayload(payload []byte) (uint64, []byte, bool) {
	if len(payload) < 8 {
		return 0, nil, false
	}
	sequence := binary.BigEndian.Uint64(payload[len(payload)-8:])
	return sequence, payload[:len(payload)-8], true
}

// sequencedFrame carries transport metadata outside the forwarded TCP bytes.
type sequencedFrame struct {
	Sequence uint64
	Payload  []byte
}

// replayBuffer is one direction's unacknowledged window. A successful send does
// not remove bytes; only the peer's contiguous acknowledgement can do that.
type replayBuffer struct {
	next    uint64
	acked   uint64
	pending []sequencedFrame
	bytes   int
	limit   int
}

func (b *replayBuffer) append(payload []byte) bool {
	limit := b.limit
	if limit == 0 {
		limit = 16 * 1024 * 1024
	}
	if b.bytes+len(payload) > limit {
		return false
	}
	owned := append([]byte(nil), payload...)
	b.pending = append(b.pending, sequencedFrame{Sequence: b.next, Payload: owned})
	b.next++
	b.bytes += len(owned)
	return true
}

func (b *replayBuffer) acknowledge(next uint64) {
	if next <= b.acked {
		return
	}
	b.acked = next
	kept := b.pending[:0]
	for _, frame := range b.pending {
		if frame.Sequence >= next {
			kept = append(kept, frame)
		} else {
			b.bytes -= len(frame.Payload)
		}
	}
	b.pending = kept
}

func (b *replayBuffer) replayFrom(next uint64) []sequencedFrame {
	if next < b.acked {
		return nil
	}
	var frames []sequencedFrame
	for _, frame := range b.pending {
		if frame.Sequence >= next {
			frames = append(frames, frame)
		}
	}
	return frames
}

type receiveCursor struct {
	next uint64
}

func (c *receiveCursor) accept(frame sequencedFrame) ([]byte, bool) {
	if frame.Sequence != c.next {
		return nil, false
	}
	c.next++
	return frame.Payload, true
}
