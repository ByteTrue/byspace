package terminal

import (
	"strings"
	"sync"
)

const MaxBacklogChars = 1_000_000

type backlogEntry struct {
	revision int64
	data     string
}

type Resumption struct {
	Data     string
	Revision int64
}

// Backlog retains bounded recent terminal output indexed by revision so a reconnecting
// client can resume without resetting the screen.
type Backlog struct {
	mu                     sync.Mutex
	entries                []backlogEntry
	maxChars               int
	chars                  int
	droppedThroughRevision int64
	lastRevision           int64
	hasReset               bool
}

func NewBacklog(maxChars int) *Backlog {
	if maxChars <= 0 {
		maxChars = MaxBacklogChars
	}
	return &Backlog{maxChars: maxChars}
}

func (b *Backlog) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.entries = nil
	b.chars = 0
	b.hasReset = true
}

func (b *Backlog) Append(revision int64, data string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.hasReset {
		b.droppedThroughRevision = revision - 1
		b.hasReset = false
	}
	b.entries = append(b.entries, backlogEntry{revision: revision, data: data})
	b.chars += len(data)
	b.lastRevision = revision
	for b.chars > b.maxChars && len(b.entries) > 0 {
		evicted := b.entries[0]
		b.entries = b.entries[1:]
		b.chars -= len(evicted.data)
		b.droppedThroughRevision = evicted.revision
	}
}

func (b *Backlog) Since(revision int64) *Resumption {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.hasReset || revision > b.lastRevision || revision < b.droppedThroughRevision {
		return nil
	}
	var sb strings.Builder
	for _, e := range b.entries {
		if e.revision > revision {
			sb.WriteString(e.data)
		}
	}
	return &Resumption{
		Data:     sb.String(),
		Revision: b.lastRevision,
	}
}
