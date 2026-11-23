//go:build darwin

package filewatch

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// kqueue reports that a watched directory's entries changed (an entry was created, removed or
// renamed) and, with NOTE_DELETE/NOTE_RENAME, that the directory itself went away. Writing to an
// existing file changes that file's vnode, not its directory, so a directory watch never reports
// content edits. FSEvents would, but needs cgo and release builds are CGO_ENABLED=0; one descriptor
// per file would, but a repository has more files than a process has descriptors. So the structure
// stays event-driven and content is found by an identity snapshot on a timer inside this backend.
// That snapshot costs a tree walk every darwinPollIdentities: macOS pays a latency and a walk the
// other platforms do not, which is the price of no usable native content event.
const (
	darwinTimerIdent = 1
	darwinWakeIdent  = 2

	darwinPollIdentities   = 2 * time.Second
	darwinCreatedDedupeTTL = 2 * time.Second
	darwinMaxRecentCreates = 4096

	darwinVnodeMask = unix.NOTE_WRITE | unix.NOTE_DELETE | unix.NOTE_RENAME | unix.NOTE_EXTEND | unix.NOTE_ATTRIB
)

// Open returns the platform observation service.
func Open() (Observation, error) {
	return newPolledObservation(newDarwinObservation(), realClock{}), nil
}

type darwinObservation struct {
	mu       sync.Mutex
	subs     []*darwinSubscription
	closed   bool
	degraded atomic.Int64
	failures atomic.Int64
}

func newDarwinObservation() *darwinObservation { return &darwinObservation{} }

type darwinEntry struct {
	ino   uint64
	isDir bool
}

type darwinSubscription struct {
	obs     *darwinObservation
	root    string
	handler func(Event)
	kq      int
	done    chan struct{}

	stopping atomic.Bool
	tracked  atomic.Int64
	degraded atomic.Bool
	release  sync.Once

	degradedOnce sync.Once
	degradedCh   chan struct{}

	exclusions chan exclusionUpdate

	mu       sync.Mutex
	dirs     map[int]string
	paths    map[string]int
	excluded []string

	// Reader-owned once run starts.
	entries  map[string]map[string]darwinEntry
	snapshot map[string]string
	recent   map[string]time.Time
}

func (o *darwinObservation) Subscribe(root string, opts Options, handler func(Event)) (Subscription, error) {
	clean, err := cleanRoot(root)
	if err != nil {
		return nil, err
	}
	excludedRoots, err := cleanExclusions(opts.Excluded)
	if err != nil {
		return nil, err
	}
	if handler == nil {
		return nil, errors.New("filewatch: nil handler")
	}
	info, err := os.Stat(clean)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, &os.PathError{Op: "subscribe", Path: clean, Err: unix.ENOTDIR}
	}
	kq, err := unix.Kqueue()
	if err != nil {
		return nil, err
	}
	sub := &darwinSubscription{
		obs:        o,
		root:       clean,
		handler:    handler,
		kq:         kq,
		done:       make(chan struct{}),
		degradedCh: make(chan struct{}),
		exclusions: make(chan exclusionUpdate, 8),
		dirs:       make(map[int]string),
		paths:      make(map[string]int),
		excluded:   excludedRoots,
		entries:    make(map[string]map[string]darwinEntry),
		recent:     make(map[string]time.Time),
	}

	// One timer drives the content snapshot; one user event is the wake channel Release and
	// UpdateExclusions use to reach a goroutine blocked in Kevent.
	var changes [2]unix.Kevent_t
	unix.SetKevent(&changes[0], darwinTimerIdent, unix.EVFILT_TIMER, unix.EV_ADD)
	changes[0].Data = int64(darwinPollIdentities / time.Millisecond)
	unix.SetKevent(&changes[1], darwinWakeIdent, unix.EVFILT_USER, unix.EV_ADD)
	if _, err := unix.Kevent(kq, changes[:], nil, nil); err != nil {
		unix.Close(kq)
		return nil, err
	}

	// The first snapshot is the baseline: content that changes after this point is reported.
	sub.snapshot = snapshotIdentities(clean, excludedRoots)
	if err := sub.scanTree(clean); err != nil {
		sub.closeHandles()
		return nil, err
	}

	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		sub.closeHandles()
		return nil, errors.New("filewatch: observation is closed")
	}
	o.subs = append(o.subs, sub)
	o.mu.Unlock()
	go sub.run()
	return sub, nil
}

func (o *darwinObservation) Diagnostics() Diagnostics {
	o.mu.Lock()
	subs := append([]*darwinSubscription(nil), o.subs...)
	o.mu.Unlock()
	out := Diagnostics{Subscriptions: len(subs)}
	for _, sub := range subs {
		out.Tracked += int(sub.tracked.Load())
		if sub.degraded.Load() {
			out.Degraded++
		}
	}
	out.Failures = o.failures.Load()
	return out
}

func (o *darwinObservation) Close() error {
	o.mu.Lock()
	subs := o.subs
	o.subs = nil
	o.closed = true
	o.mu.Unlock()
	for _, sub := range subs {
		sub.Release()
	}
	return nil
}

func (o *darwinObservation) remove(sub *darwinSubscription) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i, candidate := range o.subs {
		if candidate == sub {
			o.subs = append(o.subs[:i], o.subs[i+1:]...)
			return
		}
	}
}

// Degraded is closed the first time the backend loses reliable delivery.
func (s *darwinSubscription) Degraded() <-chan struct{} { return s.degradedCh }

func (s *darwinSubscription) markDegraded(err error) {
	if s.degraded.CompareAndSwap(false, true) {
		s.obs.degraded.Add(1)
		s.degradedOnce.Do(func() { close(s.degradedCh) })
	}
	if err != nil {
		s.obs.failures.Add(1)
	}
}

func (s *darwinSubscription) UpdateExclusions(roots []string) error {
	cleaned, err := cleanExclusions(roots)
	if err != nil {
		return err
	}
	update := exclusionUpdate{roots: cleaned, done: make(chan struct{})}
	select {
	case s.exclusions <- update:
	case <-s.done:
		return nil
	}
	s.wake()
	select {
	case <-update.done:
	case <-s.done:
	}
	return nil
}

func (s *darwinSubscription) Release() {
	s.release.Do(func() {
		s.stopping.Store(true)
		s.wake()
		<-s.done
		s.closeHandles()
		s.obs.remove(s)
	})
}

func (s *darwinSubscription) wake() {
	var kev unix.Kevent_t
	unix.SetKevent(&kev, darwinWakeIdent, unix.EVFILT_USER, 0)
	kev.Fflags = unix.NOTE_TRIGGER
	_, _ = unix.Kevent(s.kq, []unix.Kevent_t{kev}, nil, nil)
}

func (s *darwinSubscription) closeHandles() {
	s.mu.Lock()
	for fd := range s.dirs {
		unix.Close(fd)
	}
	s.dirs = make(map[int]string)
	s.paths = make(map[string]int)
	s.mu.Unlock()
	s.tracked.Store(0)
	if s.kq >= 0 {
		unix.Close(s.kq)
		s.kq = -1
	}
}

func (s *darwinSubscription) run() {
	defer close(s.done)
	s.debugf("darwin run started kq=%d root=%s", s.kq, s.root)
	events := make([]unix.Kevent_t, 64)
	for {
		if s.stopping.Load() {
			return
		}
		n, err := unix.Kevent(s.kq, nil, events, nil)
		if err != nil {
			s.debugf("darwin kevent error: %v", err)
			if errors.Is(err, unix.EINTR) {
				continue
			}
			s.markDegraded(err)
			return
		}
		for i := 0; i < n; i++ {
			event := events[i]
			s.debugf("darwin event filter=%d ident=%d flags=%#x", event.Filter, event.Ident, event.Fflags)
			switch event.Filter {
			case unix.EVFILT_USER:
				s.applyExclusions()
			case unix.EVFILT_TIMER:
				s.contentPoll()
			case unix.EVFILT_VNODE:
				s.handleVnode(int(event.Ident), event.Fflags)
			}
		}
	}
}

// scanTree watches dir and every directory below it, recording what each one held so a later
// rescan can tell a creation from a rename.
func (s *darwinSubscription) scanTree(dir string) error {
	if excluded(s.excluded, dir) {
		return nil
	}
	entries, err := readDarwinEntries(dir)
	if err != nil {
		return err
	}
	s.entries[dir] = entries
	if err := s.watchDir(dir); err != nil {
		return err
	}
	for name, entry := range entries {
		if !entry.isDir {
			continue
		}
		child := filepath.Join(dir, name)
		if err := s.scanTree(child); err != nil {
			if errors.Is(err, unix.ENOENT) {
				continue
			}
			return err
		}
	}
	return nil
}

func (s *darwinSubscription) watchDir(dir string) error {
	s.mu.Lock()
	_, watched := s.paths[dir]
	s.mu.Unlock()
	if watched {
		return nil
	}
	fd, err := unix.Open(dir, unix.O_EVTONLY|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	var change unix.Kevent_t
	unix.SetKevent(&change, fd, unix.EVFILT_VNODE, unix.EV_ADD|unix.EV_CLEAR)
	change.Fflags = uint32(darwinVnodeMask)
	if _, err := unix.Kevent(s.kq, []unix.Kevent_t{change}, nil, nil); err != nil {
		unix.Close(fd)
		return err
	}
	s.mu.Lock()
	s.dirs[fd] = dir
	s.paths[dir] = fd
	s.mu.Unlock()
	s.tracked.Add(1)
	return nil
}

// forgetTree stops watching dir and everything below it without announcing anything, which is what
// a subtree that left the tree (deleted, or renamed to somewhere we do not watch) needs.
func (s *darwinSubscription) forgetTree(dir string) {
	s.mu.Lock()
	for fd, watched := range s.dirs {
		if under(dir, watched) {
			unix.Close(fd)
			delete(s.dirs, fd)
			delete(s.paths, watched)
			s.tracked.Add(-1)
		}
	}
	s.mu.Unlock()
	for watched := range s.entries {
		if under(dir, watched) {
			delete(s.entries, watched)
		}
	}
}

func (s *darwinSubscription) handleVnode(fd int, flags uint32) {
	s.mu.Lock()
	dir, watched := s.dirs[fd]
	s.mu.Unlock()
	if !watched {
		return
	}
	if flags&(unix.NOTE_DELETE|unix.NOTE_RENAME) != 0 {
		if dir == s.root {
			s.emit(Event{Path: s.root, Kind: Removed})
			s.markDegraded(nil)
			return
		}
		s.forgetTree(dir)
		s.emit(Event{Path: dir, Kind: Removed})
		return
	}
	if flags&unix.NOTE_WRITE != 0 {
		s.rescanDir(dir)
	}
}

func (s *darwinSubscription) rescanDir(dir string) {
	current, err := readDarwinEntries(dir)
	if err != nil {
		return
	}
	previous := s.entries[dir]
	s.entries[dir] = current
	gone := make(map[string]darwinEntry, len(previous))
	for name, entry := range previous {
		gone[name] = entry
	}
	for name, entry := range current {
		path := filepath.Join(dir, name)
		if old, ok := previous[name]; ok && (entry.ino == 0 || old.ino == entry.ino) {
			delete(gone, name)
			continue
		}
		if entry.ino != 0 {
			if oldName, ok := takeByInode(gone, entry.ino); ok {
				s.emit(Event{Path: path, From: filepath.Join(dir, oldName), Kind: Renamed})
				if entry.isDir {
					// The kernel watch follows the inode; the recorded path has to follow too.
					s.forgetTree(filepath.Join(dir, oldName))
					_ = s.scanTree(path)
				}
				continue
			}
		}
		s.emit(Event{Path: path, Kind: Created})
		if entry.isDir {
			_ = s.scanTree(path)
		}
	}
	for name, entry := range gone {
		path := filepath.Join(dir, name)
		if _, err := os.Lstat(path); err == nil {
			continue
		}
		if entry.isDir {
			s.forgetTree(path)
		}
		s.emit(Event{Path: path, Kind: Removed})
	}
}

func takeByInode(gone map[string]darwinEntry, ino uint64) (string, bool) {
	for name, entry := range gone {
		if entry.ino == ino {
			delete(gone, name)
			return name, true
		}
	}
	return "", false
}

// contentPoll reports content edits, which kqueue cannot see through a directory watch. It also
// reconciles directory entries from the same snapshots the vnode handler uses: a dropped vnode
// event costs one poll interval, not a permanently missing create, rename or delete.
func (s *darwinSubscription) contentPoll() {
	s.debugf("darwin content poll entries=%d", len(s.entries))
	dirs := make([]string, 0, len(s.entries))
	for dir := range s.entries {
		dirs = append(dirs, dir)
	}
	for _, dir := range dirs {
		s.rescanDir(dir)
	}
	s.mu.Lock()
	excludedRoots := s.excluded
	s.mu.Unlock()
	current := snapshotIdentities(s.root, excludedRoots)
	for path, id := range current {
		if previous, ok := s.snapshot[path]; ok && previous != id {
			s.emit(Event{Path: path, Kind: Written})
		}
	}
	s.snapshot = current
}

func (s *darwinSubscription) applyExclusions() {
	for {
		select {
		case update := <-s.exclusions:
			s.mu.Lock()
			s.excluded = update.roots
			excludedRoots := update.roots
			s.mu.Unlock()
			for dir := range s.entries {
				if excluded(excludedRoots, dir) {
					s.forgetTree(dir)
				}
			}
			if !excluded(excludedRoots, s.root) {
				// A quiet rebuild: a directory that was not watched during its exclusion has no
				// events to replay, and its existing files must not be announced as created.
				_ = s.scanTree(s.root)
			}
			s.snapshot = snapshotIdentities(s.root, excludedRoots)
			close(update.done)
		default:
			return
		}
	}
}

func (s *darwinSubscription) debugf(format string, args ...any) {
	if os.Getenv("BYSPACE_DEBUG_FILE_OBSERVATION") == "1" {
		fmt.Fprintf(os.Stderr, format+"\n", args...)
	}
}

func (s *darwinSubscription) emit(event Event) {
	s.debugf("darwin emit %s %s", event.Kind, event.Path)
	if s.stopping.Load() {
		return
	}
	s.mu.Lock()
	excludedRoots := s.excluded
	s.mu.Unlock()
	if event.Kind == Created {
		now := time.Now()
		for path, at := range s.recent {
			if now.Sub(at) > darwinCreatedDedupeTTL {
				delete(s.recent, path)
			}
		}
		if _, seen := s.recent[event.Path]; seen {
			return
		}
		if len(s.recent) >= darwinMaxRecentCreates {
			s.recent = make(map[string]time.Time)
		}
		s.recent[event.Path] = now
	}
	if excluded(excludedRoots, event.Path) {
		return
	}
	s.handler(event)
}

func readDarwinEntries(dir string) (map[string]darwinEntry, error) {
	list, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make(map[string]darwinEntry, len(list))
	for _, item := range list {
		entry := darwinEntry{isDir: item.IsDir()}
		if info, err := item.Info(); err == nil {
			if stat, ok := info.Sys().(*syscall.Stat_t); ok {
				entry.ino = uint64(stat.Ino)
			}
		}
		out[item.Name()] = entry
	}
	return out, nil
}
