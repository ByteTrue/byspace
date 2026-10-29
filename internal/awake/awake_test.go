package awake

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWantAndKeepHoldLifecycle(t *testing.T) {
	now := time.Now()
	if want(State{}, now) {
		t.Fatal("idle zero state must not hold sleep")
	}
	if !want(State{Busy: true}, now) {
		t.Fatal("busy state must hold sleep")
	}
	if !want(State{Last: now.Add(-time.Minute)}, now) {
		t.Fatal("within 10m grace window must hold sleep")
	}
	if want(State{Last: now.Add(-Grace - time.Second)}, now) {
		t.Fatal("past grace window must release sleep")
	}

	oldHold, oldTick := hold, tick
	defer func() { hold, tick = oldHold, oldTick }()
	tick = 5 * time.Millisecond

	var held, takes atomic.Int32
	hold = func(bool) (func(), error) {
		held.Add(1)
		takes.Add(1)
		return func() { held.Add(-1) }, nil
	}

	var mu sync.Mutex
	lvl := System
	st := State{}
	set := func(l Level, s State) {
		mu.Lock()
		lvl, st = l, s
		mu.Unlock()
		Notify()
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		Keep(ctx, func() Level {
			mu.Lock()
			defer mu.Unlock()
			return lvl
		}, func() State {
			mu.Lock()
			defer mu.Unlock()
			return st
		})
		close(done)
	}()

	waitHeld := func(want int32, label string) {
		t.Helper()
		deadline := time.Now().Add(2 * time.Second)
		for held.Load() != want {
			if time.Now().After(deadline) {
				t.Fatalf("%s: held=%d, want %d", label, held.Load(), want)
			}
			time.Sleep(2 * time.Millisecond)
		}
	}

	waitHeld(0, "initial idle")
	set(System, State{Busy: true})
	waitHeld(1, "busy")
	set(System, State{Last: time.Now()})
	waitHeld(1, "within grace")
	set(Off, State{Busy: true})
	waitHeld(0, "turned off")
	cancel()
	<-done
}
