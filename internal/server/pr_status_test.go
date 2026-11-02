package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// A connected client sees each workspace's PR on its descriptor, kept fresh by the background poll
// and pushed when it changes; with no client connected nothing is polled.
func TestWorkspaceDescriptorCarriesPRStatus(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script as glab")
	}
	bin := t.TempDir()
	state := filepath.Join(bin, "state")
	if err := os.WriteFile(state, []byte("opened"), 0o600); err != nil {
		t.Fatal(err)
	}
	repo := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"remote", "add", "origin", "https://gitlab.com/acme/app.git"},
		{"-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"},
		{"checkout", "-q", "-b", "feature"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	head, err := exec.Command("git", "-C", repo, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	// glab answers with the MR for the branch, in the state the state file names.
	mr := `{\"iid\":7,\"title\":\"Fix the build\",\"web_url\":\"https://gitlab.com/acme/app/-/merge_requests/7\",\"state\":\"$(cat '` + state + `')\",\"source_branch\":\"feature\",\"target_branch\":\"main\",\"sha\":\"` + strings.TrimSpace(string(head)) + `\",\"references\":{\"full\":\"acme/app!7\"}}`
	script := `#!/bin/sh
case "$1 $2" in
  "mr list") echo "[` + mr + `]" ;;
  "mr view") echo "` + mr + `" ;;
  *) exit 1 ;;
esac
`
	if err := os.WriteFile(filepath.Join(bin, "glab"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	srv := newTestServer(t, t.TempDir())
	prj, ws, err := srv.store.EnsureWorkspaceForCwd(repo)
	if err != nil {
		t.Fatal(err)
	}
	srv.syncPRStatusTargets(t.Context())
	if runtime, _ := srv.prStatusRuntime(repo); runtime != nil {
		t.Fatal("a checkout was polled with no client connected")
	}

	sink := &recordingSink{}
	srv.mu.Lock()
	srv.clients[sink] = true
	srv.mu.Unlock()
	srv.notePRStatusClientsChanged()

	waitFor := func(what string, done func() bool) {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for !done() {
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s", what)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	waitFor("the first poll", func() bool { rt, _ := srv.prStatusRuntime(repo); return rt != nil })

	descriptor := srv.workspaceDescriptor(ws, prj)
	githubRuntime, _ := descriptor["githubRuntime"].(map[string]any)
	pr, _ := githubRuntime["pullRequest"].(map[string]any)
	if githubRuntime["featuresEnabled"] != true || pr["number"] != 7 || pr["state"] != "open" || pr["isMerged"] != false || descriptor["forge"] != "gitlab" {
		t.Fatalf("descriptor github runtime = %v, forge %v", githubRuntime, descriptor["forge"])
	}
	waitFor("the workspace push", func() bool {
		sink.mu.Lock()
		defer sink.mu.Unlock()
		for _, text := range sink.texts {
			if strings.Contains(text, "merge_requests/7") {
				return true
			}
		}
		return false
	})

	// A merge from the app polls at once instead of waiting for the next slot.
	if err := os.WriteFile(state, []byte("merged"), 0o600); err != nil {
		t.Fatal(err)
	}
	srv.notePRStatusCheckoutChanged(repo)
	waitFor("the merged state", func() bool {
		rt, _ := srv.prStatusRuntime(repo)
		pr, _ := rt["pullRequest"].(map[string]any)
		return pr["isMerged"] == true
	})

	srv.mu.Lock()
	delete(srv.clients, sink)
	srv.mu.Unlock()
	srv.notePRStatusClientsChanged()
	waitFor("polling to stop", func() bool { rt, _ := srv.prStatusRuntime(repo); return rt == nil })
}

// A PR worktree records which PR it is, so its PR is found again: the PR's base branch, and the
// head owner's login for a fork's PR.
func TestPRWorktreeRecordsItsChangeRequest(t *testing.T) {
	repo := t.TempDir()
	for _, args := range [][]string{{"init", "-q", "-b", "main"}, {"-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	srv := &Server{}
	for _, tc := range []struct {
		cross bool
		owner string
	}{{true, "contributor"}, {false, ""}} {
		srv.writeCreatedWorktreeMetadata(repo, workspace.WorktreeIntent{
			Kind: workspace.IntentCheckoutChangeRequest, ChangeRequestNumber: 42, HeadRef: "fix-typo",
			BaseRefName: "trunk", IsCrossRepository: tc.cross, HeadRepository: "contributor/app",
		}, "fix-typo")
		meta := workspace.ReadWorktreeMetadata(repo)
		if meta == nil || meta.BaseRefName != "trunk" || meta.ChangeRequestLookupTarget == nil {
			t.Fatalf("metadata = %+v", meta)
		}
		hint := *meta.ChangeRequestLookupTarget
		if hint.HeadRef != "fix-typo" || hint.HeadRepositoryOwner != tc.owner || hint.ChangeRequestNumber != 42 || hint.LocalBranchName != "fix-typo" {
			t.Fatalf("cross %v: hint = %+v", tc.cross, hint)
		}
	}
}
