package filewatch

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// manualClock makes the polling schedule deterministic: the loop asks for an interval and the test
// decides when it elapses.
type manualClock struct {
	mu      sync.Mutex
	asked   []time.Duration
	waiting []chan time.Time
}

func (c *manualClock) After(d time.Duration) <-chan time.Time {
	ch := make(chan time.Time, 1)
	c.mu.Lock()
	c.asked = append(c.asked, d)
	c.waiting = append(c.waiting, ch)
	c.mu.Unlock()
	return ch
}

// waitUntilWaiting blocks until the loop is waiting for a timer, which also means any work it did
// before asking (a baseline snapshot, a poll) is finished.
func (c *manualClock) waitUntilWaiting(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		c.mu.Lock()
		waiting := len(c.waiting)
		c.mu.Unlock()
		if waiting > 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the polling loop never asked for a timer")
		}
		time.Sleep(time.Millisecond)
	}
}

func (c *manualClock) tick() {
	c.mu.Lock()
	waiting := c.waiting
	c.waiting = nil
	c.mu.Unlock()
	for _, ch := range waiting {
		ch <- time.Now()
	}
}

func (c *manualClock) intervals() []time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]time.Duration(nil), c.asked...)
}

func polledStream() (func(Event), chan Event) {
	events := make(chan Event, 64)
	return func(ev Event) { events <- ev }, events
}

type want struct {
	path string
	kind Kind
}

// awaitEvents waits for every expected event in any order. A poll reports map entries in random
// order, so matching one event at a time would drop the others.
func awaitEvents(t *testing.T, events <-chan Event, wants ...want) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	remaining := append([]want(nil), wants...)
	var seen []Event
	for len(remaining) > 0 {
		select {
		case ev := <-events:
			seen = append(seen, ev)
			for i, w := range remaining {
				if ev.Path == w.path && ev.Kind == w.kind {
					remaining = append(remaining[:i], remaining[i+1:]...)
					break
				}
			}
		case <-deadline:
			t.Fatalf("missing events %v, saw %v", remaining, seen)
		}
	}
}

func TestDegradedSubscriptionPollsWithBackoff(t *testing.T) {
	root := t.TempDir()
	watched := filepath.Join(root, "a.txt")
	if err := os.WriteFile(watched, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	skipped := filepath.Join(root, "node_modules")
	if err := os.Mkdir(skipped, 0o755); err != nil {
		t.Fatal(err)
	}

	backend := NewFake() // never subscribes: every attempt fails, so the subscription stays degraded
	backend.RefuseSubscribe(true)
	clock := &manualClock{}
	obs := newPolledObservation(backend, clock)
	t.Cleanup(func() { _ = obs.Close() })

	handler, events := polledStream()
	sub, err := obs.Subscribe(root, Options{Excluded: []string{skipped}}, handler)
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	t.Cleanup(sub.Release)

	retimed := filepath.Join(root, "b.txt")
	if err := os.WriteFile(watched, []byte("second"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(retimed, []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	noise := filepath.Join(skipped, "x.js")
	if err := os.WriteFile(noise, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	clock.waitUntilWaiting(t)
	clock.tick()
	awaitEvents(t, events, want{watched, Written}, want{retimed, Created})

	if err := os.Remove(retimed); err != nil {
		t.Fatal(err)
	}
	clock.waitUntilWaiting(t)
	clock.tick()
	awaitEvents(t, events, want{retimed, Removed})

	clock.waitUntilWaiting(t)
	clock.tick()
	clock.waitUntilWaiting(t)
	clock.tick()

	intervals := clock.intervals()
	want := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second, 40 * time.Second}
	if len(intervals) < len(want) {
		t.Fatalf("polling asked for %v, want at least %v", intervals, want)
	}
	for i, expected := range want {
		if intervals[i] != expected {
			t.Fatalf("poll %d waited %s, want %s (schedule %v)", i+1, intervals[i], expected, intervals)
		}
	}
	if got := obs.Diagnostics().Degraded; got != 1 {
		t.Fatalf("Diagnostics reported %d degraded subscriptions, want 1", got)
	}
}

func TestDegradedSubscriptionRecovers(t *testing.T) {
	root := t.TempDir()
	watched := filepath.Join(root, "a.txt")
	if err := os.WriteFile(watched, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}

	backend := NewFake()
	clock := &manualClock{}
	obs := newPolledObservation(backend, clock)
	t.Cleanup(func() { _ = obs.Close() })

	handler, events := polledStream()
	sub, err := obs.Subscribe(root, Options{}, handler)
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	t.Cleanup(sub.Release)

	backend.Fail()
	backend.RefuseSubscribe(true)
	select {
	case <-sub.Degraded():
	case <-time.After(5 * time.Second):
		t.Fatal("the subscription never reported degradation")
	}

	if err := os.WriteFile(watched, []byte("second"), 0o644); err != nil {
		t.Fatal(err)
	}
	clock.waitUntilWaiting(t)
	clock.tick()
	awaitEvents(t, events, want{watched, Written})

	backend.RefuseSubscribe(false)
	clock.waitUntilWaiting(t)
	clock.tick()
	deadline := time.Now().Add(5 * time.Second)
	for obs.Diagnostics().Degraded != 0 {
		if time.Now().After(deadline) {
			t.Fatal("the subscription never returned to events")
		}
		time.Sleep(time.Millisecond)
	}

	// Native delivery is back: an event from the backend reaches the handler without a poll.
	fromBackend := filepath.Join(root, "c.txt")
	if err := os.WriteFile(fromBackend, []byte("c"), 0o644); err != nil {
		t.Fatal(err)
	}
	backend.Create(fromBackend)
	awaitEvents(t, events, want{fromBackend, Created})
}
