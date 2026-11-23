package filewatch

import (
	"fmt"
	"path/filepath"
	"sync"
)

// Fake is an in-memory Observation for tests. Events are delivered synchronously, in the order the
// test emits them, so a test can assert exact ordering without waiting on a platform watcher.
type Fake struct {
	mu       sync.Mutex
	subs     []*fakeSubscription
	closed   bool
	refuse   bool
	failures int64
}

type fakeSubscription struct {
	fake    *Fake
	root    string
	handler func(Event)

	mu       sync.Mutex
	excluded []string
	released bool

	degradedOnce sync.Once
	degraded     chan struct{}
}

// NewFake returns an empty in-memory Observation.
func NewFake() *Fake {
	return &Fake{}
}

// Subscribe registers a handler for changes under root.
func (f *Fake) Subscribe(root string, opts Options, handler func(Event)) (Subscription, error) {
	root, err := cleanRoot(root)
	if err != nil {
		return nil, err
	}
	excluded, err := cleanExclusions(opts.Excluded)
	if err != nil {
		return nil, err
	}
	if handler == nil {
		return nil, fmt.Errorf("filewatch: nil handler")
	}
	sub := &fakeSubscription{fake: f, root: root, handler: handler, excluded: excluded, degraded: make(chan struct{})}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil, fmt.Errorf("filewatch: observation is closed")
	}
	if f.refuse {
		return nil, fmt.Errorf("filewatch: subscriptions refused")
	}
	f.subs = append(f.subs, sub)
	return sub, nil
}

// Diagnostics reports the fake's aggregate state.
func (f *Fake) Diagnostics() Diagnostics {
	f.mu.Lock()
	subs := append([]*fakeSubscription(nil), f.subs...)
	failures := f.failures
	f.mu.Unlock()
	degraded := 0
	for _, sub := range subs {
		select {
		case <-sub.degraded:
			degraded++
		default:
		}
	}
	return Diagnostics{Subscriptions: len(subs), Degraded: degraded, Failures: failures}
}

// Close releases every subscription.
func (f *Fake) Close() error {
	f.mu.Lock()
	subs := f.subs
	f.subs = nil
	f.closed = true
	f.mu.Unlock()
	for _, sub := range subs {
		sub.Release()
	}
	return nil
}

// Create emits a Created event for path.
func (f *Fake) Create(path string) {
	f.emit(Event{Path: filepath.Clean(path), Kind: Created})
}

// Write emits a Written event for path.
func (f *Fake) Write(path string) {
	f.emit(Event{Path: filepath.Clean(path), Kind: Written})
}

// Rename emits a Renamed event from one path to another.
func (f *Fake) Rename(from, to string) {
	f.emit(Event{Path: filepath.Clean(to), From: filepath.Clean(from), Kind: Renamed})
}

// Remove emits a Removed event for path.
func (f *Fake) Remove(path string) {
	f.emit(Event{Path: filepath.Clean(path), Kind: Removed})
}

// RefuseSubscribe makes later Subscribe calls fail, so a test can keep a consumer in degraded
// polling without a platform watcher that cannot be installed.
func (f *Fake) RefuseSubscribe(refuse bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refuse = refuse
}

// Fail marks every live subscription degraded and counts one watch failure. It exists so a test can
// exercise a consumer's degraded path without a platform watcher that actually fails.
func (f *Fake) Fail() {
	f.mu.Lock()
	f.failures++
	subs := f.subs
	f.mu.Unlock()
	for _, sub := range subs {
		sub.degradedOnce.Do(func() { close(sub.degraded) })
	}
}

func (f *Fake) emit(ev Event) {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return
	}
	subs := append([]*fakeSubscription(nil), f.subs...)
	f.mu.Unlock()
	for _, sub := range subs {
		sub.deliver(ev)
	}
}

func (f *Fake) remove(sub *fakeSubscription) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, candidate := range f.subs {
		if candidate == sub {
			f.subs = append(f.subs[:i], f.subs[i+1:]...)
			return
		}
	}
}

// Degraded is closed once Fail marked the subscription.
func (s *fakeSubscription) Degraded() <-chan struct{} { return s.degraded }

func (s *fakeSubscription) UpdateExclusions(roots []string) error {
	excluded, err := cleanExclusions(roots)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.released {
		return nil
	}
	s.excluded = excluded
	return nil
}

// Release is a barrier: it waits for an in-flight handler and prevents later delivery.
func (s *fakeSubscription) Release() {
	s.mu.Lock()
	s.released = true
	s.mu.Unlock()
	s.fake.remove(s)
}

func (s *fakeSubscription) deliver(ev Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.released || !under(s.root, ev.Path) || excluded(s.excluded, ev.Path) {
		return
	}
	s.handler(ev)
}
