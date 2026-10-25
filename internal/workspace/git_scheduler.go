package workspace

import (
	"context"
	"os"
	"strconv"
	"sync"
	"time"
)

// Git process scheduling, ported from utils/git-process-scheduler.ts.
//
// The daemon polls every subscribed workspace once a second and each poll runs several git
// commands. On a machine with a dozen open workspaces that is dozens of `git` processes starting
// at once, several times a second — enough to make the machine stutter and to make the
// user's own git commands queue behind ours.
//
// Two limits, both configurable:
//
//   - concurrency, so a burst cannot spawn an unbounded number of processes
//   - starts per second, so a steady load cannot keep the CPU pegged forever
const (
	defaultGitMaxConcurrency = 8
	defaultGitMaxPerSecond   = 64
)

var (
	gitSchedulerOnce sync.Once
	gitSlots         chan struct{}
	gitRateMu        sync.Mutex
	gitWindowStart   time.Time
	gitWindowCount   int
	gitMaxPerSecond  int
)

// configureGitScheduler reads the limits from the environment (or the defaults).
func configureGitScheduler() {
	maxConcurrency := positiveEnvInt("BYSPACE_GIT_MAX_PROCESS_CONCURRENCY", defaultGitMaxConcurrency)
	maxPerSecond := positiveEnvInt("BYSPACE_GIT_MAX_PROCESSES_PER_SECOND", defaultGitMaxPerSecond)
	gitSlots = make(chan struct{}, maxConcurrency)
	gitMaxPerSecond = maxPerSecond
	gitWindowStart = time.Now()
}

// acquireGitSlot blocks until a git process may start.
//
// Returns a release function. A cancelled context returns an error rather than waiting, so a
// shutdown does not hang behind a queue of queued git calls.
func acquireGitSlot(ctx context.Context) (func(), error) {
	gitSchedulerOnce.Do(configureGitScheduler)

	// Rate limit first: waiting for a slot and then for the rate window would waste the slot.
	gitRateMu.Lock()
	now := time.Now()
	if now.Sub(gitWindowStart) >= time.Second {
		gitWindowStart = now
		gitWindowCount = 0
	}
	if gitWindowCount >= gitMaxPerSecond {
		wait := time.Second - now.Sub(gitWindowStart)
		gitRateMu.Unlock()
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		gitRateMu.Lock()
		gitWindowStart = time.Now()
		gitWindowCount = 0
	}
	gitWindowCount++
	gitRateMu.Unlock()

	select {
	case gitSlots <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-gitSlots }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// positiveEnvInt parses a positive integer from the environment, or returns fallback.
//
// A malformed value falls back rather than failing: a typo in an optional tuning variable must
// not stop the daemon from serving.
func positiveEnvInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
