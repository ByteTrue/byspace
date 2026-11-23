package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/filewatch"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// pushToOrigin gives a test checkout an upstream, which is the ref the diff stat compares against.
func pushToOrigin(t *testing.T, repo string) string {
	t.Helper()
	origin := t.TempDir()
	gitIn(t, origin, "init", "-q", "--bare")
	gitIn(t, repo, "remote", "add", "origin", origin)
	branch := gitOut(t, repo, "symbolic-ref", "--short", "HEAD")
	gitIn(t, repo, "push", "-q", "-u", "origin", branch)
	return branch
}

func waitForPushedBranch(t *testing.T, sink *recordingSink, workspaceID, branch string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		sink.mu.Lock()
		for _, text := range sink.texts {
			// The descriptor names the branch in more than one place (the record and gitRuntime),
			// and either of them is the client learning about the switch.
			if strings.Contains(text, "\""+branch+"\"") && strings.Contains(text, workspaceID) {
				sink.mu.Unlock()
				return
			}
		}
		sink.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("the workspace with branch %q was not pushed to the client", branch)
}

func fakeObservationServer(t *testing.T) (*Server, *filewatch.Fake) {
	t.Helper()
	srv := newTestServer(t, t.TempDir())
	if srv.observation != nil {
		srv.observation.close()
	}
	fake := filewatch.NewFake()
	srv.observation = newObservationService(fake)
	t.Cleanup(func() { srv.observation.close() })
	return srv, fake
}

func addTestClient(srv *Server) *recordingSink {
	sink := &recordingSink{}
	srv.mu.Lock()
	srv.clients[sink] = true
	srv.mu.Unlock()
	return sink
}

func removeTestClient(srv *Server, sink *recordingSink) {
	srv.mu.Lock()
	delete(srv.clients, sink)
	srv.mu.Unlock()
}

func storedBranch(srv *Server, workspaceID string) string {
	records, err := srv.store.ListWorkspaces()
	if err != nil {
		return ""
	}
	for _, rec := range records {
		if rec.WorkspaceID == workspaceID && rec.Branch != nil {
			return *rec.Branch
		}
	}
	return ""
}

func waitForStoredBranch(t *testing.T, srv *Server, workspaceID, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var got string
	for time.Now().Before(deadline) {
		if got = storedBranch(srv, workspaceID); got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("branch = %q after the terminal change, want %q", got, want)
}

// A branch switched in a terminal reaches the workspace and its clients without a Changes pane
// open, and a checkout nobody is connected to costs no watches.
func TestCheckoutObservationFollowsLiveClients(t *testing.T) {
	repo := t.TempDir()
	gitInit(t, repo)
	srv, fake := fakeObservationServer(t)
	_, ws, err := srv.store.EnsureWorkspaceForCwd(repo)
	if err != nil {
		t.Fatal(err)
	}
	srv.refreshWorkspacePlacementAtCwd(t.Context(), repo)
	observer := newCheckoutObserver(srv)

	observer.reconcile()
	if got := fake.Diagnostics().Subscriptions; got != 0 {
		t.Fatalf("subscriptions = %d with no client connected", got)
	}

	sink := addTestClient(srv)
	observer.reconcile()
	if got := fake.Diagnostics().Subscriptions; got < 2 {
		t.Fatalf("subscriptions = %d, want the working tree and the git directory", got)
	}

	worktreeDir, commonDir, err := workspace.ResolveGitDirs(t.Context(), repo)
	if err != nil {
		t.Fatal(err)
	}
	gitIn(t, repo, "checkout", "-q", "-b", "feature")
	fake.Write(filepath.Join(worktreeDir, "HEAD"))
	fake.Write(filepath.Join(commonDir, "refs", "heads", "feature"))
	waitForStoredBranch(t, srv, ws.WorkspaceID, "feature")

	waitForPushedBranch(t, sink, ws.WorkspaceID, "feature")

	removeTestClient(srv, sink)
	observer.reconcile()
	if got := fake.Diagnostics().Subscriptions; got != 0 {
		t.Fatalf("subscriptions = %d after the last client left", got)
	}
}

// An edit in the working tree is what the diff stat and the dirty state come from; the git
// directory cannot report it.
func TestCheckoutObservationRefreshesTheWorkingDiff(t *testing.T) {
	repo := t.TempDir()
	gitInit(t, repo)
	pushToOrigin(t, repo)
	srv, fake := fakeObservationServer(t)
	if _, _, err := srv.store.EnsureWorkspaceForCwd(repo); err != nil {
		t.Fatal(err)
	}
	srv.refreshWorkspacePlacementAtCwd(t.Context(), repo)
	addTestClient(srv)
	newCheckoutObserver(srv).reconcile()

	file := filepath.Join(repo, "new.txt")
	if err := os.WriteFile(file, []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fake.Create(file)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if stat := srv.checkoutDiffStat(repo); stat != nil && stat.Additions > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("diff stat = %+v after an untracked file was added, want additions", srv.checkoutDiffStat(repo))
}

// A degraded watcher may have dropped events, so the reconciliation tick becomes the checkout's
// only source of change: it re-reads the facts and the open comparison.
func TestDegradedObservationFallsBackToTheCheckoutTick(t *testing.T) {
	repo := t.TempDir()
	gitInit(t, repo)
	writeRepoFile(t, repo, "a.txt", "one\n")
	gitIn(t, repo, "add", ".")
	gitIn(t, repo, "commit", "-m", "one")

	srv, fake := fakeObservationServer(t)
	sink := addTestClient(srv)
	srv.RegisterDiffSubscription("diff_1", sink, repo, map[string]any{"mode": "uncommitted"})
	t.Cleanup(func() { srv.UnregisterDiffSubscription("diff_1") })
	waitForDiffUpdate(t, sink, func(map[string]any) bool { return true })

	if _, _, err := srv.store.EnsureWorkspaceForCwd(repo); err != nil {
		t.Fatal(err)
	}
	observer := newCheckoutObserver(srv)
	observer.reconcile()
	if len(observer.watches) == 0 {
		t.Fatal("no watch was created, the test proves nothing")
	}
	fake.Fail()

	writeRepoFile(t, repo, "a.txt", "one\ntwo\n")
	observer.pollDegraded()

	waitForDiffUpdate(t, sink, func(payload map[string]any) bool {
		return addedLines(payload, "a.txt") == 1
	})
}
