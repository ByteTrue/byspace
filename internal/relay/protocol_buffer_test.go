package relay

import (
	"fmt"
	"testing"
)

// The offline buffer must bound bytes per connection, not just frame count: a frame can be up to
// the 64MiB read limit, so 200 of them is gigabytes. Oldest frames are evicted to stay under budget.
func TestFrameBufferBoundsBytesPerConn(t *testing.T) {
	b := newFrameBuffer()
	const size = 1 << 20 // 1MiB; budget is 4MiB, so six frames must shed the two oldest.
	for i := 0; i < 6; i++ {
		data := make([]byte, size)
		data[0] = byte(i)
		b.add("conn", MessageBinary, data)
	}
	if b.bytes["conn"] > MaxBufferedBytesPerConn {
		t.Fatalf("conn bytes = %d, want <= %d", b.bytes["conn"], MaxBufferedBytesPerConn)
	}
	frames := b.take("conn")
	if len(frames) != 4 {
		t.Fatalf("retained %d frames, want 4 (newest within 4MiB)", len(frames))
	}
	for i, f := range frames {
		if f.data[0] != byte(i+2) {
			t.Fatalf("frames[%d] marker = %d, want %d (oldest two must be evicted)", i, f.data[0], i+2)
		}
	}
	if b.total != 0 || len(b.frames) != 0 || len(b.bytes) != 0 {
		t.Fatalf("take left accounting dirty: total=%d frames=%d bytes=%d", b.total, len(b.frames), len(b.bytes))
	}
}

// A single frame larger than a whole connection's budget can never be held; drop it rather than
// let one message blow the budget.
func TestFrameBufferDropsOversizedFrame(t *testing.T) {
	b := newFrameBuffer()
	b.add("conn", MessageBinary, make([]byte, MaxBufferedBytesPerConn+1))
	if len(b.frames) != 0 || b.total != 0 {
		t.Fatalf("oversized frame was buffered: frames=%d total=%d", len(b.frames), b.total)
	}
	if frames := b.take("conn"); len(frames) != 0 {
		t.Fatalf("take returned %d frames for a dropped oversized frame", len(frames))
	}
}

// The original frame-count cap still holds for tiny frames.
func TestFrameBufferCapsFrameCount(t *testing.T) {
	b := newFrameBuffer()
	for i := 0; i < MaxBufferedFrames+10; i++ {
		b.add("conn", MessageBinary, []byte{byte(i)})
	}
	frames := b.take("conn")
	if len(frames) != MaxBufferedFrames {
		t.Fatalf("retained %d frames, want %d", len(frames), MaxBufferedFrames)
	}
	if frames[0].data[0] != 10 {
		t.Fatalf("oldest retained marker = %d, want 10 (first ten evicted)", frames[0].data[0])
	}
}

// A client must not grow the connection map without bound by opening endless connections.
func TestFrameBufferCapsConnectionCount(t *testing.T) {
	b := newFrameBuffer()
	for i := 0; i < MaxBufferedConns+5; i++ {
		b.add(fmt.Sprintf("conn_%d", i), MessageBinary, []byte{byte(i)})
		if len(b.frames) > MaxBufferedConns {
			t.Fatalf("buffered %d connections, want <= %d", len(b.frames), MaxBufferedConns)
		}
	}
	if len(b.frames) != MaxBufferedConns {
		t.Fatalf("final connection count = %d, want %d", len(b.frames), MaxBufferedConns)
	}
}

// The room ceiling bounds total bytes across all connections, so one flooding client cannot exhaust
// the Durable Object's memory while its daemon is offline.
func TestFrameBufferBoundsRoomTotal(t *testing.T) {
	b := newFrameBuffer()
	// Each connection holds one full-budget frame; the room fits at most ceiling/perConn of them.
	maxConns := MaxBufferedBytesTotal / MaxBufferedBytesPerConn
	for i := 0; i < maxConns+4; i++ {
		b.add(fmt.Sprintf("conn_%d", i), MessageBinary, make([]byte, MaxBufferedBytesPerConn))
		if b.total > MaxBufferedBytesTotal {
			t.Fatalf("room total = %d, want <= %d", b.total, MaxBufferedBytesTotal)
		}
		if len(b.frames) > maxConns {
			t.Fatalf("buffered %d connections, want <= %d under the room ceiling", len(b.frames), maxConns)
		}
	}
}

// take and drop must release the byte accounting exactly, or the room ceiling drifts upward forever.
func TestFrameBufferTakeAndDropAccounting(t *testing.T) {
	b := newFrameBuffer()
	b.add("a", MessageBinary, make([]byte, 1024))
	b.add("b", MessageBinary, make([]byte, 2048))
	if b.total != 3072 {
		t.Fatalf("total = %d, want 3072", b.total)
	}
	b.take("a")
	b.drop("b")
	if b.total != 0 || len(b.frames) != 0 || len(b.bytes) != 0 {
		t.Fatalf("accounting not released: total=%d frames=%d bytes=%d", b.total, len(b.frames), len(b.bytes))
	}
}
