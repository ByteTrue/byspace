// Package directorysync owns latest-state sequencing for the app's directory replica.
//
// The app keeps a copy of projects, workspaces and agents. Every read returns the complete
// latest-state projection of an entity type, and every live update is a delta on top of it. Without
// a sequence the client cannot tell which rows in a response are new, so it replaces its whole
// table on every poll — which is what the daemon did before this package existed, with
// `removals: []` hardcoded, meaning a deleted row could never be announced at all.
//
// Ported from archive/packages/server/src/server/directory-sync/internal/versioned-collection.ts.
package directorysync

import (
	"encoding/json"
	"sort"
)

// DefaultMaxTombstones caps how many removals a collection remembers.
//
// A client that has been away longer than the tombstones reach cannot be told what disappeared
// incrementally, so it is handed a fresh snapshot instead (see ReadAfter). Node uses the same
// number.
const DefaultMaxTombstones = 5000

// Versioned is one entry of a collection: its value plus the sequence it was published at.
type Versioned[T any] struct {
	Seq   int64
	Value T
}

// Removal is a published deletion. A deletion cannot be expressed as an upsert, so it travels as
// its own list — which is exactly what the client needs to drop the row.
type Removal struct {
	ID  string
	Seq int64
}

// Read is what a client receives: either a full snapshot or the changes after its cursor.
type Read[T any] struct {
	// Mode is "snapshot" or "changes".
	Mode string
	// Reason explains a snapshot: "no_cursor", "generation_changed" or "cursor_expired".
	Reason string
	// HeadSeq is the collection's current sequence; the client stores it as its next cursor.
	HeadSeq  int64
	Values   []Versioned[T]
	Removals []Removal
}

// Change is the outcome of a mutation: what the client should be told, if anything.
type Change[T any] struct {
	// Kind is "upsert" or "remove". Empty means nothing changed.
	Kind string
	Seq  int64
	// Value is set for an upsert.
	Value T
	// ID is set for a removal.
	ID string
}

type storedValue[T any] struct {
	seq         int64
	fingerprint string
	value       T
}

// Collection is latest-state sequencing for one entity type.
//
// Not safe for concurrent use; Service serializes access.
type Collection[T any] struct {
	valuesByID     map[string]*storedValue[T]
	tombstonesByID map[string]int64
	// tombstoneOrder tracks insertion order so trimming drops the oldest removal, which is what
	// bounds how far back a client's cursor can reach.
	tombstoneOrder []string

	getID         func(T) string
	fingerprint   func(T) string
	maxTombstones int

	expiredThroughSeq int64
	nextSeq           int64
}

// CollectionOptions configures a Collection.
type CollectionOptions[T any] struct {
	GetID func(T) string
	// Fingerprint decides whether a projection actually changed. Two projections with the same
	// fingerprint and no intervening removal are treated as unchanged and keep their sequence.
	//
	// Without this, every read would assign new sequences to every row, and since a client's
	// cursor is the head sequence, every read would return the whole table — the incrementality
	// would be gone.
	Fingerprint func(T) string
	// MaxTombstones defaults to DefaultMaxTombstones.
	MaxTombstones int
}

// NewCollection builds a collection.
func NewCollection[T any](opts CollectionOptions[T]) *Collection[T] {
	fingerprint := opts.Fingerprint
	if fingerprint == nil {
		fingerprint = func(value T) string {
			encoded, err := json.Marshal(value)
			if err != nil {
				// A value that cannot be encoded cannot be fingerprinted; treating it as always
				// changed costs an extra sequence, never a missed update.
				return ""
			}
			return string(encoded)
		}
	}
	maxTombstones := opts.MaxTombstones
	if maxTombstones <= 0 {
		maxTombstones = DefaultMaxTombstones
	}
	return &Collection[T]{
		valuesByID:     make(map[string]*storedValue[T]),
		tombstonesByID: make(map[string]int64),
		getID:          opts.GetID,
		fingerprint:    fingerprint,
		maxTombstones:  maxTombstones,
	}
}

// HeadSeq is the current sequence.
func (c *Collection[T]) HeadSeq() int64 {
	return c.nextSeq
}

// SeqFor returns the sequence an id was last published at, or 0 when it is unknown.
func (c *Collection[T]) SeqFor(id string) int64 {
	if stored, ok := c.valuesByID[id]; ok {
		return stored.seq
	}
	return c.tombstonesByID[id]
}

// Replace publishes a value, returning a change only when the projection actually differs.
func (c *Collection[T]) Replace(value T) *Change[T] {
	id := c.getID(value)
	fingerprint := c.fingerprint(value)
	previous := c.valuesByID[id]
	if previous != nil && previous.fingerprint == fingerprint {
		return nil
	}
	seq := c.advance()
	c.valuesByID[id] = &storedValue[T]{seq: seq, fingerprint: fingerprint, value: value}
	c.dropTombstone(id)
	return &Change[T]{Kind: "upsert", Seq: seq, Value: value}
}

// Remove publishes a deletion, returning a change only when something was there to delete.
func (c *Collection[T]) Remove(id string) *Change[T] {
	_, hadValue := c.valuesByID[id]
	_, hadTombstone := c.tombstonesByID[id]
	if !hadValue && hadTombstone {
		return nil
	}
	if !hadValue && !hadTombstone {
		return nil
	}
	delete(c.valuesByID, id)
	seq := c.advance()
	c.dropTombstone(id)
	c.tombstonesByID[id] = seq
	c.tombstoneOrder = append(c.tombstoneOrder, id)
	c.trimTombstones()
	return &Change[T]{Kind: "remove", Seq: seq, ID: id}
}

// ReplaceAll reconciles the collection with a complete projection: values that differ are
// republished, values that are absent are published as removals.
func (c *Collection[T]) ReplaceAll(values []T) {
	retained := make(map[string]bool, len(values))
	for _, value := range values {
		retained[c.getID(value)] = true
		c.Replace(value)
	}
	// Copy the ids first: Remove mutates valuesByID.
	stale := make([]string, 0, len(c.valuesByID))
	for id := range c.valuesByID {
		if !retained[id] {
			stale = append(stale, id)
		}
	}
	for _, id := range stale {
		c.Remove(id)
	}
}

// Change publishes either an upsert or a removal, which is what a live broadcast needs: the caller
// knows the payload kind and does not want two entry points.
//
// value is ignored for a removal.
func (c *Collection[T]) Change(remove bool, value T, id string) *Change[T] {
	if remove {
		return c.Remove(id)
	}
	return c.Replace(value)
}

// Metadata converts this read into a response's `sync` block.
func (r Read[T]) Metadata(generation string) Metadata {
	return Metadata{
		Generation: generation,
		HeadSeq:    r.HeadSeq,
		Mode:       r.Mode,
		Reason:     r.Reason,
		Removals:   r.Removals,
	}
}

// ReadSnapshot returns the whole latest-state projection.
func (c *Collection[T]) ReadSnapshot(reason string) Read[T] {
	return Read[T]{
		Mode:     "snapshot",
		Reason:   reason,
		HeadSeq:  c.nextSeq,
		Values:   c.sortedValues(),
		Removals: []Removal{},
	}
}

// ReadAfter returns the changes after a cursor.
//
// A cursor older than the oldest retained tombstone, or newer than the head, cannot be answered
// incrementally — the removals it needs are gone — so the caller gets a snapshot with a reason
// instead of a delta that silently leaves deleted rows on the client.
func (c *Collection[T]) ReadAfter(afterSeq int64) Read[T] {
	if afterSeq < c.expiredThroughSeq || afterSeq > c.nextSeq {
		return c.ReadSnapshot("cursor_expired")
	}
	values := make([]Versioned[T], 0, len(c.valuesByID))
	for _, v := range c.sortedValues() {
		if v.Seq > afterSeq {
			values = append(values, v)
		}
	}
	removals := make([]Removal, 0, len(c.tombstonesByID))
	for id, seq := range c.tombstonesByID {
		if seq > afterSeq {
			removals = append(removals, Removal{ID: id, Seq: seq})
		}
	}
	sort.Slice(removals, func(i, j int) bool {
		if removals[i].Seq != removals[j].Seq {
			return removals[i].Seq < removals[j].Seq
		}
		return removals[i].ID < removals[j].ID
	})
	return Read[T]{
		Mode:     "changes",
		HeadSeq:  c.nextSeq,
		Values:   values,
		Removals: removals,
	}
}

func (c *Collection[T]) advance() int64 {
	c.nextSeq++
	return c.nextSeq
}

// sortedValues orders by sequence, then by id so two reads of the same state are byte-identical.
func (c *Collection[T]) sortedValues() []Versioned[T] {
	values := make([]Versioned[T], 0, len(c.valuesByID))
	for _, stored := range c.valuesByID {
		values = append(values, Versioned[T]{Seq: stored.seq, Value: stored.value})
	}
	sort.Slice(values, func(i, j int) bool {
		if values[i].Seq != values[j].Seq {
			return values[i].Seq < values[j].Seq
		}
		return c.getID(values[i].Value) < c.getID(values[j].Value)
	})
	return values
}

func (c *Collection[T]) dropTombstone(id string) {
	if _, ok := c.tombstonesByID[id]; !ok {
		return
	}
	delete(c.tombstonesByID, id)
	for i, existing := range c.tombstoneOrder {
		if existing == id {
			c.tombstoneOrder = append(c.tombstoneOrder[:i], c.tombstoneOrder[i+1:]...)
			break
		}
	}
}

// trimTombstones bounds the removal history, raising the floor a cursor has to clear.
func (c *Collection[T]) trimTombstones() {
	for len(c.tombstonesByID) > c.maxTombstones {
		oldestID := c.tombstoneOrder[0]
		c.tombstoneOrder = c.tombstoneOrder[1:]
		seq, ok := c.tombstonesByID[oldestID]
		if !ok {
			continue
		}
		delete(c.tombstonesByID, oldestID)
		if seq > c.expiredThroughSeq {
			c.expiredThroughSeq = seq
		}
	}
}
