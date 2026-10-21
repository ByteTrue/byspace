package workspace

import "testing"

// Git touches its own directory constantly; without this classification every write looks like a user
// file change and the watcher pushes an update for each one.
func TestClassifyGitMetadataPath(t *testing.T) {
	cases := []struct {
		scope GitMetadataScope
		path  string
		kind  string
	}{
		// Lock files are transient by definition, and the suffix rule has to beat the exact one.
		{GitScopeWorktree, "index.lock", "ignore"},
		{GitScopeCommon, "packed-refs.lock", "ignore"},

		// Per-worktree state belongs to this checkout only.
		{GitScopeWorktree, "index", "owner"},
		{GitScopeWorktree, "HEAD", "owner"},
		{GitScopeWorktree, "byspace/worktree.json", "owner"},

		// Branch movement is reported as a ref, with the namespace telling which.
		{GitScopeCommon, "refs/heads/main", "ref"},
		{GitScopeCommon, "refs/remotes/origin/main", "ref"},

		// Repository-wide changes affect every worktree.
		{GitScopeCommon, "packed-refs", "all"},
		{GitScopeCommon, "config", "all"},

		// Plumbing: never a user-visible change.
		{GitScopeCommon, "objects/ab/cdef", "ignore"},
		{GitScopeCommon, "logs/HEAD", "ignore"},
		{GitScopeCommon, "worktrees/foo/HEAD", "ignore"},
	}
	for _, c := range cases {
		got := ClassifyGitMetadataPath(c.scope, c.path)
		if got.Kind != c.kind {
			t.Fatalf("%s %q = %q, want %q", c.scope, c.path, got.Kind, c.kind)
		}
	}
}

// The ref name is what the UI needs; the prefix is table plumbing.
func TestClassifyGitMetadataRefName(t *testing.T) {
	local := ClassifyGitMetadataPath(GitScopeCommon, "refs/heads/feat/login")
	if local.Namespace != "local" || local.Ref != "feat/login" {
		t.Fatalf("local = %+v", local)
	}
	remote := ClassifyGitMetadataPath(GitScopeCommon, "refs/remotes/origin/main")
	if remote.Namespace != "remote" || remote.Ref != "origin/main" {
		t.Fatalf("remote = %+v", remote)
	}
}

// A checkout or reset moves what diffs are measured against; an index write does not.
func TestClassifyRefreshBase(t *testing.T) {
	if !ClassifyGitMetadataPath(GitScopeWorktree, "HEAD").RefreshBase {
		t.Fatal("a HEAD change moves the diff base")
	}
	if ClassifyGitMetadataPath(GitScopeWorktree, "index").RefreshBase {
		t.Fatal("an index write does not move the diff base")
	}
}

// The scope decides: a worktree-scoped path under the common dir is not a worktree rule.
func TestClassifyRespectsScope(t *testing.T) {
	if got := ClassifyGitMetadataPath(GitScopeCommon, "config.worktree"); got.Kind != "ignore" {
		t.Fatalf("config.worktree under common = %q", got.Kind)
	}
}

// Unmatched paths are ignored, not treated as a change: git writes far more than the table names, and
// defaulting to "this is a change" is what produced the noise.
func TestClassifyIgnoresUnknownPaths(t *testing.T) {
	if got := ClassifyGitMetadataPath(GitScopeCommon, "some-new-git-file"); got.Kind != "ignore" {
		t.Fatalf("unknown = %q", got.Kind)
	}
	// A Windows path arrives with backslashes and must still match.
	if got := ClassifyGitMetadataPath(GitScopeCommon, `refs\heads\main`); got.Kind != "ref" {
		t.Fatalf("backslash path = %q", got.Kind)
	}
}

func TestPrunedGitMetadataPaths(t *testing.T) {
	got := PrunedGitMetadataPaths(GitScopeCommon)
	want := map[string]bool{"hooks/": true, "logs/": true, "objects/": true}
	if len(got) != len(want) {
		t.Fatalf("paths = %v", got)
	}
	for _, path := range got {
		if !want[path] {
			t.Fatalf("unexpected prune path %q", path)
		}
	}
}
