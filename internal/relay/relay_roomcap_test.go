package relay

import (
	"context"
	"errors"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// One room's live sockets are bounded: each is a read goroutine plus a write mutex, so an unbounded
// room is a resource-exhaustion vector. The socket past the cap is closed with TryAgainLater (1013)
// so the client backs off instead of hammering.
func TestRelayRoomRejectsSocketsPastCap(t *testing.T) {
	srv := NewServer(Options{})
	ts := httptest.NewServer(srv)
	defer ts.Close()
	wsBase := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	// Filling the room is 512 real handshakes. On a slow CI runner that alone takes ~10s, so the
	// fill gets its own generous budget: sharing one deadline left the overflow read with nothing
	// and it failed with "context deadline exceeded" instead of the close frame it must observe.
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	query := wsBase + "?serverId=srv_full&role=client&v=2&connectionId=conn_%d"
	// Fill the room to the cap with real sockets, each a distinct connection.
	held := make([]*websocket.Conn, 0, MaxRoomConns)
	defer func() {
		for _, c := range held {
			_ = c.CloseNow()
		}
	}()
	for i := 0; i < MaxRoomConns; i++ {
		c, _, err := websocket.Dial(ctx, strings.Replace(query, "%d", strconv.Itoa(i), 1), nil)
		if err != nil {
			t.Fatalf("dial %d failed before the room was full: %v", i, err)
		}
		held = append(held, c)
	}

	// The next socket must be rejected, not registered.
	overflow, _, err := websocket.Dial(ctx, strings.Replace(query, "%d", "overflow", 1), nil)
	if err != nil {
		t.Fatalf("overflow dial failed at handshake: %v", err)
	}
	defer overflow.CloseNow()
	// The close frame is already queued by the time the handshake returned, so this read only needs
	// to outlast a stalled scheduler, not the whole fill.
	readCtx, readCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer readCancel()
	_, _, err = overflow.Read(readCtx)
	var ce websocket.CloseError
	if !errors.As(err, &ce) {
		t.Fatalf("overflow read err = %v, want a websocket.CloseError", err)
	}
	if ce.Code != websocket.StatusCode(StatusTryAgainLater) {
		t.Fatalf("overflow close code = %d, want %d (TryAgainLater)", ce.Code, StatusTryAgainLater)
	}
}
