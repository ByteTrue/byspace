package hostsync

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
)

// Filename is the replica's file in the daemon home, next to tunnels.json.
const Filename = "host-sync.json"

// Store is this daemon's replica on disk.
type Store struct {
	path   string
	author string
	now    func() time.Time

	mu  sync.Mutex
	doc *Document
}

// Open loads the replica, or starts an empty one when the file does not exist yet.
//
// A file that exists but does not parse is an error, not an empty replica: answering with an empty
// document would make every client that syncs next treat all hosts as unknown, and the first
// write would overwrite the damaged file that still holds them.
func Open(homeDir, author string) (*Store, error) {
	s := &Store{path: filepath.Join(homeDir, Filename), author: author, now: time.Now, doc: NewDocument()}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, s.doc); err != nil {
		return nil, fmt.Errorf("hostsync: %s is not readable: %w", s.path, err)
	}
	return s, nil
}

// Exchange merges records carried over from other replicas, applies the client's own changes,
// and returns the whole replica.
//
// Records go first so a client's change is stamped above everything it brought with it: a change
// made on a stale view must still beat the stale view itself.
func (s *Store) Exchange(records []Record, changes []Change) ([]Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := s.doc.Clone()
	if err := next.Merge(records); err != nil {
		return nil, err
	}
	now := s.now()
	for _, c := range changes {
		if _, err := next.Apply(c, s.author, now); err != nil {
			return nil, err
		}
	}
	next.Purge(now)

	before, err := s.doc.MarshalJSON()
	if err != nil {
		return nil, err
	}
	after, err := next.MarshalJSON()
	if err != nil {
		return nil, err
	}
	if string(before) != string(after) {
		if err := home.WriteAtomic(s.path, after, 0o600); err != nil {
			return nil, err
		}
	}
	s.doc = next
	return s.doc.Records(), nil
}
