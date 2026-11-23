//go:build windows

package filewatch

import (
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The Windows backend watches one subtree with one ReadDirectoryChangesW handle: the kernel reports
// create, write, rename and delete for every entry below the root, so there is no per-directory
// bookkeeping and no rescan. The handle cannot exclude a subtree, so excluded paths are filtered at
// delivery. A buffer overflow means the events we skipped cannot be reconstructed; the subscription
// degrades and its consumer polls until it is re-subscribed.

const (
	// notifyBufferSize bounds one batch. A burst larger than this overflows and degrades the
	// subscription, which is why the consumer must be able to fall back to polling.
	notifyBufferSize = 64 * 1024
	notifyFilter     = windows.FILE_NOTIFY_CHANGE_FILE_NAME | windows.FILE_NOTIFY_CHANGE_DIR_NAME |
		windows.FILE_NOTIFY_CHANGE_LAST_WRITE | windows.FILE_NOTIFY_CHANGE_SIZE |
		windows.FILE_NOTIFY_CHANGE_CREATION
)

var errNotifyOverflow = errors.New("filewatch: ReadDirectoryChangesW buffer overflowed")

// Open returns the platform observation backend.
func Open() (Observation, error) {
	return newPolledObservation(newWindowsObservation(), realClock{}), nil
}

type windowsObservation struct {
	mu     sync.Mutex
	subs   []*windowsSubscription
	closed bool

	degraded atomic.Int64
	failures atomic.Int64
}

func newWindowsObservation() *windowsObservation {
	return &windowsObservation{}
}

type windowsSubscription struct {
	obs     *windowsObservation
	root    string
	handler func(Event)

	handle windows.Handle
	event  windows.Handle
	wake   windows.Handle
	done   chan struct{}

	degradedOnce sync.Once
	degradedCh   chan struct{}

	stopping atomic.Bool
	pending  atomic.Int64
	tracked  atomic.Int64
	degraded atomic.Bool

	exclusions chan exclusionUpdate
	release    sync.Once

	// Reader-owned state.
	excluded   []string
	overlapped windows.Overlapped
	issued     bool
	buf        []byte
	renameFrom string
}

func (o *windowsObservation) Subscribe(root string, opts Options, handler func(Event)) (Subscription, error) {
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
	path, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(path, windows.FILE_LIST_DIRECTORY,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OVERLAPPED, 0)
	if err != nil {
		return nil, err
	}
	event, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		windows.CloseHandle(handle)
		return nil, err
	}
	wake, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		windows.CloseHandle(event)
		windows.CloseHandle(handle)
		return nil, err
	}
	sub := &windowsSubscription{
		obs:        o,
		root:       root,
		handler:    handler,
		handle:     handle,
		event:      event,
		wake:       wake,
		done:       make(chan struct{}),
		degradedCh: make(chan struct{}),
		exclusions: make(chan exclusionUpdate, 8),
		excluded:   excludedRoots,
		buf:        make([]byte, notifyBufferSize),
	}
	sub.overlapped.HEvent = event

	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		sub.closeHandles()
		return nil, errors.New("filewatch: observation is closed")
	}
	o.subs = append(o.subs, sub)
	o.mu.Unlock()
	// Issue the first read before returning: ReadDirectoryChangesW reports nothing that happened
	// before the call, so a create that lands between Subscribe and the first read would be lost.
	if !sub.issue() {
		// run was never started, so tear down here instead of blocking in Release.
		sub.closeHandles()
		o.remove(sub)
		close(sub.done)
		return nil, errors.New("filewatch: cannot start ReadDirectoryChangesW")
	}
	go sub.run()
	return sub, nil
}

func (o *windowsObservation) Diagnostics() Diagnostics {
	o.mu.Lock()
	subs := append([]*windowsSubscription(nil), o.subs...)
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

func (o *windowsObservation) Close() error {
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

func (o *windowsObservation) remove(sub *windowsSubscription) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i, candidate := range o.subs {
		if candidate == sub {
			o.subs = append(o.subs[:i], o.subs[i+1:]...)
			return
		}
	}
}

// UpdateExclusions replaces the excluded roots. The acknowledgement is delivered by the observation
// goroutine, which is the only caller of the handler, so no event below a newly excluded root can be
// delivered after this returns.
func (s *windowsSubscription) UpdateExclusions(roots []string) error {
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
	_ = windows.SetEvent(s.wake)
	select {
	case <-req.done:
		return nil
	case <-s.done:
		return nil
	}
}

// Release is a barrier: it waits for the observation goroutine, so no handler can be in flight once
// it returns, then closes the handles.
func (s *windowsSubscription) Release() {
	s.release.Do(func() {
		s.stopping.Store(true)
		_ = windows.SetEvent(s.wake)
		<-s.done
		s.closeHandles()
		s.obs.remove(s)
	})
}

func (s *windowsSubscription) closeHandles() {
	for _, handle := range []windows.Handle{s.handle, s.event, s.wake} {
		if handle != 0 && handle != windows.InvalidHandle {
			windows.CloseHandle(handle)
		}
	}
	s.handle, s.event, s.wake = 0, 0, 0
	s.tracked.Store(0)
}

func (s *windowsSubscription) run() {
	defer close(s.done)
	handles := []windows.Handle{s.event, s.wake}
	for {
		if s.stopping.Load() {
			s.cancel()
			return
		}
		if !s.issued {
			if !s.issue() {
				return
			}
		}
		index, err := windows.WaitForMultipleObjects(handles, false, windows.INFINITE)
		if err != nil {
			s.markDegraded(err)
			s.cancel()
			return
		}
		switch index {
		case 0:
			if !s.collect() {
				return
			}
		case 1:
			s.applyExclusions()
		}
	}
}

// issue starts one asynchronous read. It reports false when the subscription can no longer deliver.
func (s *windowsSubscription) issue() bool {
	s.tracked.Store(1)
	var returned uint32
	err := windows.ReadDirectoryChanges(s.handle, &s.buf[0], uint32(len(s.buf)), true, notifyFilter,
		&returned, &s.overlapped, 0)
	switch {
	case err == nil:
		// Completed synchronously: the event handle is set and collect can reap it.
		s.issued = true
		return true
	case errors.Is(err, windows.ERROR_IO_PENDING):
		s.issued = true
		return true
	case errors.Is(err, windows.ERROR_OPERATION_ABORTED):
		return false
	default:
		s.markDegraded(err)
		return false
	}
}

// collect waits for the issued read and delivers its events.
func (s *windowsSubscription) collect() bool {
	var returned uint32
	err := windows.GetOverlappedResult(s.handle, &s.overlapped, &returned, false)
	s.issued = false
	if err != nil {
		if errors.Is(err, windows.ERROR_OPERATION_ABORTED) {
			return false
		}
		s.markDegraded(err)
		return false
	}
	if returned == 0 {
		// A zero result means the buffer overflowed: the kernel dropped the rest of the batch and
		// there is no way to reconstruct which paths it covered.
		s.markDegraded(errNotifyOverflow)
		return true
	}
	s.handleNotifications(s.buf[:returned])
	return true
}

func (s *windowsSubscription) cancel() {
	if !s.issued {
		return
	}
	_ = windows.CancelIoEx(s.handle, &s.overlapped)
	var returned uint32
	_ = windows.GetOverlappedResult(s.handle, &s.overlapped, &returned, true)
	s.issued = false
}

func (s *windowsSubscription) applyExclusions() {
	for {
		select {
		case req := <-s.exclusions:
			s.excluded = req.roots
			close(req.done)
		default:
			return
		}
	}
}

// fileNotifyHeaderSize is NextEntryOffset + Action + FileNameLength; the name follows it.
const fileNotifyHeaderSize = 12

func (s *windowsSubscription) handleNotifications(buf []byte) {
	offset := uint32(0)
	for {
		if offset+fileNotifyHeaderSize > uint32(len(buf)) {
			return
		}
		info := (*windows.FileNotifyInformation)(unsafe.Pointer(&buf[offset]))
		name := s.name(buf, offset, info.FileNameLength)
		switch info.Action {
		case windows.FILE_ACTION_ADDED:
			s.emit(Event{Path: name, Kind: Created})
		case windows.FILE_ACTION_REMOVED:
			s.emit(Event{Path: name, Kind: Removed})
		case windows.FILE_ACTION_MODIFIED:
			s.emit(Event{Path: name, Kind: Written})
		case windows.FILE_ACTION_RENAMED_OLD_NAME:
			s.renameFrom = name
		case windows.FILE_ACTION_RENAMED_NEW_NAME:
			from := s.renameFrom
			s.renameFrom = ""
			s.emit(Event{Path: name, From: from, Kind: Renamed})
		}
		if info.NextEntryOffset == 0 {
			return
		}
		offset += info.NextEntryOffset
	}
}

// name decodes one notification path. The kernel reports it relative to the watched root.
func (s *windowsSubscription) name(buf []byte, offset, length uint32) string {
	size := int(length) / 2
	if size == 0 {
		return s.root
	}
	start := unsafe.Pointer(&buf[offset+fileNotifyHeaderSize])
	name := windows.UTF16ToString(unsafe.Slice((*uint16)(start), size))
	if name == "" {
		return s.root
	}
	return filepath.Join(s.root, name)
}

func (s *windowsSubscription) emit(ev Event) {
	if s.stopping.Load() || excluded(s.excluded, ev.Path) {
		return
	}
	s.pending.Add(1)
	s.handler(ev)
	s.pending.Add(-1)
}

// Degraded is closed the first time the backend loses reliable delivery.
func (s *windowsSubscription) Degraded() <-chan struct{} { return s.degradedCh }

func (s *windowsSubscription) markDegraded(err error) {
	if s.degraded.CompareAndSwap(false, true) {
		s.obs.degraded.Add(1)
		s.degradedOnce.Do(func() { close(s.degradedCh) })
	}
	if err != nil {
		s.obs.failures.Add(1)
	}
}
