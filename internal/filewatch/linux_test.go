//go:build linux

package filewatch

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func openLinux(t *testing.T) *linuxObservation {
	t.Helper()
	obs := newLinuxObservation()
	t.Cleanup(func() { _ = obs.Close() })
	return obs
}

// eventStream buffers what the handler sees. It drops rather than blocks on overflow: a test that
// fills the buffer has already failed elsewhere.
func eventStream() (func(Event), chan Event) {
	events := make(chan Event, 256)
	return func(ev Event) {
		select {
		case events <- ev:
		default:
		}
	}, events
}

func waitEvent(t *testing.T, events <-chan Event, match func(Event) bool, timeout time.Duration) Event {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case ev := <-events:
			if match(ev) {
				return ev
			}
		case <-deadline:
			t.Fatalf("timed out after %s waiting for an event", timeout)
			return Event{}
		}
	}
}

func expectNoEvent(t *testing.T, events <-chan Event, match func(Event) bool, window time.Duration) {
	t.Helper()
	deadline := time.After(window)
	for {
		select {
		case ev := <-events:
			if match(ev) {
				t.Fatalf("unexpected event %+v", ev)
			}
		case <-deadline:
			return
		}
	}
}

// drain discards events for a window, so the next assertion starts from a quiet stream.
func drain(events <-chan Event, window time.Duration) {
	deadline := time.After(window)
	for {
		select {
		case <-events:
		case <-deadline:
			return
		}
	}
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestLinuxReportsWriteRenameAndDelete(t *testing.T) {
	obs := openLinux(t)
	root := t.TempDir()
	handler, events := eventStream()
	sub, err := obs.Subscribe(root, Options{}, handler)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	path := filepath.Join(root, "a.txt")
	writeFile(t, path, "first")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == path && ev.Kind == Created }, 5*time.Second)
	drain(events, 150*time.Millisecond)

	writeFile(t, path, "second")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == path && ev.Kind == Written }, 5*time.Second)

	renamed := filepath.Join(root, "b.txt")
	if err := os.Rename(path, renamed); err != nil {
		t.Fatalf("rename: %v", err)
	}
	ev := waitEvent(t, events, func(ev Event) bool { return ev.Kind == Renamed }, 5*time.Second)
	if ev.Path != renamed || ev.From != path {
		t.Fatalf("rename event = %+v, want %s from %s", ev, renamed, path)
	}

	if err := os.Remove(renamed); err != nil {
		t.Fatalf("remove: %v", err)
	}
	waitEvent(t, events, func(ev Event) bool { return ev.Path == renamed && ev.Kind == Removed }, 5*time.Second)
}

func TestLinuxNestedCreateReportedOnce(t *testing.T) {
	obs := openLinux(t)
	root := t.TempDir()
	handler, events := eventStream()
	sub, err := obs.Subscribe(root, Options{}, handler)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	// The directories appear faster than their watches can be installed, so the file is found by a
	// topology repair rather than by a kernel event. It must still be reported exactly once.
	target := filepath.Join(root, "src", "pkg", "file.txt")
	writeFile(t, target, "hello")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == target && ev.Kind == Created }, 5*time.Second)
	expectNoEvent(t, events, func(ev Event) bool { return ev.Path == target && ev.Kind == Created }, 300*time.Millisecond)
}

func TestLinuxPrunesExcludedSubtrees(t *testing.T) {
	obs := openLinux(t)
	root := t.TempDir()
	ignored := filepath.Join(root, "node_modules")
	handler, events := eventStream()
	sub, err := obs.Subscribe(root, Options{Excluded: []string{ignored}}, handler)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	writeFile(t, filepath.Join(ignored, "pkg", "index.js"), "module.exports = 1")
	kept := filepath.Join(root, "kept.txt")
	writeFile(t, kept, "kept")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == kept && ev.Kind == Created }, 5*time.Second)
	expectNoEvent(t, events, func(ev Event) bool { return under(ignored, ev.Path) }, 400*time.Millisecond)
}

func TestLinuxUpdateExclusions(t *testing.T) {
	obs := openLinux(t)
	root := t.TempDir()
	skip := filepath.Join(root, "src")
	handler, events := eventStream()
	sub, err := obs.Subscribe(root, Options{}, handler)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	live := filepath.Join(root, "live.txt")
	writeFile(t, live, "live")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == live && ev.Kind == Created }, 5*time.Second)

	if err := sub.UpdateExclusions([]string{skip}); err != nil {
		t.Fatalf("update exclusions: %v", err)
	}
	writeFile(t, filepath.Join(skip, "ignored.txt"), "ignored")
	expectNoEvent(t, events, func(ev Event) bool { return under(skip, ev.Path) }, 400*time.Millisecond)

	if err := sub.UpdateExclusions(nil); err != nil {
		t.Fatalf("clear exclusions: %v", err)
	}
	// The exclusion replacement rebuilds the watch after the debounce.
	time.Sleep(300 * time.Millisecond)
	included := filepath.Join(skip, "included.txt")
	writeFile(t, included, "included")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == included && ev.Kind == Created }, 5*time.Second)
}

func TestLinuxRepairsOnlyTheMovedSubtree(t *testing.T) {
	obs := openLinux(t)
	root := t.TempDir()
	moved := filepath.Join(root, "moved")
	populate(t, moved, 3)
	populate(t, filepath.Join(root, "sibling"), 30)

	handler, events := eventStream()
	sub, err := obs.Subscribe(root, Options{}, handler)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	probe := filepath.Join(root, "probe.txt")
	writeFile(t, probe, "probe")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == probe }, 5*time.Second)

	before := sub.(*linuxSubscription).scans.Load()
	renamed := filepath.Join(root, "moved2")
	if err := os.Rename(moved, renamed); err != nil {
		t.Fatalf("rename subtree: %v", err)
	}
	waitEvent(t, events, func(ev Event) bool { return ev.Kind == Renamed && ev.From == moved }, 5*time.Second)

	deadline := time.Now().Add(2 * time.Second)
	for sub.(*linuxSubscription).scans.Load() == before && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	delta := sub.(*linuxSubscription).scans.Load() - before
	if delta < 1 {
		t.Fatalf("moving a directory did not rescan it")
	}
	if delta > 10 {
		t.Fatalf("moving a subtree scanned %d paths; the sibling tree was rescanned", delta)
	}
}

func TestLinuxFileRenameCostsNoRescan(t *testing.T) {
	obs := openLinux(t)
	root := t.TempDir()
	handler, events := eventStream()
	sub, err := obs.Subscribe(root, Options{}, handler)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	path := filepath.Join(root, "a.txt")
	writeFile(t, path, "a")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == path }, 5*time.Second)
	drain(events, 150*time.Millisecond)

	before := sub.(*linuxSubscription).scans.Load()
	if err := os.Rename(path, filepath.Join(root, "b.txt")); err != nil {
		t.Fatalf("rename: %v", err)
	}
	waitEvent(t, events, func(ev Event) bool { return ev.Kind == Renamed && ev.From == path }, 5*time.Second)
	drain(events, 150*time.Millisecond)
	if after := sub.(*linuxSubscription).scans.Load(); after != before {
		t.Fatalf("a file rename scanned %d paths, want none", after-before)
	}
}

func TestLinuxReportsDegradedOnWatchFailure(t *testing.T) {
	original := inotifyAddWatch
	t.Cleanup(func() { inotifyAddWatch = original })
	inotifyAddWatch = func(int, string, uint32) (int, error) {
		return -1, unix.ENOSPC
	}

	obs := openLinux(t)
	sub, err := obs.Subscribe(t.TempDir(), Options{}, func(Event) {})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	diag := obs.Diagnostics()
	if diag.Degraded != 1 {
		t.Fatalf("diagnostics degraded = %d, want 1 (%+v)", diag.Degraded, diag)
	}
	if diag.Failures == 0 {
		t.Fatalf("watch failure was not counted: %+v", diag)
	}
}

func TestLinuxReportsDegradedWhenCapExceeded(t *testing.T) {
	original := maxTrackedEntries
	t.Cleanup(func() { maxTrackedEntries = original })
	maxTrackedEntries = 2

	obs := openLinux(t)
	root := t.TempDir()
	for i := 0; i < 5; i++ {
		if err := os.Mkdir(filepath.Join(root, fmt.Sprintf("d%d", i)), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	sub, err := obs.Subscribe(root, Options{}, func(Event) {})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	diag := obs.Diagnostics()
	if diag.Degraded != 1 {
		t.Fatalf("diagnostics degraded = %d, want 1 (%+v)", diag.Degraded, diag)
	}
	if diag.Tracked > maxTrackedEntries {
		t.Fatalf("tracked %d directories, cap is %d", diag.Tracked, maxTrackedEntries)
	}
}

func TestLinuxReleaseIsABarrier(t *testing.T) {
	root := t.TempDir()
	baseline := openFDs(t)

	obs := openLinux(t)
	handler, events := eventStream()
	sub, err := obs.Subscribe(root, Options{}, handler)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	path := filepath.Join(root, "a.txt")
	writeFile(t, path, "a")
	waitEvent(t, events, func(ev Event) bool { return ev.Path == path }, 5*time.Second)

	// Renaming the root removes the watched inode's path. Release must still drop every descriptor
	// and stop delivery.
	moved := root + "-moved"
	if err := os.Rename(root, moved); err != nil {
		t.Fatalf("rename root: %v", err)
	}
	sub.Release()
	if after := openFDs(t); after != baseline {
		t.Fatalf("open descriptors before subscribe %d, after release %d", baseline, after)
	}
	for len(events) > 0 {
		<-events
	}
	writeFile(t, filepath.Join(moved, "late.txt"), "late")
	time.Sleep(200 * time.Millisecond)
	if len(events) != 0 {
		t.Fatalf("callback after Release: %+v", <-events)
	}
	if diag := obs.Diagnostics(); diag.Subscriptions != 0 {
		t.Fatalf("subscriptions after Release = %d, want 0", diag.Subscriptions)
	}
	if err := obs.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}

func TestLinuxSubscribeRejectsMissingRoot(t *testing.T) {
	obs := openLinux(t)
	if _, err := obs.Subscribe(filepath.Join(t.TempDir(), "absent"), Options{}, func(Event) {}); err == nil {
		t.Fatal("subscribing to a missing root succeeded")
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("error = %v, want a not-exist error", err)
	}
}

func populate(t *testing.T, root string, dirs int) {
	t.Helper()
	for i := 0; i < dirs; i++ {
		writeFile(t, filepath.Join(root, fmt.Sprintf("d%d", i), "f.txt"), "x")
	}
}

func openFDs(t *testing.T) int {
	t.Helper()
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatalf("read /proc/self/fd: %v", err)
	}
	return len(entries)
}
