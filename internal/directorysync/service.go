package directorysync

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
)

// Entry is one row of the app's directory: a project, a workspace, or an agent plus its placement.
//
// All three are JSON objects on the wire, so they share one type and the collections differ only in
// the field that identifies a row.
type Entry = map[string]any

// Cursor is what a client sends back to ask for changes only.
type Cursor struct {
	// Generation is the daemon's sequencing generation. A mismatch means the client's replica
	// predates this daemon instance and cannot be advanced.
	Generation string
	// AfterSeq is the last sequence the client applied. Nil means "no cursor".
	AfterSeq *int64
}

// Metadata is the `sync` block of a directory response.
type Metadata struct {
	Generation string
	HeadSeq    int64
	Mode       string
	Reason     string
	Removals   []Removal
}

// Service owns daemon-wide latest-state sequencing for the three directory entity types.
//
// Safe for concurrent use: every read and mutation holds the same lock, so a mutation published by
// a live broadcast and a snapshot read by a polling client never interleave.
type Service struct {
	mu         sync.Mutex
	generation string
	projects   *Collection[Entry]
	workspaces *Collection[Entry]
	agents     *Collection[Entry]
}

// NewService builds a service with a fresh generation.
//
// The generation changes on every daemon start. A client whose stored cursor carries an older
// generation gets a snapshot: its replica may describe rows this process never saw, so a delta
// could not correct it.
func NewService() *Service {
	return NewServiceWithGeneration(newGeneration())
}

// NewServiceWithGeneration builds a service with an explicit generation, for tests.
func NewServiceWithGeneration(generation string) *Service {
	return &Service{
		generation: generation,
		projects:   NewCollection(CollectionOptions[Entry]{GetID: func(v Entry) string { return stringField(v, "projectId") }}),
		workspaces: NewCollection(CollectionOptions[Entry]{GetID: func(v Entry) string { return stringField(v, "id") }}),
		agents:     NewCollection(CollectionOptions[Entry]{GetID: agentID}),
	}
}

func newGeneration() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "gen_fallback"
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// Generation is this service's sequencing generation.
func (s *Service) Generation() string {
	return s.generation
}

// SynchronizeProjects reconciles the project table with a full projection and answers a read.
//
// Rows carry their sequence only when the request came with a cursor. A client that never sent one
// does not read `syncSeq`, and a row claiming a cursor position the client will not store is a
// disagreement waiting to happen.
func (s *Service) SynchronizeProjects(snapshot []Entry, cursor Cursor, sequenced bool) ([]Entry, Metadata) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.projects.ReplaceAll(snapshot)
	read := s.read(s.projects, cursor)
	return entriesOf(read, sequenced), read.Metadata(s.generation)
}

// SynchronizeWorkspaces reconciles the workspace table with a full projection and answers a read.
func (s *Service) SynchronizeWorkspaces(snapshot []Entry, cursor Cursor, sequenced bool) ([]Entry, Metadata) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workspaces.ReplaceAll(snapshot)
	read := s.read(s.workspaces, cursor)
	return entriesOf(read, sequenced), read.Metadata(s.generation)
}

// SynchronizeAgents reconciles the agent table with a full projection and answers a read.
func (s *Service) SynchronizeAgents(snapshot []Entry, cursor Cursor, sequenced bool) ([]Entry, Metadata) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents.ReplaceAll(snapshot)
	read := s.read(s.agents, cursor)
	return entriesOf(read, sequenced), read.Metadata(s.generation)
}

// SequenceProjectUpdate publishes a project upsert or removal and stamps its sequence.
func (s *Service) SequenceProjectUpdate(payload map[string]any, project Entry, projectID string, includeSequence bool) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return stamp(payload, includeSequence, s.generation, seqOf(s.projects.Change(payload["kind"] == "remove", project, projectID)))
}

// SequenceWorkspaceUpdate publishes a workspace upsert or removal and stamps its sequence.
func (s *Service) SequenceWorkspaceUpdate(payload map[string]any, workspace Entry, workspaceID string, includeSequence bool) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return stamp(payload, includeSequence, s.generation, seqOf(s.workspaces.Change(workspace == nil, workspace, workspaceID)))
}

// SequenceAgentUpdate publishes an agent upsert or removal and stamps its sequence.
func (s *Service) SequenceAgentUpdate(payload map[string]any, entry Entry, agentID string, includeSequence bool) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return stamp(payload, includeSequence, s.generation, seqOf(s.agents.Change(entry == nil, entry, agentID)))
}

// read answers a cursor against one collection. The caller holds the lock.
func (s *Service) read[T any](collection *Collection[T], cursor Cursor) Read[T] {
	switch {
	case cursor.Generation == "":
		return collection.ReadSnapshot("no_cursor")
	case cursor.Generation != s.generation:
		return collection.ReadSnapshot("generation_changed")
	case cursor.AfterSeq == nil:
		return collection.ReadSnapshot("no_cursor")
	}
	return collection.ReadAfter(*cursor.AfterSeq)
}

// entriesOf returns the read's rows, tagged with their sequence only when the client sequences.
func entriesOf(read Read[Entry], sequenced bool) []Entry {
	if !sequenced {
		out := make([]Entry, 0, len(read.Values))
		for _, versioned := range read.Values {
			out = append(out, copyEntry(versioned.Value))
		}
		return out
	}
	return tagged(read.Values)
}

// copyEntry copies a row so attaching a sequence never mutates the projection the caller built.
func copyEntry(entry Entry) Entry {
	out := make(Entry, len(entry)+1)
	for key, value := range entry {
		out[key] = value
	}
	return out
}

// tagged attaches each row's sequence to the object the client receives.
func tagged(values []Versioned[Entry]) []Entry {
	out := make([]Entry, 0, len(values))
	for _, versioned := range values {
		entry := copyEntry(versioned.Value)
		entry["syncSeq"] = versioned.Seq
		out = append(out, entry)
	}
	return out
}

// stamp adds the sequencing fields a client needs to advance its cursor.
//
// Omitted when the client never sent a cursor: it does not read `seq`, and a stale sequence it did
// not ask for is worse than none.
func stamp(payload map[string]any, includeSequence bool, generation string, seq int64) map[string]any {
	if !includeSequence || seq == 0 {
		return payload
	}
	payload["generation"] = generation
	payload["seq"] = seq
	return payload
}

func seqOf[T any](change *Change[T]) int64 {
	if change == nil {
		return 0
	}
	return change.Seq
}

func stringField(value map[string]any, key string) string {
	text, _ := value[key].(string)
	return text
}

func agentID(value Entry) string {
	agent, ok := value["agent"].(map[string]any)
	if !ok {
		return ""
	}
	return stringField(agent, "id")
}
