// Package hostsync keeps the replica of the user's host list, daemon membership, and tunnel-rule
// view that every daemon in a sync chain holds.
//
// Every daemon is a full replica and any of them can serve a client, so there is no home daemon
// whose absence blocks sync. Replicas converge by merging record by record: a document-level
// last-writer-wins would drop one side's edits whenever two daemons were changed while apart.
//
// Design and the decisions behind it: byissue/epics/2026-11-12-o-host-sync-chain/spec.md.
package hostsync

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Record kinds. The set is closed: an unknown kind is rejected rather than stored, because a replica
// that silently carries kinds it does not understand would spread them to every daemon.
const (
	KindHost   = "host"
	KindMember = "member"
	KindRule   = "rule"
)

const (
	// MaxDocumentBytes bounds one replica. A dozen hosts plus rules is a few KB; the cap stops a
	// runaway client from filling every daemon's disk through sync.
	MaxDocumentBytes = 256 * 1024
	// TombstoneRetention is how long a deleted host or rule keeps its tombstone. A replica that
	// stays offline longer than this can bring the record back; members are exempt (see Purge).
	TombstoneRetention = 90 * 24 * time.Hour
)

var (
	ErrCredentialField = errors.New("hostsync: synced data must not contain credentials")
	ErrTooLarge        = errors.New("hostsync: document exceeds the size limit")
	ErrMemberRemoved   = errors.New("hostsync: this daemon was removed from the chain")
)

// Record is one replicated entry.
//
// Version is a logical clock, not wall time: daemons' clocks disagree, and a wall-clock winner
// would let a skewed machine overwrite newer edits.
type Record struct {
	Kind    string `json:"kind"`
	ID      string `json:"id"`
	Version uint64 `json:"version"`
	Author  string `json:"author"`
	Deleted bool   `json:"deleted,omitempty"`
	// DeletedAt is unix milliseconds of the deletion on the daemon that made it. It only drives
	// local tombstone purging; merge never reads it.
	DeletedAt int64           `json:"deletedAt,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
}

func (r Record) key() string { return r.Kind + "/" + r.ID }

// Change is an edit from a client. Clients never choose versions; the daemon that receives the
// change stamps it, so the logical clock only moves forward on replicas.
type Change struct {
	Kind   string          `json:"kind"`
	ID     string          `json:"id"`
	Delete bool            `json:"delete,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// Document is one replica.
type Document struct {
	records map[string]Record
}

func NewDocument() *Document { return &Document{records: map[string]Record{}} }

func (d *Document) Clone() *Document {
	c := NewDocument()
	for k, r := range d.records {
		c.records[k] = r
	}
	return c
}

// Get returns the record, including tombstones.
func (d *Document) Get(kind, id string) (Record, bool) {
	r, ok := d.records[kind+"/"+id]
	return r, ok
}

// Records returns every record, tombstones included, in a stable order.
func (d *Document) Records() []Record {
	out := make([]Record, 0, len(d.records))
	for _, r := range d.records {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].key() < out[j].key() })
	return out
}

func (d *Document) maxVersion() uint64 {
	var max uint64
	for _, r := range d.records {
		if r.Version > max {
			max = r.Version
		}
	}
	return max
}

// Apply stamps a client change with the next logical version and this daemon as author.
func (d *Document) Apply(c Change, author string, now time.Time) (Record, error) {
	r := Record{
		Kind:    c.Kind,
		ID:      strings.TrimSpace(c.ID),
		Version: d.maxVersion() + 1,
		Author:  author,
	}
	if c.Delete {
		r.Deleted = true
		r.DeletedAt = now.UnixMilli()
	} else {
		r.Data = c.Data
	}
	if err := validate(r); err != nil {
		return Record{}, err
	}
	if prev, ok := d.records[r.key()]; ok && prev.Kind == KindMember && prev.Deleted && !r.Deleted {
		return Record{}, ErrMemberRemoved
	}
	next := d.Clone()
	next.records[r.key()] = r
	if err := next.checkSize(); err != nil {
		return Record{}, err
	}
	d.records = next.records
	return r, nil
}

// Merge folds in records from another replica. All or nothing: a batch that would break a limit
// leaves the document untouched, so a failed sync never leaves a half-applied replica.
func (d *Document) Merge(incoming []Record) error {
	next := d.Clone()
	for _, r := range incoming {
		r.ID = strings.TrimSpace(r.ID)
		if err := validate(r); err != nil {
			return err
		}
		if cur, ok := next.records[r.key()]; !ok || wins(r, cur) {
			next.records[r.key()] = r
		}
	}
	if err := next.checkSize(); err != nil {
		return err
	}
	d.records = next.records
	return nil
}

// Purge drops host and rule tombstones older than TombstoneRetention.
//
// Member tombstones are never purged. Removing a daemon is how a user cuts off a lost or
// compromised machine; if its tombstone expired, any replica that missed the removal would sync
// it straight back in.
func (d *Document) Purge(now time.Time) {
	cutoff := now.Add(-TombstoneRetention).UnixMilli()
	for k, r := range d.records {
		if r.Deleted && r.Kind != KindMember && r.DeletedAt < cutoff {
			delete(d.records, k)
		}
	}
}

// wins reports whether a replaces b. It is a strict total order over records with the same key,
// so every replica picks the same winner regardless of the order exchanges happen in.
func wins(a, b Record) bool {
	// Removal wins for members: see Purge.
	if a.Kind == KindMember && a.Deleted != b.Deleted {
		return a.Deleted
	}
	if a.Version != b.Version {
		return a.Version > b.Version
	}
	if a.Author != b.Author {
		return a.Author > b.Author
	}
	if a.Deleted != b.Deleted {
		return a.Deleted
	}
	return bytes.Compare(a.Data, b.Data) > 0
}

func validate(r Record) error {
	switch r.Kind {
	case KindHost, KindMember, KindRule:
	default:
		return fmt.Errorf("hostsync: unknown record kind %q", r.Kind)
	}
	if r.ID == "" {
		return errors.New("hostsync: record id is empty")
	}
	if r.Deleted {
		return nil
	}
	var obj map[string]any
	if err := json.Unmarshal(r.Data, &obj); err != nil || obj == nil {
		return errors.New("hostsync: record data must be a JSON object")
	}
	if field, ok := findCredentialField(obj); ok {
		return fmt.Errorf("%w: field %q", ErrCredentialField, field)
	}
	return nil
}

// credentialFields are key names that mean "a secret". Matching is on the normalized key name, so
// `apiKey`, `api_key`, and `API-KEY` all match; public keys (`daemonPublicKeyB64`) do not.
var credentialFields = map[string]bool{
	"password":    true,
	"passwd":      true,
	"token":       true,
	"accesstoken": true,
	"secret":      true,
	"secretkey":   true,
	"privatekey":  true,
	"bearer":      true,
	"apikey":      true,
	"credential":  true,
	"credentials": true,
}

func normalizeKey(k string) string {
	k = strings.ToLower(k)
	return strings.NewReplacer("_", "", "-", "").Replace(k)
}

func findCredentialField(v any) (string, bool) {
	switch t := v.(type) {
	case map[string]any:
		for k, child := range t {
			if credentialFields[normalizeKey(k)] {
				return k, true
			}
			if f, ok := findCredentialField(child); ok {
				return f, true
			}
		}
	case []any:
		for _, child := range t {
			if f, ok := findCredentialField(child); ok {
				return f, true
			}
		}
	}
	return "", false
}

func (d *Document) checkSize() error {
	encoded, err := d.MarshalJSON()
	if err != nil {
		return err
	}
	if len(encoded) > MaxDocumentBytes {
		return ErrTooLarge
	}
	return nil
}

type fileShape struct {
	Version int      `json:"version"`
	Records []Record `json:"records"`
}

func (d *Document) MarshalJSON() ([]byte, error) {
	return json.Marshal(fileShape{Version: 1, Records: d.Records()})
}

func (d *Document) UnmarshalJSON(b []byte) error {
	var f fileShape
	if err := json.Unmarshal(b, &f); err != nil {
		return err
	}
	d.records = map[string]Record{}
	for _, r := range f.Records {
		d.records[r.key()] = r
	}
	return nil
}
