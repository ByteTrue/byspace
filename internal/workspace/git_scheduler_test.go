package workspace

import (
	"context"
	"sync"
	"testing"
	"time"
)

// The daemon polls every subscribed workspace once a second and each poll runs several git
// commands; without a bound that is dozens of processes starting at once.
func TestGitSchedulerBoundsConcurrency(t *testing.T) {
	t.Setenv("BYSPACE_GIT_MAX_PROCESS_CONCURRENCY", "3")
	t.Setenv("BYSPACE_GIT_MAX_PROCESSES_PER_SECOND", "1000")
	gitSchedulerOnce = sync.Once{}
	configureGitScheduler()

	var mu sync.Mutex
	var live, peak int
	var wg sync.WaitGroup

	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release, err := acquireGitSlot(context.Background())
			if err != nil {
				t.Error(err)
				return
			}
			mu.Lock()
			live++
			if live > peak {
				peak = live
			}
			mu.Unlock()

			time.Sleep(20 * time.Millisecond)

			mu.Lock()
			live--
			mu.Unlock()
			release()
		}()
	}
	wg.Wait()

	if peak > 3 {
		t.Fatalf("concurrency reached %d, limit was 3", peak)
	}
	if peak == 0 {
		t.Fatal("nothing ran")
	}
}

// The rate limit must actually pace starts, or a steady load keeps the CPU pegged.
func TestGitSchedulerRateLimits(t *testing.T) {
	t.Setenv("BYSPACE_GIT_MAX_PROCESS_CONCURRENCY", "8")
	t.Setenv("BYSPACE_GIT_MAX_PROCESSES_PER_SECOND", "4")
	gitSchedulerOnce = sync.Once{}
	configureGitScheduler()

	start := time.Now()
	for i := 0; i < 8; i++ {
		release, err := acquireGitSlot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		release()
	}
	elapsed := time.Since(start)
	// Eight starts at four per second needs at least one window boundary.
	if elapsed < 900*time.Millisecond {
		t.Fatalf("eight starts at 4/s took %v; the rate limit did not apply", elapsed)
	}
}

// A queued call must not keep a shutdown waiting.
func TestGitSchedulerRespectsContext(t *testing.T) {
	t.Setenv("BYSPACE_GIT_MAX_PROCESS_CONCURRENCY", "1")
	t.Setenv("BYSPACE_GIT_MAX_PROCESSES_PER_SECOND", "1000")
	gitSchedulerOnce = sync.Once{}
	configureGitScheduler()

	release, err := acquireGitSlot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := acquireGitSlot(ctx); err == nil {
		t.Fatal("a queued acquire must give up when the context is done")
	}
}

// A malformed tuning variable must not stop the daemon from serving.
func TestPositiveEnvIntFallsBack(t *testing.T) {
	t.Setenv("X_TEST_INT", "not-a-number")
	if got := positiveEnvInt("X_TEST_INT", 7); got != 7 {
		t.Fatalf("got %d", got)
	}
	t.Setenv("X_TEST_INT", "0")
	if got := positiveEnvInt("X_TEST_INT", 7); got != 7 {
		t.Fatalf("zero must fall back, got %d", got)
	}
	t.Setenv("X_TEST_INT", "12")
	if got := positiveEnvInt("X_TEST_INT", 7); got != 12 {
		t.Fatalf("got %d", got)
	}
}
