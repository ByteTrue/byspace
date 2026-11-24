package server

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func TestDeferredWorktreeCleanupWaitsForCreationRegistration(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	_, outcomes := captureWorktreeCleanups(srv)
	repo := t.TempDir()
	gitInit(t, repo)
	targetPath, _, err := workspace.WorktreePath(context.Background(), repo, srv.worktreesBaseDir(), "creation-race")
	if err != nil {
		t.Fatal(err)
	}
	created := make(chan struct{})
	releaseRegistration := make(chan struct{})
	srv.beforeWorktreeWorkspaceRegister = func(path string) {
		if path == targetPath {
			close(created)
			<-releaseRegistration
		}
	}
	type creationResult struct {
		workspace store.WorkspaceRecord
		err       error
	}
	creationDone := make(chan creationResult, 1)
	go func() {
		ws, _, err := srv.createWorktreeWorkspace(context.Background(), repo, nil, workspace.WorktreeIntentInput{WorktreeSlug: "creation-race"}, nil)
		creationDone <- creationResult{workspace: ws, err: err}
	}()
	select {
	case <-created:
	case <-time.After(5 * time.Second):
		t.Fatal("worktree creation did not reach registration")
	}

	deleteCalled := make(chan struct{}, 1)
	srv.deleteOwnedWorktree = func(_ context.Context, _, _ string, guard func() error) error {
		deleteCalled <- struct{}{}
		return guard()
	}
	cleanupWaiting := make(chan struct{})
	srv.waitWorktreeCleanup = func(context.Context, time.Duration) error {
		close(cleanupWaiting)
		return nil
	}
	entry := srv.scheduleWorktreeCleanup(worktreeCleanupTarget{workspaceID: "archived", path: targetPath})
	select {
	case <-cleanupWaiting:
	case <-time.After(2 * time.Second):
		t.Fatal("deferred cleanup did not start")
	}
	select {
	case <-deleteCalled:
		t.Fatal("cleanup entered deletion while creation was waiting to register")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseRegistration)
	creation := <-creationDone
	if creation.err != nil {
		t.Fatalf("createWorktreeWorkspace() error = %v", creation.err)
	}
	awaitWorktreeCleanup(t, entry)
	got := outcomes()
	if len(got) != 1 || got[0].Status != "cancelled" {
		t.Fatalf("cleanup outcomes = %+v", got)
	}
	if rec, ok := srv.workspaceRecord(creation.workspace.WorkspaceID); !ok || rec.ArchivedAt != nil {
		t.Fatal("created workspace is not active after cleanup")
	}
	if _, err := os.Stat(targetPath); err != nil {
		t.Fatalf("created worktree is missing: %v", err)
	}
}

func TestDeferredWorktreeCleanupWaitsForNestedWorkspaceActivation(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	_, outcomes := captureWorktreeCleanups(srv)
	targetPath := filepath.Join(srv.worktreesBaseDir(), "repo", "nested-race")
	nestedPath := filepath.Join(targetPath, "subdir")
	if err := os.MkdirAll(nestedPath, 0o755); err != nil {
		t.Fatal(err)
	}
	activating := make(chan struct{})
	releaseRegistration := make(chan struct{})
	srv.beforeWorktreeWorkspaceRegister = func(path string) {
		if path == nestedPath {
			close(activating)
			<-releaseRegistration
		}
	}
	activationDone := make(chan error, 1)
	go func() {
		_, _, err := srv.ensureWorkspaceForCwd(nestedPath)
		activationDone <- err
	}()
	select {
	case <-activating:
	case <-time.After(5 * time.Second):
		t.Fatal("nested workspace did not reach registration")
	}

	deleteCalled := make(chan struct{}, 1)
	srv.deleteOwnedWorktree = func(_ context.Context, _, _ string, guard func() error) error {
		deleteCalled <- struct{}{}
		return guard()
	}
	cleanupWaiting := make(chan struct{})
	srv.waitWorktreeCleanup = func(context.Context, time.Duration) error {
		close(cleanupWaiting)
		return nil
	}
	entry := srv.scheduleWorktreeCleanup(worktreeCleanupTarget{workspaceID: "archived", path: targetPath})
	select {
	case <-cleanupWaiting:
	case <-time.After(2 * time.Second):
		t.Fatal("deferred cleanup did not start")
	}
	select {
	case <-deleteCalled:
		t.Fatal("cleanup entered deletion while nested activation held the root lock")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseRegistration)
	if err := <-activationDone; err != nil {
		t.Fatalf("ensureWorkspaceForCwd() error = %v", err)
	}
	awaitWorktreeCleanup(t, entry)
	got := outcomes()
	if len(got) != 1 || got[0].Status != "cancelled" {
		t.Fatalf("cleanup outcomes = %+v", got)
	}
	if _, err := os.Stat(targetPath); err != nil {
		t.Fatalf("nested workspace worktree is missing: %v", err)
	}
}

func TestWorktreeCleanupKeyStableAcrossCreation(t *testing.T) {
	root := t.TempDir()
	link := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(root, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	path := filepath.Join(link, "repo", "new-worktree")
	before := worktreeCleanupKey(path)
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if after := worktreeCleanupKey(path); after != before {
		t.Fatalf("key changed across creation: before %q, after %q", before, after)
	}
}

func TestCreateAgentStructuredWorktreeWinsOverSimpleName(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	repo := t.TempDir()
	gitInit(t, repo)
	raw := []byte(`{"requestId":"combined-worktree","initialPrompt":"work","worktreeName":"simple-target","worktree":{"mode":"branch-off","newBranch":"structured-target"},"config":{"provider":"pi","cwd":` + strconv.Quote(repo) + `}}`)
	srv.handleCreateAgent(t.Context(), &recordingSink{}, raw)
	agents, err := srv.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != 1 {
		t.Fatalf("agents = %d, want 1", len(agents))
	}
	expected, _, err := workspace.WorktreePath(context.Background(), repo, srv.worktreesBaseDir(), "structured-target")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(agents[0].Cwd) != filepath.Clean(expected) {
		t.Fatalf("agent cwd = %q, want structured worktree %q", agents[0].Cwd, expected)
	}
	simple, _, err := workspace.WorktreePath(context.Background(), repo, srv.worktreesBaseDir(), "simple-target")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(simple); !os.IsNotExist(err) {
		t.Fatalf("simple worktree was also created at %q", simple)
	}
}

func TestCreateWorktreeReactivatesManagedSourceBeforeCreation(t *testing.T) {
	srv := newWorktreeArchiveTestServer(t)
	repo := t.TempDir()
	gitInit(t, repo)
	sourcePath, _, err := workspace.CreateWorktree(context.Background(), repo, srv.worktreesBaseDir(), "managed-source", "")
	if err != nil {
		t.Fatal(err)
	}
	_, source, err := srv.store.EnsureWorkspaceForCwd(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	archivedAt := "2026-01-01T00:00:00Z"
	source.ArchivedAt = &archivedAt
	source.Kind = "worktree"
	source.WorktreeRoot = &sourcePath
	source.IsBySpaceOwnedWorktree = true
	if err := srv.store.UpsertWorkspace(source); err != nil {
		t.Fatal(err)
	}
	if _, _, err := srv.createWorktreeWorkspace(context.Background(), sourcePath, nil, workspace.WorktreeIntentInput{WorktreeSlug: "created-from-source"}, nil); err != nil {
		t.Fatalf("createWorktreeWorkspace() error = %v", err)
	}
	source, ok := srv.workspaceRecord(source.WorkspaceID)
	if !ok || source.ArchivedAt != nil {
		t.Fatalf("managed source was not reactivated: %+v", source)
	}
}
