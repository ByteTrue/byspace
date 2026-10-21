// Package versioned provides incrementally synchronisable collections.
//
// Ported from directory-sync/internal/versioned-collection.ts. A client keeps a cursor and asks
// "what changed since sequence N"; the collection answers with upserts and removals, or with a
// full snapshot when the cursor is unusable.
//
// The pieces that matter, each solving a failure that a naive "send the whole list" design has:
//
//   - A fingerprint per value. Re-publishing an unchanged value would advance the sequence for
//     nothing, and the client would re-render a row that did not change.
//   - Tombstones. A removed id must stay answerable for a while, or a client whose cursor sits
//     before the removal never learns that it went away and keeps showing a ghost row.
//   - A bounded tombstone history. Without the bound the map grows forever; with the bound, a
//     cursor older than the oldest retained tombstone is expired and gets a snapshot instead of a
//     silently incomplete answer.
package versioned

import (
	"sort"
	"sync"
)

// Value is one item with its sequence number.
type Value[T any] struct {
	Seq   int64 `json:"seq"`
	Value T     `json:"value"`
}

// Removal is a tombstone.
type Removal struct {
	ID  string `json:"id"`
	Seq int64  `json:"seq"`
}

// ReadMode values.
const (
	ModeChanges  = "changes"
	ModeSnapshot = "snapshot"
)

// Reasons a snapshot was returned instead of changes.
const (
	ReasonNoCursor          = "no_cursor"
	ReasonGenerationChanged = "generation_changed"
	ReasonCursorExpired     = "cursor_expired"
)

// Read is the answer to a read request.
type Read[T any] struct {
	Mode     string     `json:"mode"`
	Reason   string     `json:"reason,omitempty"`
	HeadSeq  int64      `json:"headSeq"`
	Values   []Value[T] `json:"values"`
	Removals []Removal  `json:"removals"`
}

// Change is a published upsert or removal.
type Change[T any] struct {
	Kind  string `json:"kind"`
	Seq   int64  `json:"seq"`
	Value *T     `json:"value,omitempty"`
	ID    string `json:"id,omitempty"`
}

// Options configures a collection.
type Options[T any] struct {
	// GetID identifies a value. Required.
	GetID func(T) string
	// Fingerprint decides whether a value changed. Nil means "any replace is a change".
	Fingerprint func(T) string
	// MaxTombstones bounds the removal history. Zero means the default.
	MaxTombstones int
}

// Collection is a sequence-numbered map with change tracking.
type Collection[T any] struct {
	mu      sync.Mutex
	options Options[T]
	maxTomb int
	nextSeq int64
	values  map[string]storedValue[T]
	tomb    map[string]int64
	// expiredThrough is the highest sequence a tombstone may have been dropped at. A cursor at or
	// below it cannot be answered from the remaining history, so it is told to snapshot.
	expiredThrough int64
	// generation changes when the collection is reset wholesale; a cursor from before the reset
	// refers to sequences that no longer mean anything.
	generation string
}

// storedValue keeps the fingerprint beside the value.
type storedValue[T any] struct {
	seq         int64
	fingerprint string
	value       T
}

// New builds an empty collection.
func New[T any](options Options[T]) *Collection[T] {
	maxTombstones := options.MaxTombstones
	if maxTombstones <= 0 {
		maxTombstones = 5000
	}
	return &Collection[T]{
		options: options,
		maxTomb: maxTombstones,
		values:  make(map[string]storedValue[T]),
		tomb:    make(map[string]int64),
		nextSeq: 1,
	}
}

// HeadSeq reports the newest sequence that has been assigned.
//
// Not nextSeq: a client using this as a cursor means "I have seen everything up to here", and
// nextSeq is one past the last assigned value. Returning nextSeq would make the cursor look like a
// future one and every read would be answered with a snapshot.
func (c *Collection[T]) HeadSeq() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.nextSeq - 1
}

// Generation reports the collection's generation token.
func (c *Collection[T]) Generation() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.generation
}

// SetGeneration records a new generation, which invalidates cursors from the old one.
func (c *Collection[T]) SetGeneration(generation string) {
	c.mu.Lock()
	c.generation = generation
	c.mu.Unlock()
}

// SequenceFor reports the sequence a value or removal was last assigned.
func (c *Collection[T]) SequenceFor(id string) (int64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if stored, ok := c.values[id]; ok {
		return stored.seq, true
	}
	if seq, ok := c.tomb[id]; ok {
		return seq, true
	}
	return 0, false
}

// Replace inserts or updates a value, returning nil when nothing changed.
//
// The nil return is load-bearing: a caller that treats every Replace as a change would advance the
// sequence on every poll, and the client would re-render every row forever.
func (c *Collection[T]) Replace(value T) *Change[T] {
	c.mu.Lock()
	defer c.mu.Unlock()

	id := c.options.GetID(value)
	fingerprint := ""
	if c.options.Fingerprint != nil {
		fingerprint = c.options.Fingerprint(value)
	}
	if previous, ok := c.values[id]; ok && c.options.Fingerprint != nil && previous.fingerprint == fingerprint {
		return nil
	}

	seq := c.advanceLocked()
	c.values[id] = storedValue[T]{seq: seq, fingerprint: fingerprint, value: value}
	delete(c.tomb, id)
	copied := value
	return &Change[T]{Kind: "upsert", Seq: seq, Value: &copied}
}

// Remove deletes a value, recording a tombstone.
func (c *Collection[T]) Remove(id string) *Change[T] {
	c.mu.Lock()
	defer c.mu.Unlock()

	_, live := c.values[id]
	_, alreadyTombstoned := c.tomb[id]
	if !live && alreadyTombstoned {
		// Removing a value that is already gone is not a change; two removals for one id would
		// make the client process the same deletion twice.
		return nil
	}
	if !live && !alreadyTombstoned {
		return nil
	}

	delete(c.values, id)
	seq := c.advanceLocked()
	c.tomb[id] = seq
	c.trimTombstonesLocked()
	return &Change[T]{Kind: "remove", Seq: seq, ID: id}
}

// ReplaceAll makes the collection match a set, removing anything absent.
//
// The bulk form exists so a poll over a directory does not have to diff by hand, and so the
// removals go through the same tombstone path as an explicit Remove.
func (c *Collection[T]) ReplaceAll(values []T) {
	retained := make(map[string]bool, len(values))
	for _, value := range values {
		retained[c.options.GetID(value)] = true
		c.Replace(value)
	}

	c.mu.Lock()
	stale := make([]string, 0)
	for id := range c.values {
		if !retained[id] {
			stale = append(stale, id)
		}
	}
	c.mu.Unlock()

	for _, id := range stale {
		c.Remove(id)
	}
}

// Snapshot returns the whole collection.
func (c *Collection[T]) Snapshot(reason string) Read[T] {
	c.mu.Lock()
	defer c.mu.Unlock()
	if reason == "" {
		reason = ReasonNoCursor
	}
	return Read[T]{
		Mode:    ModeSnapshot,
		Reason:  reason,
		HeadSeq: c.nextSeq - 1,
		Values:  c.sortedValuesLocked(),
	}
}

// ReadAfter returns everything that changed after a cursor.
//
// A cursor below the expired boundary or above the head cannot be answered from history: the first
// would produce a silently incomplete change set (the client keeps ghost rows), the second is a
// cursor from a different collection. Both get a snapshot with the reason.
func (c *Collection[T]) ReadAfter(afterSeq int64) Read[T] {
	c.mu.Lock()
	if afterSeq < c.expiredThrough || afterSeq > c.nextSeq-1 {
		c.mu.Unlock()
		return c.Snapshot(ReasonCursorExpired)
	}

	read := Read[T]{Mode: ModeChanges, HeadSeq: c.nextSeq - 1}
	for _, stored := range c.values {
		if stored.seq > afterSeq {
			read.Values = append(read.Values, Value[T]{Seq: stored.seq, Value: stored.value})
		}
	}
	for id, seq := range c.tomb {
		if seq > afterSeq {
			read.Removals = append(read.Removals, Removal{ID: id, Seq: seq})
		}
	}
	c.mu.Unlock()

	sort.Slice(read.Values, func(i, j int) bool { return read.Values[i].Seq < read.Values[j].Seq })
	sort.Slice(read.Removals, func(i, j int) bool { return read.Removals[i].Seq < read.Removals[j].Seq })
	return read
}

// advanceLocked bumps the sequence.
func (c *Collection[T]) advanceLocked() int64 {
	seq := c.nextSeq
	c.nextSeq++
	return seq
}

// trimTombstonesLocked bounds the removal history.
func (c *Collection[T]) trimTombstonesLocked() {
	for len(c.tomb) > c.maxTomb {
		oldestID := ""
		var oldestSeq int64
		for id, seq := range c.tomb {
			if oldestID == "" || seq < oldestSeq {
				oldestID = id
				oldestSeq = seq
			}
		}
		if oldestID == "" {
			return
		}
		delete(c.tomb, oldestID)
		// Everything up to the oldest dropped tombstone can no longer be answered from history.
		if oldestSeq > c.expiredThrough {
			c.expiredThrough = oldestSeq
		}
	}
}

// sortedValuesLocked returns the values ordered by id, so a snapshot is stable between reads.
//
// Ordering by id rather than by sequence: a client that diffs two snapshots should see the same
// order for the same content, and sequence numbers change for reasons unrelated to content.
func (c *Collection[T]) sortedValuesLocked() []Value[T] {
	ids := make([]string, 0, len(c.values))
	for id := range c.values {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	values := make([]Value[T], 0, len(ids))
	for _, id := range ids {
		stored := c.values[id]
		values = append(values, Value[T]{Seq: stored.seq, Value: stored.value})
	}
	return values
}
