package gitmeta

import "testing"

// Branch list changes must not look like a working-tree change: re-reading the diff for a
// remote ref update is work the user cannot see.
func TestClassifyRefs(t *testing.T) {
	local := Classify(ScopeCommon, "refs/heads/main")
	if local.Kind != KindRef || local.Namespace != "local" || local.Ref != "main" {
		t.Fatalf("local ref: %+v", local)
	}
	remote := Classify(ScopeCommon, "refs/remotes/origin/main")
	if remote.Kind != KindRef || remote.Namespace != "remote" || remote.Ref != "origin/main" {
		t.Fatalf("remote ref: %+v", remote)
	}
}

// Shared state invalidates every worktree, so the effect differs from per-worktree state.
func TestClassifySharedVersusOwned(t *testing.T) {
	if got := Classify(ScopeCommon, "packed-refs"); got.Kind != KindAll || !got.RefreshBase {
		t.Fatalf("packed-refs: %+v", got)
	}
	if got := Classify(ScopeCommon, "config"); got.Kind != KindAll || !got.RefreshBase {
		t.Fatalf("config: %+v", got)
	}
	if got := Classify(ScopeCommon, "index"); got.Kind != KindOwner || got.RefreshBase {
		t.Fatalf("index: %+v", got)
	}
	if got := Classify(ScopeWorktree, "HEAD"); got.Kind != KindOwner || !got.RefreshBase {
		t.Fatalf("worktree HEAD: %+v", got)
	}
}

// Noise must never trigger a refresh. Object packs churn constantly while the user works.
func TestClassifyIgnore(t *testing.T) {
	for _, path := range []string{
		"objects/pack/pack-abc.pack",
		"logs/HEAD",
		"hooks/pre-commit",
		"worktrees/other/HEAD",
		"index.lock",
		"HEAD.lock",
	} {
		if got := Classify(ScopeCommon, path); got.Kind != KindIgnore {
			t.Fatalf("%s should be ignored, got %+v", path, got)
		}
	}
}

// Scope matters: a per-worktree rule must not fire for a common path with the same name.
func TestClassifyScopeIsolation(t *testing.T) {
	if got := Classify(ScopeCommon, "config.worktree"); got.Kind != KindIgnore {
		t.Fatalf("config.worktree is per-worktree only, got %+v", got)
	}
	if got := Classify(ScopeWorktree, "byspace/worktree.json"); got.Kind != KindOwner || !got.RefreshBase {
		t.Fatalf("byspace metadata: %+v", got)
	}
}

// An unrecognised path is ignored rather than triggering a refresh: git adds internal files
// regularly and an unknown one is far more likely to be bookkeeping.
func TestClassifyUnknownPathIsIgnored(t *testing.T) {
	if got := Classify(ScopeCommon, "some-future-git-file"); got.Kind != KindIgnore {
		t.Fatalf("unknown path: %+v", got)
	}
}

// Windows-style separators appear in watcher events.
func TestClassifyNormalisesSeparators(t *testing.T) {
	if got := Classify(ScopeCommon, `refs\heads\main`); got.Kind != KindRef || got.Ref != "main" {
		t.Fatalf("backslashes: %+v", got)
	}
}

func TestPrunedPaths(t *testing.T) {
	common := PrunedPaths(ScopeCommon)
	if len(common) != 3 {
		t.Fatalf("common prunes: %v", common)
	}
	for _, want := range []string{"hooks", "logs", "objects"} {
		found := false
		for _, got := range common {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing prune %q in %v", want, common)
		}
	}
	// Worktree scope has no prune rules.
	if got := PrunedPaths(ScopeWorktree); len(got) != 0 {
		t.Fatalf("worktree prunes: %v", got)
	}
}
