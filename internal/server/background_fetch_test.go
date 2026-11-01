package server

import (
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// The background fetch runs once per repository, not per workspace and not per archived project:
// worktrees share the repository's refs, and a fetch against every worktree of the same repo is the
// same network round trip paid N times.
func TestBackgroundGitFetchTargetsArePerRepository(t *testing.T) {
	srv, err := New(Options{HomeDir: filepath.Join(t.TempDir(), "home"), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	upsert := func(prj store.ProjectRecord) {
		t.Helper()
		if err := srv.store.UpsertProject(prj); err != nil {
			t.Fatalf("upsert %s: %v", prj.ProjectID, err)
		}
	}
	archived := "2026-10-31T00:00:00.000Z"
	upsert(store.ProjectRecord{ProjectID: "p1", RootPath: "/repos/one", Kind: "git"})
	upsert(store.ProjectRecord{ProjectID: "p1b", RootPath: "/repos/one", Kind: "git"})
	upsert(store.ProjectRecord{ProjectID: "p2", RootPath: "/repos/two", Kind: "git"})
	upsert(store.ProjectRecord{ProjectID: "p3", RootPath: "/texts/three", Kind: "non_git"})
	upsert(store.ProjectRecord{ProjectID: "p4", RootPath: "/repos/gone", Kind: "git", ArchivedAt: &archived})

	targets := srv.backgroundGitFetchTargets()
	seen := make(map[string]int)
	for _, target := range targets {
		seen[target]++
	}
	if len(targets) != 2 || seen["/repos/one"] != 1 || seen["/repos/two"] != 1 {
		t.Fatalf("targets = %v, want respositories /repos/one and /repos/two deduped", targets)
	}
}

// Node's cadence, and the reason it is that number: a fetch per pane open costs a network round
// trip per open, and no fetch leaves the branch list describing a stale remote.
func TestBackgroundGitFetchUsesNodeInterval(t *testing.T) {
	if backgroundGitFetchInterval.Seconds() != 180 {
		t.Fatalf("interval = %v, want 180s (BACKGROUND_GIT_FETCH_INTERVAL_MS)", backgroundGitFetchInterval)
	}
}
