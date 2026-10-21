package versioned

import "testing"

// entry is a test value with an id and a payload.
type entry struct {
	ID   string
	Body string
}

// newEntries builds a collection keyed on ID and fingerprinted on Body.
func newEntries(maxTombstones int) *Collection[entry] {
	return New(Options[entry]{
		GetID:         func(e entry) string { return e.ID },
		Fingerprint:   func(e entry) string { return e.Body },
		MaxTombstones: maxTombstones,
	})
}

// Re-publishing an unchanged value would advance the sequence for nothing and make the client
// re-render a row that did not change.
func TestReplaceUnchangedIsNotAChange(t *testing.T) {
	collection := newEntries(0)
	if change := collection.Replace(entry{ID: "a", Body: "one"}); change == nil {
		t.Fatal("the first replace is a change")
	}
	before := collection.HeadSeq()
	if change := collection.Replace(entry{ID: "a", Body: "one"}); change != nil {
		t.Fatalf("an identical value produced a change: %+v", change)
	}
	if collection.HeadSeq() != before {
		t.Fatal("the sequence advanced for an unchanged value")
	}

	// A different body is a change, and the change carries the new value.
	changed := collection.Replace(entry{ID: "a", Body: "two"})
	if changed == nil {
		t.Fatal("a changed value must be a change")
	}
	if changed.Value == nil || *changed.Value != (entry{ID: "a", Body: "two"}) {
		t.Fatalf("change = %+v", changed)
	}
}

// A removed id must stay answerable for a while, or a client whose cursor sits before the removal
// never learns that it went away and keeps showing a ghost row.
func TestRemovalIsReportedAsATombstone(t *testing.T) {
	collection := newEntries(0)
	collection.Replace(entry{ID: "a", Body: "one"})
	cursor := collection.HeadSeq()

	collection.Remove("a")

	read := collection.ReadAfter(cursor)
	if read.Mode != ModeChanges {
		t.Fatalf("mode = %q", read.Mode)
	}
	if len(read.Removals) != 1 || read.Removals[0].ID != "a" {
		t.Fatalf("removals = %+v", read.Removals)
	}
	if len(read.Values) != 0 {
		t.Fatalf("values = %+v", read.Values)
	}
}

// Two removals for one id would make the client process the same deletion twice.
func TestRemovingTwiceIsNotAChange(t *testing.T) {
	collection := newEntries(0)
	collection.Replace(entry{ID: "a"})
	if change := collection.Remove("a"); change == nil {
		t.Fatal("the first removal is a change")
	}
	if change := collection.Remove("a"); change != nil {
		t.Fatal("a second removal of the same id must be a no-op")
	}
	if change := collection.Remove("never-existed"); change != nil {
		t.Fatal("removing an unknown id must be a no-op")
	}
}

// A cursor below the expired boundary cannot be answered from history: the answer would be
// silently incomplete and the client keeps ghost rows. It gets a snapshot instead.
func TestExpiredCursorGetsSnapshot(t *testing.T) {
	collection := newEntries(2)
	collection.Replace(entry{ID: "a"})
	collection.Replace(entry{ID: "b"})
	collection.Replace(entry{ID: "c"})
	cursor := collection.HeadSeq()

	// Three removals against a bound of two: the oldest tombstone is dropped, so the cursor sits
	// before the expired boundary and cannot be answered from history.
	collection.Remove("a")
	collection.Remove("b")
	collection.Remove("c")

	read := collection.ReadAfter(cursor)
	if read.Mode != ModeSnapshot {
		t.Fatalf("mode = %q, want snapshot", read.Mode)
	}
	if read.Reason != ReasonCursorExpired {
		t.Fatalf("reason = %q", read.Reason)
	}
	// The snapshot is complete: only live values, no tombstones to apply.
	if len(read.Removals) != 0 {
		t.Fatalf("a snapshot must carry no removals: %+v", read.Removals)
	}
}

// A cursor from a different collection (above the head) is not usable either.
func TestFutureCursorGetsSnapshot(t *testing.T) {
	collection := newEntries(0)
	collection.Replace(entry{ID: "a"})
	read := collection.ReadAfter(1_000_000)
	if read.Mode != ModeSnapshot || read.Reason != ReasonCursorExpired {
		t.Fatalf("%+v", read)
	}
}

// ReplaceAll removes anything absent, through the same tombstone path as an explicit Remove.
func TestReplaceAllRemovesMissing(t *testing.T) {
	collection := newEntries(0)
	collection.Replace(entry{ID: "stale", Body: "x"})
	cursor := collection.HeadSeq()

	collection.ReplaceAll([]entry{{ID: "kept", Body: "y"}})

	read := collection.ReadAfter(cursor)
	if len(read.Removals) != 1 || read.Removals[0].ID != "stale" {
		t.Fatalf("removals = %+v", read.Removals)
	}
	if len(read.Values) != 1 {
		t.Fatalf("values = %+v", read.Values)
	}
}

// A snapshot ordered by id is stable between reads, so a client diffing two snapshots sees the same
// order for the same content.
func TestSnapshotIsOrderedByID(t *testing.T) {
	collection := newEntries(0)
	for _, id := range []string{"c", "a", "b"} {
		collection.Replace(entry{ID: id})
	}
	snapshot := collection.Snapshot("")
	if len(snapshot.Values) != 3 {
		t.Fatalf("values = %+v", snapshot.Values)
	}
	for i := 1; i < len(snapshot.Values); i++ {
		if snapshot.Values[i-1].Value.ID > snapshot.Values[i].Value.ID {
			t.Fatalf("unsorted: %+v", snapshot.Values)
		}
	}
}

// Changes are ordered by sequence so a client can apply them in order.
func TestChangesAreOrderedBySeq(t *testing.T) {
	collection := newEntries(0)
	cursor := collection.HeadSeq()
	for _, id := range []string{"c", "a", "b"} {
		collection.Replace(entry{ID: id})
	}
	read := collection.ReadAfter(cursor)
	for i := 1; i < len(read.Values); i++ {
		if read.Values[i-1].Seq > read.Values[i].Seq {
			t.Fatalf("unsorted: %+v", read.Values)
		}
	}
}
