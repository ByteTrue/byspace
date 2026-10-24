package versioned

// Cursor is a client's position in the synchronised directory.
type Cursor struct {
	// Generation is the token the client last saw. A different one means the collection was reset
	// (a daemon restart, a full resync) and the cursor's sequences mean nothing.
	Generation string
	// AfterSeq is the last sequence the client has applied. Zero with an empty generation means
	// "no cursor", which is distinct from "cursor at the start".
	AfterSeq int64
	// HasSeq distinguishes a cursor at sequence 0 from an absent cursor. Sequences start at 1, so
	// zero is unambiguous, but being explicit avoids the question entirely.
	HasSeq bool
}

// SyncMeta is the synchronisation envelope carried by a list response.
type SyncMeta struct {
	Generation string    `json:"generation"`
	HeadSeq    int64     `json:"headSeq"`
	Mode       string    `json:"mode"`
	Reason     string    `json:"reason,omitempty"`
	Removals   []Removal `json:"removals"`
}

// Resolve turns a cursor into a read mode for one collection.
//
// Three outcomes, and the distinction matters to the client: `no_cursor` and `generation_changed`
// both mean "replace your replica", while an expired cursor means the same thing but for a
// different reason — the history it needed was trimmed, not reset.
func Resolve(cursor Cursor, generation string, read Read[any]) Read[any] {
	if cursor.Generation != generation {
		reason := ReasonGenerationChanged
		if cursor.Generation == "" {
			reason = ReasonNoCursor
		}
		read.Mode = ModeSnapshot
		read.Reason = reason
		read.Removals = nil
		return read
	}
	if !cursor.HasSeq {
		read.Mode = ModeSnapshot
		read.Reason = ReasonNoCursor
		read.Removals = nil
		return read
	}
	return read
}

// Meta builds the sync envelope for a read.
func Meta(generation string, read Read[any]) SyncMeta {
	meta := SyncMeta{
		Generation: generation,
		HeadSeq:    read.HeadSeq,
		Mode:       read.Mode,
		Removals:   read.Removals,
	}
	// `reason` is omitted for a changes response: the schema declares it optional, and an empty
	// string would render as a reason that does not exist.
	if read.Reason != "" && read.Mode == ModeSnapshot {
		meta.Reason = read.Reason
	}
	if meta.Removals == nil {
		meta.Removals = []Removal{}
	}
	return meta
}
