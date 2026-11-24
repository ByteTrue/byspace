package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
)

func newWorktreeArchiveTestServer(t *testing.T) *Server {
	t.Helper()
	srv, err := New(Options{HomeDir: filepath.Join(t.TempDir(), "home"), Version: "test", PiCommand: "unused"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

func TestArchiveWorkspacesSucceedsWhenWorktreeRemovalFails(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	path := filepath.Join(srv.worktreesBaseDir(), "repo", "locked")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: path, DisplayName: "w", Kind: "worktree",
		CreatedAt: "2026-01-01T00:00:00Z", WorktreeRoot: &path, IsBySpaceOwnedWorktree: true,
	}); err != nil {
		t.Fatal(err)
	}
	srv.deleteOwnedWorktree = func(_ context.Context, _, _ string, guard func() error) error {
		if err := guard(); err != nil {
			return err
		}
		return errors.New("directory locked")
	}
	srv.waitWorktreeCleanup = func(ctx context.Context, _ time.Duration) error {
		<-ctx.Done()
		return ctx.Err()
	}
	_, outcomes := captureWorktreeCleanups(srv)

	message, cleanupPending, cleanupKey, err := srv.archiveWorkspaces(context.Background(), []string{"ws_1"}, "2026-02-01T00:00:00Z")
	if err != nil {
		t.Fatalf("archiveWorkspaces() error = %v", err)
	}
	if message == nil || !strings.Contains(*message, "directory locked") || !cleanupPending {
		t.Fatalf("archive cleanup message = %v, pending = %v", message, cleanupPending)
	}
	if cleanupKey != worktreeCleanupKey(path) {
		t.Fatalf("cleanup key = %q, want %q", cleanupKey, worktreeCleanupKey(path))
	}
	rec, ok := srv.workspaceRecord("ws_1")
	if !ok || rec.ArchivedAt == nil {
		t.Fatal("workspace was not archived after disk cleanup failed")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("locked worktree disappeared: %v", err)
	}
	srv.worktreeCleanupMu.Lock()
	entry := srv.worktreeCleanups[worktreeCleanupKey(path)]
	srv.worktreeCleanupMu.Unlock()
	if entry == nil {
		t.Fatal("archive did not schedule deferred worktree cleanup")
	}
	srv.bgCancel()
	awaitWorktreeCleanup(t, entry)
	if got := outcomes(); len(got) != 0 {
		t.Fatalf("cancelled archive cleanup emitted outcomes: %+v", got)
	}
}

func TestArchiveWorkspacesDoesNotPromiseDeferredCleanupAfterTeardownFailure(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	path := filepath.Join(srv.worktreesBaseDir(), "repo", "teardown-failed")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "byspace.json"), []byte(`{"worktree":{"teardown":["exit 7"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: path, DisplayName: "w", Kind: "worktree",
		CreatedAt: "2026-01-01T00:00:00Z", WorktreeRoot: &path, IsBySpaceOwnedWorktree: true,
	}); err != nil {
		t.Fatal(err)
	}

	message, cleanupPending, cleanupKey, err := srv.archiveWorkspaces(context.Background(), []string{"ws_1"}, "2026-02-01T00:00:00Z")
	if err != nil {
		t.Fatalf("archiveWorkspaces() error = %v", err)
	}
	if message == nil || !strings.Contains(*message, "teardown command failed") || cleanupPending {
		t.Fatalf("archive cleanup message = %v, pending = %v", message, cleanupPending)
	}
	if cleanupKey != "" {
		t.Fatalf("non-deferred cleanup key = %q, want empty", cleanupKey)
	}
	rec, ok := srv.workspaceRecord("ws_1")
	if !ok || rec.ArchivedAt == nil {
		t.Fatal("workspace was not archived after teardown failure")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("worktree removed after teardown failure: %v", err)
	}
	srv.worktreeCleanupMu.Lock()
	entry := srv.worktreeCleanups[worktreeCleanupKey(path)]
	srv.worktreeCleanupMu.Unlock()
	if entry != nil {
		t.Fatal("teardown failure incorrectly scheduled deferred cleanup")
	}
}

func TestWorktreeCleanupStopsWhenPathIsReclaimed(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	path := filepath.Join(srv.worktreesBaseDir(), "repo", "reclaimed")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "active", Cwd: path, DisplayName: "active", Kind: "worktree",
		CreatedAt: "2026-01-01T00:00:00Z", WorktreeRoot: &path, IsBySpaceOwnedWorktree: true,
	}); err != nil {
		t.Fatal(err)
	}

	err := srv.deleteWorktreeCleanupTarget(context.Background(), worktreeCleanupTarget{workspaceID: "archived", path: path})
	if !errors.Is(err, errWorktreeStillReferenced) {
		t.Fatalf("deleteWorktreeCleanupTarget() error = %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("reclaimed worktree was removed: %v", err)
	}
}

func TestWorktreeCleanupRefusesForeignPath(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	path := filepath.Join(t.TempDir(), "user-checkout")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}

	err := srv.deleteWorktreeCleanupTarget(context.Background(), worktreeCleanupTarget{workspaceID: "archived", path: path})
	if err == nil || !strings.Contains(err.Error(), "outside BySpace management") {
		t.Fatalf("deleteWorktreeCleanupTarget() error = %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("foreign checkout was removed: %v", err)
	}
}

func TestArchiveDoesNotHoldLifecycleLockDuringTeardown(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	path := filepath.Join(srv.worktreesBaseDir(), "repo", "reentrant-teardown")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	started := filepath.Join(t.TempDir(), "started")
	release := filepath.Join(t.TempDir(), "release")
	var command string
	if runtime.GOOS == "windows" {
		command = fmt.Sprintf("Set-Content -LiteralPath '%s' -Value started; while (-not (Test-Path -LiteralPath '%s')) { Start-Sleep -Milliseconds 20 }", started, release)
	} else {
		command = fmt.Sprintf("touch '%s'; while [ ! -f '%s' ]; do sleep 0.02; done", started, release)
	}
	config, err := json.Marshal(map[string]any{"worktree": map[string]any{"teardown": []string{command}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "byspace.json"), config, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertWorkspace(store.WorkspaceRecord{
		WorkspaceID: "ws_1", Cwd: path, DisplayName: "w", Kind: "worktree",
		CreatedAt: "2026-01-01T00:00:00Z", WorktreeRoot: &path, IsBySpaceOwnedWorktree: true,
	}); err != nil {
		t.Fatal(err)
	}
	archiveDone := make(chan error, 1)
	go func() {
		_, _, _, err := srv.archiveWorkspaces(context.Background(), []string{"ws_1"}, "2026-02-01T00:00:00Z")
		archiveDone <- err
	}()
	for deadline := time.Now().Add(5 * time.Second); ; {
		if _, err := os.Stat(started); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("teardown did not start")
		}
		time.Sleep(20 * time.Millisecond)
	}
	lockAcquired := make(chan func(), 1)
	go func() { lockAcquired <- srv.lockWorktreeLifecycle(path) }()
	var unlock func()
	select {
	case unlock = <-lockAcquired:
		unlock()
	case <-time.After(200 * time.Millisecond):
		_ = os.WriteFile(release, []byte("release"), 0o600)
		t.Fatal("archive held the lifecycle lock while teardown was running")
	}
	if err := os.WriteFile(release, []byte("release"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-archiveDone:
		if err != nil {
			t.Fatalf("archiveWorkspaces() error = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("archive did not finish after teardown completed")
	}
}
