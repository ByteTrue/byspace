package server

import (
	"os/exec"
	"strings"
	"testing"
)

// A branch switched and a commit made outside the app reach the workspace and its clients on the
// next poll, without a Changes pane open.
func TestHeadWatchFollowsBranchSwitches(t *testing.T) {
	repo := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-c", "user.email=a@b", "-c", "user.name=a"}, args...)...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	git("init", "-q", "-b", "main")
	git("commit", "-q", "--allow-empty", "-m", "one")

	srv := newTestServer(t, t.TempDir())
	_, ws, err := srv.store.EnsureWorkspaceForCwd(repo)
	if err != nil {
		t.Fatal(err)
	}
	branchOf := func() string {
		t.Helper()
		records, err := srv.store.ListWorkspaces()
		if err != nil {
			t.Fatal(err)
		}
		for _, rec := range records {
			if rec.WorkspaceID == ws.WorkspaceID && rec.Branch != nil {
				return *rec.Branch
			}
		}
		return ""
	}
	srv.refreshWorkspacePlacementAtCwd(t.Context(), repo)
	watch := &headWatch{fingerprints: map[string]string{}}

	// No client: nothing is read.
	srv.runHeadWatchTick(watch)
	if len(watch.fingerprints) != 0 {
		t.Fatal("checkouts were polled with no client connected")
	}

	sink := &recordingSink{}
	srv.mu.Lock()
	srv.clients[sink] = true
	srv.mu.Unlock()
	srv.runHeadWatchTick(watch)
	if branchOf() != "main" {
		t.Fatalf("branch = %q before the switch", branchOf())
	}

	git("checkout", "-q", "-b", "feature")
	srv.runHeadWatchTick(watch)
	if got := branchOf(); got != "feature" {
		t.Fatalf("branch = %q after switching in a terminal", got)
	}
	sink.mu.Lock()
	pushed := false
	for _, text := range sink.texts {
		if strings.Contains(text, `"feature"`) && strings.Contains(text, ws.WorkspaceID) {
			pushed = true
		}
	}
	sink.mu.Unlock()
	if !pushed {
		t.Fatal("the workspace with its new branch was not pushed to the client")
	}

	// A reading that did not move runs nothing.
	if moved := srv.movedHeads(watch); len(moved) != 0 {
		t.Fatalf("moved without a change: %v", moved)
	}
	git("commit", "-q", "--allow-empty", "-m", "two")
	if moved := srv.movedHeads(watch); len(moved) != 1 {
		t.Fatalf("a commit moved %v", moved)
	}
}
