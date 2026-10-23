package server

import (
	"testing"
	"time"
)

// There is exactly one timeline epoch. A second field with the same meaning once existed in a
// different format, and the two disagreed on every response: the client compares the epoch on a
// prompt index against the epoch it already holds from the timeline cursor, so the chat outline saw
// every index as stale and never rendered. This guard makes reintroducing a divergent epoch a
// failure rather than a silent client-side drop.
func TestCurrentTimelineEpochIsTheServerEpoch(t *testing.T) {
	srv := &Server{epoch: "ep_test_value"}
	if got := srv.currentTimelineEpoch(); got != srv.epoch {
		t.Fatalf("currentTimelineEpoch() = %q, want the server epoch %q", got, srv.epoch)
	}
}

// The epoch is stamped on a timeline response, its cursors, and a prompt index alike. They must all
// carry the same value or the client discards whichever one disagrees.
func TestEpochIsConsistentAcrossResponses(t *testing.T) {
	srv := &Server{epoch: "ep_consistent"}
	// Everything that stamps an epoch routes through these two reads; if either drifts from the
	// field the responses stop agreeing.
	if srv.currentTimelineEpoch() != srv.epoch {
		t.Fatal("currentTimelineEpoch drifted from the epoch field")
	}
	// A fresh daemon mints one epoch and never mutates it, so two reads are identical.
	before := srv.currentTimelineEpoch()
	time.Sleep(time.Millisecond)
	if after := srv.currentTimelineEpoch(); before != after {
		t.Fatalf("epoch changed within one process lifetime: %q -> %q", before, after)
	}
}
