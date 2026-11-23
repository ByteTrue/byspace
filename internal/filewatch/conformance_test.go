//go:build linux || windows || darwin

package filewatch

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// These tests run against the real Open backend on every platform that has one, so a new backend has
// to satisfy the same contract the Linux one was measured against.

const conformanceTimeout = 5 * time.Second

func subscribeReal(t *testing.T, root string, excluded []string) (<-chan Event, Subscription) {
	t.Helper()
	obs, err := Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = obs.Close() })
	events := make(chan Event, 1024)
	sub, err := obs.Subscribe(root, Options{Excluded: excluded}, func(ev Event) {
		select {
		case events <- ev:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	t.Cleanup(sub.Release)
	return events, sub
}

func waitConformanceEvent(t *testing.T, events <-chan Event, path string, kind Kind) Event {
	t.Helper()
	deadline := time.After(conformanceTimeout)
	var seen []Event
	for {
		select {
		case ev := <-events:
			seen = append(seen, ev)
			if ev.Path == path && ev.Kind == kind {
				return ev
			}
		case <-deadline:
			t.Fatalf("no %s event for %s within %s; saw %v", kind, path, conformanceTimeout, seen)
		}
	}
}

func expectQuiet(t *testing.T, events <-chan Event, path string) {
	t.Helper()
	deadline := time.After(400 * time.Millisecond)
	for {
		select {
		case ev := <-events:
			if ev.Path == path {
				t.Fatalf("got %s event for excluded %s", ev.Kind, path)
			}
		case <-deadline:
			return
		}
	}
}

func TestOpenReportsFilesystemChanges(t *testing.T) {
	root := t.TempDir()
	events, _ := subscribeReal(t, root, nil)

	file := filepath.Join(root, "a.txt")
	if err := os.WriteFile(file, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitConformanceEvent(t, events, file, Created)

	if err := os.WriteFile(file, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitConformanceEvent(t, events, file, Written)

	renamed := filepath.Join(root, "b.txt")
	if err := os.Rename(file, renamed); err != nil {
		t.Fatal(err)
	}
	if ev := waitConformanceEvent(t, events, renamed, Renamed); ev.From != file {
		t.Fatalf("rename reported from %q, want %q", ev.From, file)
	}

	if err := os.Remove(renamed); err != nil {
		t.Fatal(err)
	}
	waitConformanceEvent(t, events, renamed, Removed)

	sub := filepath.Join(root, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	deep := filepath.Join(sub, "deep.txt")
	if err := os.WriteFile(deep, []byte("deep"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitConformanceEvent(t, events, sub, Created)
	waitConformanceEvent(t, events, deep, Created)
}

func TestOpenHonorsExclusions(t *testing.T) {
	root := t.TempDir()
	skip := filepath.Join(root, "skip")
	keep := filepath.Join(root, "keep")
	for _, dir := range []string{skip, keep} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	events, sub := subscribeReal(t, root, []string{skip})

	ignored := filepath.Join(skip, "x.txt")
	if err := os.WriteFile(ignored, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	keepFile := filepath.Join(keep, "z.txt")
	if err := os.WriteFile(keepFile, []byte("z"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitConformanceEvent(t, events, keepFile, Created)
	expectQuiet(t, events, ignored)

	// Re-including a root rebuilds its watch without announcing the files already inside it, so a
	// write that happens afterwards must be reported.
	if err := sub.UpdateExclusions(nil); err != nil {
		t.Fatalf("UpdateExclusions: %v", err)
	}
	reIncluded := filepath.Join(skip, "y.txt")
	if err := os.WriteFile(reIncluded, []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitConformanceEvent(t, events, reIncluded, Created)
}
