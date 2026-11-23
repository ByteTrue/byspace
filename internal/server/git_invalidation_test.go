package server

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/filewatch"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
	"github.com/ByteTrue/byspace/internal/workspace/gitmeta"
)

// The shared directory serves every worktree of a repository, but index and HEAD there belong to
// the main checkout. A linked worktree must not re-read the main checkout's staged state, while a
// ref or config change concerns all of them.
func TestGitObservationRoutesOwnerChangesToTheOwner(t *testing.T) {
	repo := t.TempDir()
	gitInit(t, repo)
	linked := filepath.Join(t.TempDir(), "linked")
	gitIn(t, repo, "worktree", "add", "-q", "-b", "feature", linked)

	fake := filewatch.NewFake()
	service := newObservationService(fake)
	defer service.close()
	main, other := &eventLog{}, &eventLog{}

	releaseMain, err := service.watchGit(repo, main.meta)
	if err != nil {
		t.Fatalf("watchGit(main): %v", err)
	}
	releaseOther, err := service.watchGit(linked, other.meta)
	if err != nil {
		t.Fatalf("watchGit(linked): %v", err)
	}
	mainWorktree, mainCommon, err := workspace.ResolveGitDirs(context.Background(), repo)
	if err != nil {
		t.Fatalf("ResolveGitDirs(main): %v", err)
	}
	// One shared directory plus the linked worktree's own administrative directory.
	if got := fake.Diagnostics().Subscriptions; got != 2 {
		t.Fatalf("subscriptions = %d, want 2", got)
	}

	fake.Write(filepath.Join(mainWorktree, "index"))
	if events, _ := main.snapshot(); len(events) != 1 {
		t.Fatalf("main checkout saw %v, want its index change", events)
	}
	if events, _ := other.snapshot(); len(events) != 0 {
		t.Fatalf("linked worktree saw %v, want nothing from the main checkout's index", events)
	}

	fake.Write(filepath.Join(mainCommon, "config"))
	fake.Write(filepath.Join(mainCommon, "refs", "heads", "feature"))
	if _, effects := main.snapshot(); len(effects) != 3 {
		t.Fatalf("main checkout effects = %+v, want index, config and the ref", effects)
	}
	_, effects := other.snapshot()
	if len(effects) != 2 || effects[0].Kind != gitmeta.KindAll || effects[1].Kind != gitmeta.KindRef {
		t.Fatalf("linked worktree effects = %+v, want config and the ref", effects)
	}

	releaseMain()
	releaseOther()
	if got := fake.Diagnostics().Subscriptions; got != 0 {
		t.Fatalf("subscriptions = %d after release, want 0", got)
	}
}

// An object pack is the noisiest thing git writes and nothing in the UI reads it. A branch ref is
// the opposite: the checkout's branch is the fact the sidebar leads with. One must schedule no
// work, the other a refresh that writes the new branch to the record.
func TestGitObservationRefreshesOnBranchRefChange(t *testing.T) {
	srv, err := New(Options{HomeDir: filepath.Join(t.TempDir(), "home"), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	fake := filewatch.NewFake()
	srv.observation.close()
	srv.observation = newObservationService(fake)
	t.Cleanup(func() { srv.observation.close() })

	repo := t.TempDir()
	gitInit(t, repo)
	record := store.WorkspaceRecord{
		WorkspaceID: "wks_1", ProjectID: "p", Cwd: repo, Kind: "local_checkout",
		DisplayName: "d", CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := srv.store.UpsertWorkspace(record); err != nil {
		t.Fatal(err)
	}
	branch := func() string {
		records, err := srv.store.ListWorkspaces()
		if err != nil {
			t.Fatal(err)
		}
		for _, rec := range records {
			if rec.WorkspaceID == "wks_1" && rec.Branch != nil {
				return *rec.Branch
			}
		}
		return ""
	}

	if _, err = srv.observation.watchGit(repo, func(effect gitmeta.Effect, event filewatch.Event) {
		srv.handleGitChange(repo, effect, event)
	}); err != nil {
		t.Fatalf("watchGit: %v", err)
	}
	if got := branch(); got != "" {
		t.Fatalf("branch = %q before any event, want the unresolved record", got)
	}

	worktreeDir, commonDir, err := workspace.ResolveGitDirs(context.Background(), repo)
	if err != nil {
		t.Fatal(err)
	}
	fake.Write(filepath.Join(commonDir, "objects", "pack", "pack-1.pack"))
	time.Sleep(2 * gitInvalidationDebounce)
	if got := branch(); got != "" {
		t.Fatalf("branch = %q after a pack write, want no refresh", got)
	}

	gitIn(t, repo, "checkout", "-q", "-b", "topic")
	fake.Write(filepath.Join(worktreeDir, "HEAD"))
	fake.Write(filepath.Join(commonDir, "refs", "heads", "topic"))

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && branch() != "topic" {
		time.Sleep(20 * time.Millisecond)
	}
	if got := branch(); got != "topic" {
		t.Fatalf("branch = %q after the ref change, want topic", got)
	}

	// A rewrite naming the same commit is the common case: git touches a ref file for a pack, a
	// lock dance, or a fetch that found nothing. None of that may re-read the checkout.
	records, err := srv.store.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	for _, rec := range records {
		if rec.WorkspaceID != "wks_1" {
			continue
		}
		sentinel := "sentinel"
		rec.Branch = &sentinel
		if err := srv.store.UpsertWorkspace(rec); err != nil {
			t.Fatal(err)
		}
	}
	fake.Write(filepath.Join(worktreeDir, "HEAD"))
	fake.Write(filepath.Join(commonDir, "refs", "heads", "topic"))
	time.Sleep(3 * gitInvalidationDebounce)
	if got := branch(); got != "sentinel" {
		t.Fatalf("branch = %q after an unchanged ref rewrite, want the record untouched", got)
	}
}

// design D6: a classified change re-reads only the facts it can have invalidated, and the refs it
// names are the ones whose object ids decide whether the change is real.
func TestGitMetadataInvalidatesTheFactsItCanChange(t *testing.T) {
	cases := []struct {
		name  string
		scope gitmeta.Scope
		path  string
		kinds []gitInvalidation
		refs  []string
		all   bool
	}{
		{"branch ref", gitmeta.ScopeCommon, "refs/heads/main", []gitInvalidation{invalidateBranch}, []string{"refs/heads/main"}, false},
		{"remote ref", gitmeta.ScopeCommon, "refs/remotes/origin/main", []gitInvalidation{invalidateUpstream, invalidateBase}, []string{"refs/remotes/origin/main"}, false},
		{"head", gitmeta.ScopeCommon, "HEAD", []gitInvalidation{invalidateBranch, invalidateBase}, nil, true},
		{"packed refs", gitmeta.ScopeCommon, "packed-refs", []gitInvalidation{invalidateBranch, invalidateBase}, nil, true},
		{"config", gitmeta.ScopeCommon, "config", []gitInvalidation{invalidateBranch, invalidateBase}, nil, true},
		{"worktree index", gitmeta.ScopeWorktree, "index", []gitInvalidation{invalidateWorking}, nil, false},
		{"worktree admin", gitmeta.ScopeWorktree, "byspace/worktree.json", []gitInvalidation{invalidateBranch, invalidateBase}, nil, true},
		{"object pack", gitmeta.ScopeCommon, "objects/pack/x.pack", nil, nil, false},
		{"lock file", gitmeta.ScopeCommon, "index.lock", nil, nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			effect := gitmeta.Classify(tc.scope, tc.path)
			if got := invalidationsFor(effect); !sameInvalidations(got, tc.kinds) {
				t.Fatalf("invalidationsFor(%s) = %v, want %v", tc.path, got, tc.kinds)
			}
			refs, all := observedRefs(effect)
			if all != tc.all || len(refs) != len(tc.refs) {
				t.Fatalf("observedRefs(%s) = %v, %v; want %v, %v", tc.path, refs, all, tc.refs, tc.all)
			}
			for index := range refs {
				if refs[index] != tc.refs[index] {
					t.Fatalf("observedRefs(%s) = %v, want %v", tc.path, refs, tc.refs)
				}
			}
		})
	}
}

func sameInvalidations(left, right []gitInvalidation) bool {
	if len(left) != len(right) {
		return false
	}
	count := map[gitInvalidation]int{}
	for _, kind := range left {
		count[kind]++
	}
	for _, kind := range right {
		count[kind]--
	}
	for _, remaining := range count {
		if remaining != 0 {
			return false
		}
	}
	return true
}

func containsInvalidation(kinds []gitInvalidation, want gitInvalidation) bool {
	for _, kind := range kinds {
		if kind == want {
			return true
		}
	}
	return false
}
