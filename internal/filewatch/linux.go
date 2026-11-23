//go:build linux

package filewatch

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

// The Linux backend watches one inotify descriptor per subscription and one watch per directory:
// inotify is not recursive, and a watch follows the inode, so a rename keeps delivering and only the
// path bookkeeping has to be repaired. Directories are added as they appear; a burst of them is
// repaired after rescanDelay instead of per event.

const (
	inotifyMask = unix.IN_CREATE | unix.IN_DELETE | unix.IN_MOVED_FROM | unix.IN_MOVED_TO |
		unix.IN_CLOSE_WRITE | unix.IN_DELETE_SELF | unix.IN_MOVE_SELF | unix.IN_ONLYDIR
	eventBufferSize = 64 * 1024
	// rescanDelay coalesces topology repair for a directory burst such as an install.
	rescanDelay = 50 * time.Millisecond
	// createdDedupeTTL drops the second report of a path that both a scan and the kernel saw created.
	// Only Created events are deduplicated: a write is always delivered.
	createdDedupeTTL = 2 * time.Second
	// movePartnerTimeout bounds how long a half of a rename waits for the other half. A file moved out
	// of the tree never gets one, so the saved source becomes a Removed event.
	movePartnerTimeout = 2 * time.Second
	maxRecentCreates   = 4096
)

var (
	inotifyAddWatch = unix.InotifyAddWatch
	// maxTrackedEntries caps watched directories per subscription. Exceeding it degrades the
	// subscription; a variable so the cap test can lower it.
	maxTrackedEntries = 250_000
)

var errQueueOverflow = errors.New("filewatch: inotify queue overflow")

// Open returns the platform observation backend.
func Open() (Observation, error) {
	return newPolledObservation(newLinuxObservation(), realClock{}), nil
}

type linuxObservation struct {
	mu     sync.Mutex
	subs   []*linuxSubscription
	closed bool

	degraded atomic.Int64
	failures atomic.Int64
}

func newLinuxObservation() *linuxObservation {
	return &linuxObservation{}
}

type moveSource struct {
	path string
	at   time.Time
}

type linuxSubscription struct {
	obs     *linuxObservation
	root    string
	handler func(Event)
	fd      int
	wakeR   int
	wakeW   int
	done    chan struct{}

	degradedOnce sync.Once
	degradedCh   chan struct{}

	stopping atomic.Bool
	pending  atomic.Int64
	tracked  atomic.Int64
	scans    atomic.Int64
	degraded atomic.Bool

	exclusions chan exclusionUpdate
	release    sync.Once

	// Reader-owned state: only run and the helpers it calls touch these.
	excluded []string
	dirs     map[int]string
	paths    map[string]int
	rescans  map[string]bool
	rescanAt time.Time
	moves    map[uint32]moveSource
	recent   map[string]time.Time
	buf      []byte
}

func (o *linuxObservation) Subscribe(root string, opts Options, handler func(Event)) (Subscription, error) {
	root, err := cleanRoot(root)
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

	fd, err := unix.InotifyInit1(unix.IN_CLOEXEC)
	if err != nil {
		return nil, err
	}
	var pipes [2]int
	if err := unix.Pipe2(pipes[:], unix.O_CLOEXEC|unix.O_NONBLOCK); err != nil {
		unix.Close(fd)
		return nil, err
	}
	sub := &linuxSubscription{
		obs:        o,
		root:       root,
		handler:    handler,
		fd:         fd,
		wakeR:      pipes[0],
		wakeW:      pipes[1],
		done:       make(chan struct{}),
		degradedCh: make(chan struct{}),
		exclusions: make(chan exclusionUpdate, 8),
		excluded:   excludedRoots,
		dirs:       make(map[int]string),
		paths:      make(map[string]int),
		rescans:    make(map[string]bool),
		moves:      make(map[uint32]moveSource),
		recent:     make(map[string]time.Time),
		buf:        make([]byte, eventBufferSize),
	}
	if err := sub.scan(root, false); err != nil {
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

func (o *linuxObservation) Diagnostics() Diagnostics {
	o.mu.Lock()
	subs := append([]*linuxSubscription(nil), o.subs...)
	o.mu.Unlock()
	out := Diagnostics{
		Subscriptions: len(subs),
		Degraded:      int(o.degraded.Load()),
		Failures:      o.failures.Load(),
	}
	for _, sub := range subs {
		out.Tracked += int(sub.tracked.Load())
		out.Pending += int(sub.pending.Load())
	}
	return out
}

func (o *linuxObservation) Close() error {
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

func (o *linuxObservation) remove(sub *linuxSubscription) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i, candidate := range o.subs {
		if candidate == sub {
			o.subs = append(o.subs[:i], o.subs[i+1:]...)
			return
		}
	}
}

// UpdateExclusions replaces the excluded roots. The scan runs on the observation goroutine so the
// path maps stay single-owner; the acknowledgement makes it a barrier for the caller.
func (s *linuxSubscription) UpdateExclusions(roots []string) error {
	cleaned, err := cleanExclusions(roots)
	if err != nil {
		return err
	}
	req := exclusionUpdate{roots: cleaned, done: make(chan struct{})}
	select {
	case s.exclusions <- req:
	case <-s.done:
		return nil
	}
	s.wake()
	select {
	case <-req.done:
		return nil
	case <-s.done:
		return nil
	}
}

// Release is a barrier: it waits for the observation goroutine, so no handler can be in flight once
// it returns, then closes the descriptors.
func (s *linuxSubscription) Release() {
	s.release.Do(func() {
		s.stopping.Store(true)
		s.wake()
		<-s.done
		s.closeHandles()
		s.obs.remove(s)
	})
}

func (s *linuxSubscription) closeHandles() {
	for _, fd := range []int{s.fd, s.wakeR, s.wakeW} {
		if fd >= 0 {
			unix.Close(fd)
		}
	}
	s.fd, s.wakeR, s.wakeW = -1, -1, -1
}

func (s *linuxSubscription) run() {
	defer close(s.done)
	pfds := []unix.PollFd{
		{Fd: int32(s.fd), Events: unix.POLLIN},
		{Fd: int32(s.wakeR), Events: unix.POLLIN},
	}
	for {
		if s.stopping.Load() {
			return
		}
		s.flushRescans(false)
		timeout := -1
		if len(s.rescans) > 0 {
			timeout = int(time.Until(s.rescanAt) / time.Millisecond)
			if timeout < 0 {
				timeout = 0
			}
		}
		n, err := unix.Poll(pfds, timeout)
		if err != nil {
			if errors.Is(err, unix.EINTR) {
				continue
			}
			s.markDegraded(err)
			return
		}
		if n == 0 {
			s.flushRescans(true)
			continue
		}
		if pfds[1].Revents&unix.POLLIN != 0 {
			s.drainWake()
			s.applyExclusions()
		}
		if s.stopping.Load() {
			return
		}
		if pfds[1].Revents&(unix.POLLERR|unix.POLLHUP) != 0 {
			return
		}
		if pfds[0].Revents&unix.POLLIN != 0 && !s.readEvents() {
			return
		}
	}
}

func (s *linuxSubscription) wake() {
	if s.wakeW < 0 {
		return
	}
	_, _ = unix.Write(s.wakeW, []byte{0})
}

func (s *linuxSubscription) drainWake() {
	var buf [64]byte
	for {
		if _, err := unix.Read(s.wakeR, buf[:]); err != nil {
			return
		}
	}
}

func (s *linuxSubscription) readEvents() bool {
	n, err := unix.Read(s.fd, s.buf)
	if n > 0 {
		s.handleEvents(s.buf[:n])
	}
	if err == nil || errors.Is(err, unix.EINTR) || errors.Is(err, unix.EAGAIN) {
		return true
	}
	s.markDegraded(err)
	return false
}

func (s *linuxSubscription) applyExclusions() {
	for {
		select {
		case req := <-s.exclusions:
			s.setExclusions(req.roots)
			close(req.done)
		default:
			return
		}
	}
}

func (s *linuxSubscription) setExclusions(roots []string) {
	s.excluded = roots
	for dir, wd := range s.paths {
		if excluded(roots, dir) {
			_, _ = unix.InotifyRmWatch(s.fd, uint32(wd))
			delete(s.dirs, wd)
			delete(s.paths, dir)
			s.tracked.Add(-1)
		}
	}
	for path := range s.rescans {
		if excluded(roots, path) {
			delete(s.rescans, path)
		}
	}
	// A root that was excluded and is now included has no watch, so rebuild the topology without
	// announcing existing files as created. This scan is synchronous: the acknowledgement is a
	// barrier, and a deferred scan would leave a window in which changes are never reported.
	_ = s.scan(s.root, false)
}

func (s *linuxSubscription) handleEvents(buf []byte) {
	now := time.Now()
	for cookie, src := range s.moves {
		if now.Sub(src.at) > movePartnerTimeout {
			delete(s.moves, cookie)
			s.emit(Event{Path: src.path, Kind: Removed})
		}
	}
	offset := 0
	for offset+unix.SizeofInotifyEvent <= len(buf) {
		raw := (*unix.InotifyEvent)(unsafe.Pointer(&buf[offset]))
		offset += unix.SizeofInotifyEvent
		name := ""
		if raw.Len > 0 {
			end := offset + int(raw.Len)
			if end > len(buf) {
				break
			}
			name = strings.TrimRight(string(buf[offset:end]), "\x00")
			offset = end
		}
		s.handleEvent(int(raw.Wd), raw.Mask, raw.Cookie, name)
	}
}

func (s *linuxSubscription) handleEvent(wd int, mask uint32, cookie uint32, name string) {
	if mask&unix.IN_Q_OVERFLOW != 0 {
		s.markDegraded(errQueueOverflow)
		return
	}
	dir, tracked := s.dirs[wd]
	if mask&unix.IN_IGNORED != 0 {
		if tracked {
			delete(s.dirs, wd)
			delete(s.paths, dir)
			s.tracked.Add(-1)
		}
		return
	}
	if !tracked {
		return
	}
	if mask&unix.IN_DELETE_SELF != 0 {
		s.dropSubtree(dir)
		if dir == s.root {
			s.emit(Event{Path: dir, Kind: Removed})
			s.markDegraded(nil)
		}
		return
	}
	if mask&unix.IN_MOVE_SELF != 0 {
		// A moved child is re-keyed by its parent's MOVED_FROM/MOVED_TO pair. Only the root has no
		// parent in the tree, so its own move leaves nothing to observe.
		if dir == s.root {
			s.dropSubtree(dir)
			s.emit(Event{Path: dir, Kind: Removed})
			s.markDegraded(nil)
		}
		return
	}
	path := dir
	if name != "" {
		path = filepath.Join(dir, name)
	}
	switch {
	case mask&unix.IN_CREATE != 0:
		s.emit(Event{Path: path, Kind: Created})
		if isDir(path) {
			s.queueRescan(path, true)
		}
	case mask&unix.IN_MOVED_FROM != 0:
		s.moves[cookie] = moveSource{path: path, at: time.Now()}
	case mask&unix.IN_MOVED_TO != 0:
		src, paired := s.moves[cookie]
		if paired {
			delete(s.moves, cookie)
			s.emit(Event{Path: path, From: src.path, Kind: Renamed})
			s.forgetSubtree(src.path)
		} else {
			s.emit(Event{Path: path, Kind: Created})
		}
		// One classification stat decides whether the move needs a subtree repair. A rename inside the
		// tree keeps the kernel watches, so its files are not announced as created.
		if isDir(path) {
			s.queueRescan(path, !paired)
		}
	case mask&unix.IN_DELETE != 0:
		s.emit(Event{Path: path, Kind: Removed})
		s.dropSubtree(path)
	case mask&unix.IN_CLOSE_WRITE != 0:
		s.emit(Event{Path: path, Kind: Written})
	}
}

func (s *linuxSubscription) queueRescan(path string, announce bool) {
	if excluded(s.excluded, path) {
		return
	}
	if queued, ok := s.rescans[path]; ok {
		s.rescans[path] = queued || announce
		return
	}
	if len(s.rescans) == 0 {
		s.rescanAt = time.Now().Add(rescanDelay)
	}
	s.rescans[path] = announce
}

func (s *linuxSubscription) flushRescans(force bool) {
	if len(s.rescans) == 0 {
		return
	}
	if !force && time.Now().Before(s.rescanAt) {
		return
	}
	paths := make([]string, 0, len(s.rescans))
	for path := range s.rescans {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool { return len(paths[i]) < len(paths[j]) })
	scanned := make([]string, 0, len(paths))
	for _, path := range paths {
		announce := s.rescans[path]
		if coveredBy(scanned, path) {
			continue
		}
		scanned = append(scanned, path)
		if err := s.scan(path, announce); err != nil {
			s.markDegraded(err)
			break
		}
	}
	s.rescans = make(map[string]bool)
}

func coveredBy(roots []string, path string) bool {
	for _, root := range roots {
		if under(root, path) {
			return true
		}
	}
	return false
}

// scan adds a watch for every directory below root that is not excluded. With announce it reports
// the entries it finds, because an entry discovered before its directory had a watch would
// otherwise never be reported.
func (s *linuxSubscription) scan(root string, announce bool) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if path == root {
				return err
			}
			return nil
		}
		if !entry.IsDir() {
			if announce && path != root {
				s.emit(Event{Path: path, Kind: Created})
			}
			return nil
		}
		if excluded(s.excluded, path) {
			return filepath.SkipDir
		}
		if announce && path != root {
			s.emit(Event{Path: path, Kind: Created})
		}
		s.scans.Add(1)
		if _, ok := s.paths[path]; ok {
			return nil
		}
		if s.tracked.Load() >= int64(maxTrackedEntries) {
			s.markDegraded(nil)
			return filepath.SkipAll
		}
		wd, err := inotifyAddWatch(s.fd, path, inotifyMask)
		if err != nil {
			if errors.Is(err, unix.ENOENT) {
				return nil
			}
			s.markDegraded(err)
			return filepath.SkipAll
		}
		s.dirs[wd] = path
		s.paths[path] = wd
		s.tracked.Add(1)
		return nil
	})
}

func (s *linuxSubscription) forgetSubtree(prefix string) {
	for dir, wd := range s.paths {
		if !under(prefix, dir) {
			continue
		}
		delete(s.dirs, wd)
		delete(s.paths, dir)
		s.tracked.Add(-1)
	}
}

func (s *linuxSubscription) dropSubtree(prefix string) {
	for dir, wd := range s.paths {
		if !under(prefix, dir) {
			continue
		}
		_, _ = unix.InotifyRmWatch(s.fd, uint32(wd))
		delete(s.dirs, wd)
		delete(s.paths, dir)
		s.tracked.Add(-1)
	}
}

func (s *linuxSubscription) emit(ev Event) {
	if s.stopping.Load() || excluded(s.excluded, ev.Path) {
		return
	}
	if ev.Kind == Created {
		if at, ok := s.recent[ev.Path]; ok && time.Since(at) < createdDedupeTTL {
			return
		}
		if len(s.recent) >= maxRecentCreates {
			for path, at := range s.recent {
				if time.Since(at) > createdDedupeTTL {
					delete(s.recent, path)
				}
			}
			if len(s.recent) >= maxRecentCreates {
				s.recent = make(map[string]time.Time, maxRecentCreates)
			}
		}
		s.recent[ev.Path] = time.Now()
	}
	s.pending.Add(1)
	s.handler(ev)
	s.pending.Add(-1)
}

// markDegraded records that the subscription can no longer be trusted to report every event. A nil
// error records the state without a failure: losing the root to a rename is not a watch failure.
// Degraded is closed the first time the backend loses reliable delivery.
func (s *linuxSubscription) Degraded() <-chan struct{} { return s.degradedCh }

func (s *linuxSubscription) markDegraded(err error) {
	if s.degraded.CompareAndSwap(false, true) {
		s.obs.degraded.Add(1)
		s.degradedOnce.Do(func() { close(s.degradedCh) })
	}
	if err != nil {
		s.obs.failures.Add(1)
	}
}

func isDir(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.IsDir()
}
