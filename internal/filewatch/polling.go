package filewatch

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// This file adds the degraded mode every backend needs: when a native watch cannot be installed or
// reports that it lost events, the root is polled by file identity instead, and the native watch is
// retried until it can be re-established. Polling restores correctness at a latency cost; it never
// replaces the native path while that path works.

const (
	// pollMinInterval is the first polling period after degradation. It doubles up to
	// pollMaxInterval so a root that cannot be watched stays cheap.
	pollMinInterval = 5 * time.Second
	pollMaxInterval = 60 * time.Second
	// maxPolledPaths bounds one identity snapshot. Beyond it the oldest comparison is abandoned
	// rather than spending unbounded memory on a tree that is already unwatchable.
	maxPolledPaths = 250_000
)

// clock schedules polling. Tests substitute a manual clock.
type clock interface {
	After(time.Duration) <-chan time.Time
}

type realClock struct{}

func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

// polledObservation wraps a backend with degraded polling.
type polledObservation struct {
	backend Observation
	clock   clock

	mu     sync.Mutex
	subs   []*polledSubscription
	closed bool
}

func newPolledObservation(backend Observation, c clock) *polledObservation {
	return &polledObservation{backend: backend, clock: c}
}

func (o *polledObservation) Subscribe(root string, opts Options, handler func(Event)) (Subscription, error) {
	clean, err := cleanRoot(root)
	if err != nil {
		return nil, err
	}
	excluded, err := cleanExclusions(opts.Excluded)
	if err != nil {
		return nil, err
	}
	if handler == nil {
		return nil, errors.New("filewatch: nil handler")
	}
	// A missing root is a caller error, not a watch failure: it must not turn into silent polling.
	if _, err := os.Stat(clean); err != nil {
		return nil, err
	}

	sub := &polledSubscription{
		obs:      o,
		root:     clean,
		handler:  handler,
		excluded: excluded,
		done:     make(chan struct{}),
		runDone:  make(chan struct{}),
		degraded: make(chan struct{}),
	}
	// A native failure here is exactly what degraded polling is for; Subscribe still succeeds.
	if inner, err := o.backend.Subscribe(clean, opts, handler); err == nil {
		sub.inner = inner
	} else {
		// The baseline exists before Degraded is closed: a consumer that reacts to degradation
		// with a write must be seen by the first poll.
		sub.snapshot = sub.readIdentities()
		sub.markDegraded()
	}

	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		if sub.inner != nil {
			sub.inner.Release()
		}
		return nil, errors.New("filewatch: observation is closed")
	}
	o.subs = append(o.subs, sub)
	o.mu.Unlock()
	go sub.run()
	return sub, nil
}

func (o *polledObservation) Diagnostics() Diagnostics {
	o.mu.Lock()
	subs := append([]*polledSubscription(nil), o.subs...)
	o.mu.Unlock()
	out := o.backend.Diagnostics()
	out.Subscriptions = len(subs)
	for _, sub := range subs {
		sub.mu.Lock()
		if sub.inner == nil {
			out.Degraded++
			out.Tracked += len(sub.snapshot)
		}
		sub.mu.Unlock()
	}
	return out
}

func (o *polledObservation) Close() error {
	o.mu.Lock()
	subs := o.subs
	o.subs = nil
	o.closed = true
	o.mu.Unlock()
	for _, sub := range subs {
		sub.Release()
	}
	return o.backend.Close()
}

func (o *polledObservation) remove(sub *polledSubscription) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i, candidate := range o.subs {
		if candidate == sub {
			o.subs = append(o.subs[:i], o.subs[i+1:]...)
			return
		}
	}
}

type polledSubscription struct {
	obs     *polledObservation
	root    string
	handler func(Event)

	mu       sync.Mutex
	excluded []string
	inner    Subscription
	snapshot map[string]string
	released bool

	wake        chan struct{}
	release     sync.Once
	done        chan struct{}
	runDone     chan struct{}
	degradeOnce sync.Once
	degraded    chan struct{}
	interval    time.Duration
}

// Degraded is closed once the subscription is polling. It stays closed after recovery.
func (s *polledSubscription) Degraded() <-chan struct{} { return s.degraded }

func (s *polledSubscription) markDegraded() { s.degradeOnce.Do(func() { close(s.degraded) }) }

func (s *polledSubscription) UpdateExclusions(roots []string) error {
	cleaned, err := cleanExclusions(roots)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.excluded = cleaned
	inner := s.inner
	s.mu.Unlock()
	if inner != nil {
		return inner.UpdateExclusions(cleaned)
	}
	return nil
}

// Release is a barrier: it stops the polling loop before returning.
func (s *polledSubscription) Release() {
	s.release.Do(func() {
		s.mu.Lock()
		s.released = true
		inner := s.inner
		s.inner = nil
		s.mu.Unlock()
		if inner != nil {
			inner.Release()
		}
		close(s.done)
		<-s.runDone
		s.obs.remove(s)
	})
}

func (s *polledSubscription) run() {
	defer close(s.runDone)
	for {
		s.mu.Lock()
		inner := s.inner
		interval := s.interval
		s.mu.Unlock()

		if inner == nil {
			if interval == 0 {
				interval = pollMinInterval
			}
			select {
			case <-s.done:
				return
			case <-s.wake:
				continue
			case <-s.obs.clock.After(interval):
			}
			next := interval * 2
			if next > pollMaxInterval {
				next = pollMaxInterval
			}
			s.mu.Lock()
			s.interval = next
			s.mu.Unlock()
			if s.reattach() {
				continue
			}
			s.poll()
			continue
		}

		select {
		case <-s.done:
			return
		case <-s.wake:
		case <-inner.Degraded():
			// The native watch no longer reports; take a baseline where it stopped so polling
			// reports only changes from here on.
			s.mu.Lock()
			s.inner = nil
			s.interval = 0
			s.mu.Unlock()
			inner.Release()
			s.mu.Lock()
			s.snapshot = s.readIdentitiesLocked()
			s.mu.Unlock()
			s.markDegraded()
		}
	}
}

// reattach retries the native watch. On success it polls once more, because the interval between the
// last poll and the attach is covered by no one else; a change in that window may be reported twice.
func (s *polledSubscription) reattach() bool {
	s.mu.Lock()
	root, excluded := s.root, s.excluded
	s.mu.Unlock()
	inner, err := s.obs.backend.Subscribe(root, Options{Excluded: excluded}, s.handler)
	if err != nil {
		return false
	}
	s.mu.Lock()
	if s.released {
		s.mu.Unlock()
		inner.Release()
		return false
	}
	s.mu.Unlock()
	s.poll()
	s.mu.Lock()
	s.inner = inner
	s.mu.Unlock()
	return true
}

func (s *polledSubscription) poll() {
	current := s.readIdentities()
	s.mu.Lock()
	snapshot := s.snapshot
	s.snapshot = current
	s.mu.Unlock()
	for path, identity := range current {
		if previous, ok := snapshot[path]; !ok {
			s.emit(Event{Path: path, Kind: Created})
		} else if previous != identity {
			s.emit(Event{Path: path, Kind: Written})
		}
	}
	for path := range snapshot {
		if _, ok := current[path]; !ok {
			s.emit(Event{Path: path, Kind: Removed})
		}
	}
}

func (s *polledSubscription) readIdentities() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readIdentitiesLocked()
}

// readIdentitiesLocked reports one identity per file. Renames are reported as a removal and a
// creation, since an identity snapshot cannot pair the two.
func (s *polledSubscription) readIdentitiesLocked() map[string]string {
	return snapshotIdentities(s.root, s.excluded)
}

// snapshotIdentities reports one identity per file under root, skipping excluded roots.
func snapshotIdentities(root string, excludedRoots []string) map[string]string {
	out := make(map[string]string)
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if path == root {
				return err
			}
			return nil
		}
		if entry.IsDir() {
			if excluded(excludedRoots, path) {
				return filepath.SkipDir
			}
			return nil
		}
		if excluded(excludedRoots, path) {
			return nil
		}
		if len(out) >= maxPolledPaths {
			return filepath.SkipAll
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		out[path] = identity(info)
		return nil
	})
	return out
}

// identity is deliberately cheap: polling a root runs every interval and cannot hash content.
// shortcut: a same-size rewrite inside one filesystem timestamp tick is invisible to polling,
// hash content here if degraded roots start missing edits.
func identity(info fs.FileInfo) string {
	return info.ModTime().Format(time.RFC3339Nano) +
		":" + strconv.FormatInt(info.Size(), 10) + ":" + info.Mode().String()
}

func (s *polledSubscription) emit(ev Event) {
	s.mu.Lock()
	released, excludedPaths := s.released, s.excluded
	s.mu.Unlock()
	if released || excluded(excludedPaths, ev.Path) {
		return
	}
	s.handler(ev)
}
