package server

import "sync"

// serialQueue runs jobs one at a time in the order they were enqueued.
//
// The skills commands need both properties: they must not interleave (each one plans from a
// snapshot of the skills on disk and then copies and deletes to match it), and they must apply in
// arrival order (two concurrent saves must leave the selection the client sent last). A mutex
// gives the first property only: whichever goroutine reaches the lock first wins, so the earlier
// selection could end up on disk. Node gets both by chaining every command onto one promise queue,
// which is what this reproduces without blocking the socket's read loop.
type serialQueue struct {
	mu      sync.Mutex
	cond    *sync.Cond
	pending []func()
	started bool
}

func newSerialQueue() *serialQueue {
	queue := &serialQueue{}
	queue.cond = sync.NewCond(&queue.mu)
	return queue
}

// start launches the worker. Call it once.
func (q *serialQueue) start() {
	q.mu.Lock()
	if q.started {
		q.mu.Unlock()
		return
	}
	q.started = true
	q.mu.Unlock()
	go q.run()
}

func (q *serialQueue) enqueue(job func()) {
	if q == nil {
		job()
		return
	}
	q.mu.Lock()
	q.pending = append(q.pending, job)
	q.mu.Unlock()
	q.cond.Signal()
}

func (q *serialQueue) run() {
	for {
		q.mu.Lock()
		for len(q.pending) == 0 {
			q.cond.Wait()
		}
		job := q.pending[0]
		q.pending = q.pending[1:]
		q.mu.Unlock()
		job()
	}
}
