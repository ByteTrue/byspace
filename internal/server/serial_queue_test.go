package server

import (
	"sync"
	"testing"
)

// The skills queue has to keep arrival order, not just mutual exclusion: two saves that arrive in
// one order must be applied in that order, so the last request the client sent is the selection
// left on disk.
func TestSerialQueueAppliesJobsInArrivalOrder(t *testing.T) {
	queue := newSerialQueue()
	queue.start()

	var mu sync.Mutex
	var order []int
	var running int
	var concurrent bool

	var wg sync.WaitGroup
	for index := 0; index < 50; index++ {
		wg.Add(1)
		queue.enqueue(func() {
			defer wg.Done()
			mu.Lock()
			running++
			if running > 1 {
				concurrent = true
			}
			mu.Unlock()

			mu.Lock()
			order = append(order, index)
			mu.Unlock()

			mu.Lock()
			running--
			mu.Unlock()
		})
	}
	wg.Wait()

	if concurrent {
		t.Fatal("two jobs ran at the same time")
	}
	if len(order) != 50 {
		t.Fatalf("ran %d jobs, want 50", len(order))
	}
	for index, got := range order {
		if got != index {
			t.Fatalf("job %d ran at position %d; arrival order was not kept", got, index)
		}
	}
}

// A nil queue means the server was built by hand (tests, one-off callers). Running the job inline
// keeps those callers working instead of panicking.
func TestSerialQueueNilRunsInline(t *testing.T) {
	var queue *serialQueue
	ran := false
	queue.enqueue(func() { ran = true })
	if !ran {
		t.Fatal("a nil queue must run the job inline")
	}
}
