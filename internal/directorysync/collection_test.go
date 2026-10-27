package directorysync

import (
	"testing"
)

type item struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func newItems() *Collection[item] {
	return NewCollection(CollectionOptions[item]{GetID: func(v item) string { return v.ID }})
}

// A cursor returns each row's latest state, not every intermediate value.
func TestReadAfterReturnsLatestPerRow(t *testing.T) {
	c := newItems()
	c.Replace(item{"one", "first"})
	cursor := c.HeadSeq()
	c.Replace(item{"one", "second"})
	c.Replace(item{"one", "latest"})
	c.Replace(item{"two", "other"})

	read := c.ReadAfter(cursor)
	if read.Mode != "changes" {
		t.Fatalf("mode = %q, want changes", read.Mode)
	}
	if read.HeadSeq != 4 {
		t.Fatalf("headSeq = %d, want 4", read.HeadSeq)
	}
	if len(read.Values) != 2 {
		t.Fatalf("values = %+v, want two rows", read.Values)
	}
	if read.Values[0].Value.Title != "latest" || read.Values[0].Seq != 3 {
		t.Fatalf("first = %+v, want the latest value at seq 3", read.Values[0])
	}
	if read.Values[1].Value.ID != "two" || read.Values[1].Seq != 4 {
		t.Fatalf("second = %+v, want two at seq 4", read.Values[1])
	}
	if len(read.Removals) != 0 {
		t.Fatalf("removals = %+v, want none", read.Removals)
	}
}

// Re-publishing an identical projection must not consume a sequence.
//
// A sequence per read would make every poll look like a change: the client's cursor is the head,
// so the next poll would return the whole table and the incrementality would be gone.
func TestUnchangedProjectionDoesNotAdvance(t *testing.T) {
	c := newItems()
	if change := c.Replace(item{"one", "same"}); change == nil || change.Seq != 1 {
		t.Fatalf("first replace = %+v, want seq 1", change)
	}
	if change := c.Replace(item{"one", "same"}); change != nil {
		t.Fatalf("identical replace advanced to %+v", change)
	}
	if change := c.Remove("one"); change == nil || change.Seq != 2 {
		t.Fatalf("remove = %+v, want seq 2", change)
	}
	if change := c.Remove("one"); change != nil {
		t.Fatalf("repeated remove advanced to %+v", change)
	}
	if c.HeadSeq() != 2 {
		t.Fatalf("headSeq = %d, want 2", c.HeadSeq())
	}
}

// A deletion travels as a removal, and resurrecting the id clears it.
func TestRemovalIsReportedAndClearedByALaterValue(t *testing.T) {
	c := newItems()
	c.Replace(item{"one", "before"})
	c.Remove("one")

	read := c.ReadAfter(1)
	if len(read.Values) != 0 {
		t.Fatalf("values = %+v, want none", read.Values)
	}
	if len(read.Removals) != 1 || read.Removals[0].ID != "one" || read.Removals[0].Seq != 2 {
		t.Fatalf("removals = %+v, want one at seq 2", read.Removals)
	}

	c.Replace(item{"one", "after"})
	read = c.ReadAfter(2)
	if len(read.Removals) != 0 {
		t.Fatalf("removals = %+v, want none after the row came back", read.Removals)
	}
	if len(read.Values) != 1 || read.Values[0].Seq != 3 {
		t.Fatalf("values = %+v, want one row at seq 3", read.Values)
	}
}

// A cursor older than the retained removals cannot be answered incrementally.
//
// It is exactly the case where a row was deleted and the tombstone has been trimmed: adding
// "nothing changed" would leave the deleted row on the client forever.
func TestCursorOlderThanRetainedRemovalsFallsBackToSnapshot(t *testing.T) {
	c := NewCollection(CollectionOptions[item]{
		GetID:         func(v item) string { return v.ID },
		MaxTombstones: 1,
	})
	c.Replace(item{"one", ""})
	c.Replace(item{"two", ""})
	c.Remove("one")
	c.Remove("two")

	read := c.ReadAfter(2)
	if read.Mode != "snapshot" || read.Reason != "cursor_expired" {
		t.Fatalf("read = %+v, want a snapshot with cursor_expired", read)
	}
	if len(read.Values) != 0 || len(read.Removals) != 0 {
		t.Fatalf("a snapshot must describe itself, not carry a delta: %+v", read)
	}
}

// A cursor from the future cannot be answered either — the client is describing a state this
// collection never produced.
func TestCursorAheadOfHeadFallsBackToSnapshot(t *testing.T) {
	c := newItems()
	c.Replace(item{"one", ""})
	if read := c.ReadAfter(99); read.Mode != "snapshot" || read.Reason != "cursor_expired" {
		t.Fatalf("read = %+v, want cursor_expired", read)
	}
}

// ReplaceAll publishes removals for rows that disappeared, which is how a poll notices a deletion.
func TestReplaceAllPublishesRemovals(t *testing.T) {
	c := newItems()
	c.ReplaceAll([]item{{"one", ""}, {"two", ""}})
	cursor := c.HeadSeq()

	c.ReplaceAll([]item{{"one", ""}})

	read := c.ReadAfter(cursor)
	if len(read.Values) != 0 {
		t.Fatalf("values = %+v, want none: one did not change", read.Values)
	}
	if len(read.Removals) != 1 || read.Removals[0].ID != "two" {
		t.Fatalf("removals = %+v, want two removed", read.Removals)
	}
}
