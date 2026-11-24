package server

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
)

type capturedWorktreeCleanup struct {
	Type        string
	WorkspaceID string
	Path        string
	Status      string
	Error       string
}

func captureWorktreeCleanups(srv *Server) (*recordingSink, func() []capturedWorktreeCleanup) {
	sink := &recordingSink{}
	srv.mu.Lock()
	srv.clients[sink] = true
	srv.mu.Unlock()
	return sink, func() []capturedWorktreeCleanup {
		sink.mu.Lock()
		defer sink.mu.Unlock()
		var outcomes []capturedWorktreeCleanup
		for _, raw := range sink.texts {
			var envelope struct {
				Type    string
				Message struct {
					Type    string
					Payload capturedWorktreeCleanup
				}
			}
			if json.Unmarshal([]byte(raw), &envelope) == nil && envelope.Type == "session" && envelope.Message.Type == "workspace.worktree.cleanup" {
				outcomes = append(outcomes, envelope.Message.Payload)
			}
		}
		return outcomes
	}
}

func awaitWorktreeCleanup(t *testing.T, entry *worktreeCleanup) {
	t.Helper()
	select {
	case <-entry.done:
	case <-time.After(2 * time.Second):
		t.Fatal("deferred worktree cleanup did not finish")
	}
}

func TestDeferredWorktreeCleanupDeduplicatesAndEventuallySucceeds(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	_, outcomes := captureWorktreeCleanups(srv)
	path := filepath.Join(srv.worktreesBaseDir(), "repo", "eventual")
	target := worktreeCleanupTarget{workspaceID: "ws_1", path: path}
	var calls atomic.Int32
	srv.deleteOwnedWorktree = func(context.Context, string, string, func() error) error {
		if calls.Add(1) < 3 {
			return errors.New("still locked")
		}
		return nil
	}
	delays := make(chan time.Duration, len(deferredWorktreeCleanupDelays))
	release := make(chan struct{})
	srv.waitWorktreeCleanup = func(ctx context.Context, delay time.Duration) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		delays <- delay
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
			return nil
		}
	}

	first := srv.scheduleWorktreeCleanup(target)
	duplicate := srv.scheduleWorktreeCleanup(target)
	if first != duplicate {
		t.Fatal("duplicate path started a second cleanup sequence")
	}
	close(release)
	awaitWorktreeCleanup(t, first)
	if got := calls.Load(); got != 3 {
		t.Fatalf("deletion attempts = %d, want 3", got)
	}
	close(delays)
	var gotDelays []time.Duration
	for delay := range delays {
		gotDelays = append(gotDelays, delay)
	}
	wantDelays := deferredWorktreeCleanupDelays[:3]
	if len(gotDelays) != len(wantDelays) {
		t.Fatalf("delays = %v, want %v", gotDelays, wantDelays)
	}
	for i := range wantDelays {
		if gotDelays[i] != wantDelays[i] {
			t.Fatalf("delays = %v, want %v", gotDelays, wantDelays)
		}
	}
	got := outcomes()
	if len(got) != 1 || got[0].Status != "succeeded" || got[0].WorkspaceID != "ws_1" || got[0].Path != path || got[0].Error != "" {
		t.Fatalf("cleanup outcomes = %+v", got)
	}
}

func TestDeferredWorktreeCleanupReportsExhaustion(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	_, outcomes := captureWorktreeCleanups(srv)
	path := filepath.Join(srv.worktreesBaseDir(), "repo", "exhausted")
	srv.deleteOwnedWorktree = func(context.Context, string, string, func() error) error {
		return errors.New("still locked")
	}
	srv.waitWorktreeCleanup = func(context.Context, time.Duration) error { return nil }

	entry := srv.scheduleWorktreeCleanup(worktreeCleanupTarget{workspaceID: "ws_1", path: path})
	awaitWorktreeCleanup(t, entry)
	got := outcomes()
	if len(got) != 1 || got[0].Status != "failed" || got[0].Path != path || got[0].Error != "still locked" {
		t.Fatalf("cleanup outcomes = %+v", got)
	}
}

func TestDeferredWorktreeCleanupCancelsWhenReclaimed(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	_, outcomes := captureWorktreeCleanups(srv)
	path := filepath.Join(srv.worktreesBaseDir(), "repo", "reclaimed")
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "active", Cwd: path, WorktreeRoot: &path, DisplayName: "active",
	}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	srv.deleteOwnedWorktree = func(_ context.Context, _, _ string, guard func() error) error {
		calls.Add(1)
		return guard()
	}
	srv.waitWorktreeCleanup = func(context.Context, time.Duration) error { return nil }

	entry := srv.scheduleWorktreeCleanup(worktreeCleanupTarget{workspaceID: "archived", path: path})
	awaitWorktreeCleanup(t, entry)
	if calls.Load() != 1 {
		t.Fatalf("deletion attempts = %d, want 1", calls.Load())
	}
	got := outcomes()
	if len(got) != 1 || got[0].Status != "cancelled" || got[0].Path != path || got[0].Error != "" {
		t.Fatalf("reclaimed path outcomes = %+v", got)
	}
}

func TestDeferredWorktreeCleanupStopsOnDaemonCancellation(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	_, outcomes := captureWorktreeCleanups(srv)
	var calls atomic.Int32
	srv.deleteOwnedWorktree = func(context.Context, string, string, func() error) error {
		calls.Add(1)
		return nil
	}
	srv.waitWorktreeCleanup = func(ctx context.Context, _ time.Duration) error {
		<-ctx.Done()
		return ctx.Err()
	}
	entry := srv.scheduleWorktreeCleanup(worktreeCleanupTarget{workspaceID: "ws_1", path: filepath.Join(srv.worktreesBaseDir(), "repo", "cancelled")})
	srv.bgCancel()
	awaitWorktreeCleanup(t, entry)
	if calls.Load() != 0 || len(outcomes()) != 0 {
		t.Fatalf("daemon cancellation ran deletion or emitted an outcome")
	}
}
