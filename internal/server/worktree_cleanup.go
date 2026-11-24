package server

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var deferredWorktreeCleanupDelays = []time.Duration{
	5 * time.Second,
	15 * time.Second,
	30 * time.Second,
	time.Minute,
	2 * time.Minute,
	5 * time.Minute,
}

type worktreeCleanup struct {
	done chan struct{}
}

func worktreeCleanupKey(path string) string {
	key := filepath.Clean(path)
	// Resolve the nearest existing ancestor, then reattach the missing suffix. Resolving only the
	// complete path gives a new worktree different keys before and after creation under a symlinked parent.
	current := key
	var missing []string
	for {
		if resolved, err := filepath.EvalSymlinks(current); err == nil {
			key = resolved
			for i := len(missing) - 1; i >= 0; i-- {
				key = filepath.Join(key, missing[i])
			}
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		key = strings.ToLower(key)
	}
	return filepath.Clean(key)
}

// scheduleWorktreeCleanup starts one daemon-lifetime cleanup per path. The returned entry is the
// pending one on duplicate calls, which also lets focused tests await the terminal outcome.
func (s *Server) scheduleWorktreeCleanup(target worktreeCleanupTarget) *worktreeCleanup {
	key := worktreeCleanupKey(target.path)
	s.worktreeCleanupMu.Lock()
	if existing := s.worktreeCleanups[key]; existing != nil {
		s.worktreeCleanupMu.Unlock()
		return existing
	}
	entry := &worktreeCleanup{done: make(chan struct{})}
	if s.worktreeCleanups == nil {
		s.worktreeCleanups = make(map[string]*worktreeCleanup)
	}
	s.worktreeCleanups[key] = entry
	s.worktreeCleanupMu.Unlock()

	ctx := s.bgCtx
	if ctx == nil {
		ctx = context.Background()
	}
	go s.runWorktreeCleanup(ctx, key, target, entry)
	return entry
}

func (s *Server) runWorktreeCleanup(ctx context.Context, key string, target worktreeCleanupTarget, entry *worktreeCleanup) {
	defer func() {
		s.worktreeCleanupMu.Lock()
		if s.worktreeCleanups[key] == entry {
			delete(s.worktreeCleanups, key)
		}
		s.worktreeCleanupMu.Unlock()
		close(entry.done)
	}()

	var lastErr error
	for _, delay := range deferredWorktreeCleanupDelays {
		if err := s.waitForWorktreeCleanup(ctx, delay); err != nil {
			return
		}
		err := s.withWorktreeLifecycle(target.path, func() error {
			return s.deleteWorktreeCleanupTarget(ctx, target)
		})
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			s.broadcastWorktreeCleanup(target, "succeeded", nil)
			return
		}
		if errors.Is(err, errWorktreeStillReferenced) {
			s.broadcastWorktreeCleanup(target, "cancelled", nil)
			return
		}
		lastErr = err
	}
	s.broadcastWorktreeCleanup(target, "failed", lastErr)
}

func (s *Server) waitForWorktreeCleanup(ctx context.Context, delay time.Duration) error {
	if s.waitWorktreeCleanup != nil {
		return s.waitWorktreeCleanup(ctx, delay)
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Server) broadcastWorktreeCleanup(target worktreeCleanupTarget, status string, cleanupErr error) {
	payload := map[string]any{
		"workspaceId": target.workspaceID,
		"path":        target.path,
		"cleanupKey":  worktreeCleanupKey(target.path),
		"status":      status,
	}
	if cleanupErr != nil {
		payload["error"] = cleanupErr.Error()
	}
	s.broadcastSessionMsg("workspace.worktree.cleanup", payload)
}
