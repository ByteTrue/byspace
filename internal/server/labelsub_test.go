package server

import (
	"testing"
)

// `subscribe: true` records that this client's cursor is current, so a future per-client cursor
// does not have to re-derive it.
func TestLabelSubscribeIsRecorded(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	if got := srv.labelSubscriberCount(); got != 0 {
		t.Fatalf("count = %d", got)
	}
	sink := &recordingSink{}
	srv.addLabelSubscriber(sink)
	if got := srv.labelSubscriberCount(); got != 1 {
		t.Fatalf("count = %d", got)
	}
	// Adding twice is idempotent: a reconnecting client must not inflate the count.
	srv.addLabelSubscriber(sink)
	if got := srv.labelSubscriberCount(); got != 1 {
		t.Fatalf("count after re-subscribe = %d", got)
	}
	srv.removeLabelSubscriber(sink)
	if got := srv.labelSubscriberCount(); got != 0 {
		t.Fatalf("count after removal = %d", got)
	}
}
