package workspace

import "testing"

// The daemon needs to tell "the fetch worked and nothing moved" from "an agent pruned a
// branch", which decides whether the branch picker has to refresh.
func TestDiffRefs(t *testing.T) {
	before := map[string]string{
		"refs/remotes/origin/main": "aaa",
		"refs/remotes/origin/old":  "bbb",
		"refs/heads/feature":       "ccc",
		"refs/tags/v1":             "ddd",
	}
	after := map[string]string{
		"refs/remotes/origin/main": "zzz", // moved
		"refs/remotes/origin/new":  "eee", // added
		"refs/heads/feature":       "ccc", // unchanged
		"refs/tags/v1":             "ddd",
	}

	changes, nonRemote := DiffRefs(before, after)
	if nonRemote {
		t.Fatal("no non-remote ref changed")
	}
	if len(changes) != 3 {
		t.Fatalf("changes = %+v", changes)
	}
	byRef := map[string]GitRefChange{}
	for _, c := range changes {
		byRef[c.Ref] = c
	}
	if c := byRef["origin/main"]; c.Kind != "moved" || c.BeforeOID != "aaa" || c.AfterOID != "zzz" {
		t.Fatalf("moved: %+v", c)
	}
	if c := byRef["origin/new"]; c.Kind != "added" || c.AfterOID != "eee" {
		t.Fatalf("added: %+v", c)
	}
	if c := byRef["origin/old"]; c.Kind != "deleted" || c.BeforeOID != "bbb" {
		t.Fatalf("deleted: %+v", c)
	}
}

// A local branch or tag moving is a different event and must not be reported as a remote change.
func TestDiffRefsReportsNonRemoteChange(t *testing.T) {
	before := map[string]string{"refs/heads/main": "aaa"}
	after := map[string]string{"refs/heads/main": "zzz"}
	changes, nonRemote := DiffRefs(before, after)
	if len(changes) != 0 {
		t.Fatalf("local refs must not appear as remote changes: %+v", changes)
	}
	if !nonRemote {
		t.Fatal("a moved local branch must be reported")
	}
}

// Identical snapshots mean a quiet fetch, which is the common case.
func TestDiffRefsNoChanges(t *testing.T) {
	refs := map[string]string{"refs/remotes/origin/main": "aaa"}
	changes, nonRemote := DiffRefs(refs, refs)
	if len(changes) != 0 || nonRemote {
		t.Fatalf("changes=%+v nonRemote=%v", changes, nonRemote)
	}
}
