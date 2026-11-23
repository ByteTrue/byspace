package server

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// The differential check the plan asks for, adapted to slice 1 as it now stands: the 2 s HEAD poll
// is gone (task 3.4), and the 1 s diff poll only runs while a diff subscription is open. No
// subscription is open here, so every fact below has to arrive through file observation. After each
// scripted git operation the daemon's cached branch, dirty state, ahead/behind and diff stat must
// equal a read taken straight from the checkout.
func TestCheckoutFactsFollowGitWithoutPolling(t *testing.T) {
	repo, origin, branch := seedDifferentialRepo(t)
	srv := newTestServer(t, filepath.Join(t.TempDir(), "home"))
	if srv.observation == nil {
		t.Skip("no file observation backend on this platform")
	}
	if _, _, err := srv.store.EnsureWorkspaceForCwd(repo); err != nil {
		t.Fatal(err)
	}
	addTestClient(srv)
	observer := newCheckoutObserver(srv)
	observer.reconcile()
	defer observer.releaseAll()
	srv.refreshCheckoutDiffStat(context.Background(), repo)
	srv.broadcastCheckoutStatusIfChanged(context.Background(), repo)
	waitForFacts(t, srv, repo, "baseline")

	scenarios := []struct {
		name  string
		apply func(t *testing.T)
	}{
		{"edit", func(t *testing.T) { writeRepoFile(t, repo, "tracked.txt", "edited\n") }},
		{"stage", func(t *testing.T) { gitIn(t, repo, "add", "tracked.txt") }},
		{"commit", func(t *testing.T) {
			gitIn(t, repo, "commit", "-q", "-m", "differential commit")
		}},
		{"push", func(t *testing.T) { gitIn(t, repo, "push", "-q", "origin", branch) }},
		{"pull", func(t *testing.T) {
			other := filepath.Join(t.TempDir(), "other")
			gitIn(t, origin, "clone", "-q", origin, other, "--branch", branch)
			gitIn(t, other, "config", "user.email", "other@example.com")
			gitIn(t, other, "config", "user.name", "Other")
			writeRepoFile(t, other, "pulled.txt", "from the other clone\n")
			gitIn(t, other, "add", "pulled.txt")
			gitIn(t, other, "commit", "-q", "-m", "landed elsewhere")
			gitIn(t, other, "push", "-q", "origin", branch)
			gitIn(t, repo, "pull", "-q", "origin", branch)
		}},
		{"branch switch", func(t *testing.T) {
			gitIn(t, repo, "checkout", "-q", "-b", "switched")
			gitIn(t, repo, "checkout", "-q", branch)
		}},
		{"rebase", func(t *testing.T) {
			gitIn(t, repo, "checkout", "-q", "-b", "rebased")
			writeRepoFile(t, repo, "rebased.txt", "one\n")
			gitIn(t, repo, "add", "rebased.txt")
			gitIn(t, repo, "commit", "-q", "-m", "to be rebased")
			other := filepath.Join(t.TempDir(), "rebaser")
			gitIn(t, origin, "clone", "-q", origin, other, "--branch", branch)
			gitIn(t, other, "config", "user.email", "other@example.com")
			gitIn(t, other, "config", "user.name", "Other")
			writeRepoFile(t, other, "base.txt", "moved base\n")
			gitIn(t, other, "add", "base.txt")
			gitIn(t, other, "commit", "-q", "-m", "base moved")
			gitIn(t, other, "push", "-q", "origin", branch)
			gitIn(t, repo, "fetch", "-q", "origin")
			gitIn(t, repo, "rebase", "-q", "origin/"+branch)
		}},
		{"branch -f", func(t *testing.T) { gitIn(t, repo, "branch", "-f", "side", "HEAD~1") }},
		{"stash", func(t *testing.T) {
			writeRepoFile(t, repo, "rebased.txt", "changed after rebase\n")
			gitIn(t, repo, "add", "rebased.txt")
			gitIn(t, repo, "stash", "-q")
		}},
		{"attribute change", func(t *testing.T) {
			writeRepoFile(t, repo, ".gitattributes", "*.txt binary\n")
			writeRepoFile(t, repo, "tracked.txt", "text after the attribute change\n")
		}},
	}
	for _, scenario := range scenarios {
		scenario.apply(t)
		waitForFacts(t, srv, repo, scenario.name)
	}
}

// waitForFacts polls the daemon's cached facts against a fresh read of the checkout. A poll here is
// the test waiting for an event to travel, not the daemon polling the disk.
func waitForFacts(t *testing.T, srv *Server, cwd, after string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	var cachedRuntime, freshRuntime map[string]any
	var cachedStat, freshStat *workspace.CheckoutDiffStat
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		freshRuntime = buildGitRuntime(workspace.GetCheckoutStatus(ctx, cwd, ""))
		freshStat = workspace.GetCheckoutDiffStat(ctx, cwd)
		cancel()
		cachedRuntime = srv.checkoutGitRuntime(cwd)
		cachedStat = srv.checkoutDiffStat(cwd)
		if reflect.DeepEqual(cachedRuntime, freshRuntime) && reflect.DeepEqual(cachedStat, freshStat) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("after %q the cached facts never caught up\n  cached status: %+v\n  fresh status:  %+v\n  cached stat:   %+v\n  fresh stat:    %+v",
				after, cachedRuntime, freshRuntime, cachedStat, freshStat)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// seedDifferentialRepo builds a repository whose branch tracks a real upstream, because the diff
// stat needs a comparison ref and the ahead/behind counts need an upstream.
func seedDifferentialRepo(t *testing.T) (repo, origin, branch string) {
	t.Helper()
	repo = t.TempDir()
	origin = filepath.Join(t.TempDir(), "origin.git")
	gitOut(t, filepath.Dir(origin), "init", "-q", "--bare", origin)
	gitInit(t, repo)
	writeRepoFile(t, repo, "tracked.txt", "original\n")
	gitIn(t, repo, "add", "tracked.txt")
	gitIn(t, repo, "commit", "-q", "-m", "seed")
	branch = gitOut(t, repo, "rev-parse", "--abbrev-ref", "HEAD")
	gitIn(t, repo, "remote", "add", "origin", origin)
	gitIn(t, repo, "push", "-q", "-u", "origin", branch)
	return repo, origin, branch
}

func writeRepoFile(t *testing.T, repo, name, content string) {
	t.Helper()
	path := filepath.Join(repo, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}
