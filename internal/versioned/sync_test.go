package versioned

import "testing"

// A generation mismatch means the collection was reset; the same sequence number refers to a
// different row, so a diff would corrupt the replica.
func TestResolveSnapshotsOnGenerationChange(t *testing.T) {
	read := Read[any]{Mode: ModeChanges, HeadSeq: 9, Removals: []Removal{{ID: "x", Seq: 8}}}

	changed := Resolve(Cursor{Generation: "old", AfterSeq: 3, HasSeq: true}, "new", read)
	if changed.Mode != ModeSnapshot || changed.Reason != ReasonGenerationChanged {
		t.Fatalf("%+v", changed)
	}
	if len(changed.Removals) != 0 {
		t.Fatal("a snapshot must not carry removals")
	}

	// No generation at all is a first-time client, which reads differently in the UI.
	none := Resolve(Cursor{}, "new", read)
	if none.Mode != ModeSnapshot || none.Reason != ReasonNoCursor {
		t.Fatalf("%+v", none)
	}

	// A generation match with a sequence is a diff.
	same := Resolve(Cursor{Generation: "new", AfterSeq: 3, HasSeq: true}, "new", read)
	if same.Mode != ModeChanges {
		t.Fatalf("%+v", same)
	}
}

// A cursor at sequence 0 is a real position (everything follows), different from no cursor.
func TestResolveTreatsCursorAtZeroAsPresent(t *testing.T) {
	read := Read[any]{Mode: ModeChanges, HeadSeq: 5}
	resolved := Resolve(Cursor{Generation: "g", AfterSeq: 0, HasSeq: true}, "g", read)
	if resolved.Mode != ModeChanges {
		t.Fatalf("a cursor at 0 must still be a diff: %+v", resolved)
	}
}

// `reason` is optional in the schema, so it is only present for a snapshot that has one.
func TestMetaOmitsReasonForChanges(t *testing.T) {
	changes := Meta("g", Read[any]{Mode: ModeChanges, HeadSeq: 3})
	if changes.Reason != "" {
		t.Fatalf("reason = %q", changes.Reason)
	}
	// Removals must be an empty list, not nil: the client iterates it.
	if changes.Removals == nil {
		t.Fatal("removals must be an empty slice")
	}

	snapshot := Meta("g", Read[any]{Mode: ModeSnapshot, Reason: ReasonCursorExpired, HeadSeq: 3})
	if snapshot.Reason != ReasonCursorExpired {
		t.Fatalf("reason = %q", snapshot.Reason)
	}
	if snapshot.Generation != "g" || snapshot.HeadSeq != 3 {
		t.Fatalf("%+v", snapshot)
	}
}
