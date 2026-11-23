package server

import (
	"context"
	"os/exec"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/workspace/gitmeta"
)

func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

func containsRef(refs []string, want string) bool {
	for _, ref := range refs {
		if ref == want {
			return true
		}
	}
	return false
}

// A ref file rewritten with the same object id is not a change, and re-reading the branch, the
// base and the diff stat for it is the polling behaviour this replaces.
func TestGitRefProbeReportsOnlyMovedObjects(t *testing.T) {
	repo := t.TempDir()
	gitInit(t, repo)
	gitIn(t, repo, "branch", "probe-target")
	probe := newGitRefProbe()
	ctx := context.Background()
	ref := "refs/heads/probe-target"

	first, err := probe.probe(ctx, repo, []string{ref}, false)
	if err != nil {
		t.Fatalf("first probe: %v", err)
	}
	if !containsRef(first, ref) || !containsRef(first, "HEAD") {
		t.Fatalf("first probe moved %v, want the ref and HEAD as a baseline", first)
	}

	again, err := probe.probe(ctx, repo, []string{ref}, false)
	if err != nil {
		t.Fatalf("second probe: %v", err)
	}
	if len(again) != 0 {
		t.Fatalf("unchanged refs reported as moved: %v", again)
	}

	gitIn(t, repo, "commit", "--allow-empty", "-qm", "next")
	gitIn(t, repo, "branch", "-f", "probe-target", "HEAD")
	moved, err := probe.probe(ctx, repo, []string{ref}, false)
	if err != nil {
		t.Fatalf("third probe: %v", err)
	}
	if !containsRef(moved, ref) || !containsRef(moved, "HEAD") {
		t.Fatalf("moved = %v, want both the ref and HEAD after a commit", moved)
	}
}

// A push moves refs/remotes/origin/<branch> without touching HEAD. That was the change the HEAD
// fingerprint missed and the reason a pushed checkout kept showing its old diff stat.
func TestGitRefProbeSeesAPushedUpstream(t *testing.T) {
	origin := t.TempDir()
	gitIn(t, origin, "init", "-q", "--bare")
	repo := t.TempDir()
	gitInit(t, repo)
	gitIn(t, repo, "remote", "add", "origin", origin)
	branch := gitOut(t, repo, "symbolic-ref", "--short", "HEAD")
	gitIn(t, repo, "push", "-q", "-u", "origin", branch)
	ref := "refs/remotes/origin/" + branch

	probe := newGitRefProbe()
	ctx := context.Background()
	if _, err := probe.probe(ctx, repo, []string{ref}, false); err != nil {
		t.Fatalf("baseline probe: %v", err)
	}
	before := gitOut(t, repo, "rev-parse", ref)
	gitIn(t, repo, "commit", "--allow-empty", "-qm", "ahead")
	gitIn(t, repo, "push", "-q", "origin", branch)
	after := gitOut(t, repo, "rev-parse", ref)
	if before == after {
		t.Fatal("the push did not move the remote-tracking ref, the test proves nothing")
	}

	moved, err := probe.probe(ctx, repo, []string{ref}, false)
	if err != nil {
		t.Fatalf("probe after push: %v", err)
	}
	if !containsRef(moved, ref) {
		t.Fatalf("moved = %v, want %s", moved, ref)
	}

	// The point of detecting it: a moved upstream ref refreshes the comparison base, which is how
	// a pushed checkout stops showing its pre-push diff stat.
	if !containsInvalidation(invalidationsFor(gitmeta.Classify(gitmeta.ScopeCommon, ref)), invalidateBase) {
		t.Fatalf("a moved upstream ref must schedule a base refresh")
	}
}
