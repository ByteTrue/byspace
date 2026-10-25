package server

import (
	"context"
	"sync"
	"testing"

	"github.com/coder/websocket"
)

type countingSink struct {
	mu    sync.Mutex
	count int
}

func (c *countingSink) SendText(_ context.Context, _ string) error { return nil }
func (c *countingSink) SendBinary(_ context.Context, _ []byte) error {
	c.mu.Lock()
	c.count++
	c.mu.Unlock()
	return nil
}
func (c *countingSink) Close(_ websocket.StatusCode, _ string) error { return nil }

// Subscribe returns an unsubscribe func. Dropping it meant every subscribe leaked a permanent
// callback: reopening a terminal doubled its output, and a closed socket kept receiving frames.
func TestReleaseTerminalSubscriptionsStopsDelivery(t *testing.T) {
	srv := &Server{terminalUnsubscribers: make(map[frameSink]map[string][]func())}
	sink := &countingSink{}

	var delivered int
	unsub := func() { delivered++ }
	srv.registerTerminalSubscription(sink, "term_1", unsub)

	srv.releaseTerminalSubscriptions(sink, "term_1")
	if delivered != 1 {
		t.Fatalf("unsubscribe not called: %d", delivered)
	}
	// Releasing again is a no-op, not a double-unsubscribe.
	srv.releaseTerminalSubscriptions(sink, "term_1")
	if delivered != 1 {
		t.Fatalf("double release: %d", delivered)
	}
}

// A socket may hold subscriptions to several terminals; teardown clears all of them.
func TestReleaseAllTerminalSubscriptionsOnSocketClose(t *testing.T) {
	srv := &Server{terminalUnsubscribers: make(map[frameSink]map[string][]func())}
	sink := &countingSink{}

	var mu sync.Mutex
	freed := 0
	for _, id := range []string{"term_1", "term_2"} {
		id := id
		srv.registerTerminalSubscription(sink, id, func() {
			mu.Lock()
			freed++
			mu.Unlock()
			_ = id
		})
	}
	// Subscribing twice to one terminal (a reconnect before teardown) must free both.
	srv.registerTerminalSubscription(sink, "term_1", func() {
		mu.Lock()
		freed++
		mu.Unlock()
	})

	srv.releaseTerminalSubscriptions(sink, "")
	if freed != 3 {
		t.Fatalf("expected 3 unsubscribes, got %d", freed)
	}
}
