package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func stubForge(t *testing.T, name, script string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// A blocked MR must not look ready: reporting an empty check list and zero approvals offers a
// merge button the forge then rejects.
func TestGitLabPRStatusIncludesPipelineAndApprovals(t *testing.T) {
	stubForge(t, "glab", `#!/bin/sh
case "$*" in
  *pipelines*) echo '[{"id":11,"status":"failed","web_url":"https://gl/p/11"}]' ;;
  *approvals*) echo '{"approved_by":[{"user":{"username":"a"}}],"approvals_required":2,"approvals_left":1}' ;;
  *) echo '{"iid":7,"title":"Draft: wip","web_url":"https://gl/mr/7","state":"opened","source_branch":"feat","target_branch":"main"}' ;;
esac
`)
	pr, err := GetPRStatus(t.Context(), gitlabRepo(t))
	if err != nil || pr == nil {
		t.Fatalf("status: %v %v", pr, err)
	}
	if pr["isMerged"] != false || pr["state"] != "opened" {
		t.Fatalf("state: %+v", pr)
	}
	if pr["isDraft"] != true {
		t.Fatalf("draft flag not read from the title prefix: %v", pr["isDraft"])
	}
	checks, _ := pr["checks"].([]map[string]any)
	if len(checks) != 1 || checks[0]["status"] != "failure" {
		t.Fatalf("checks: %+v", pr["checks"])
	}
	if pr["approvals"] != 1 || pr["approvalsRequired"] != 2 {
		t.Fatalf("approvals: %v/%v", pr["approvals"], pr["approvalsRequired"])
	}
	if pr["mergeable"] != "BLOCKED" {
		t.Fatalf("an MR short of its approvals must be blocked, got %v", pr["mergeable"])
	}
}

// A forge that does not expose approvals must not make every MR look blocked.
func TestGitLabPRStatusWithoutApprovalRequirement(t *testing.T) {
	stubForge(t, "glab", `#!/bin/sh
case "$*" in
  *pipelines*) echo '[]' ;;
  *approvals*) echo '{"approved_by":[],"approvals_required":0,"approvals_left":0}' ;;
  *) echo '{"iid":8,"title":"Ready","web_url":"u","state":"opened"}' ;;
esac
`)
	pr, err := GetPRStatus(t.Context(), gitlabRepo(t))
	if err != nil || pr == nil {
		t.Fatal(err)
	}
	if pr["approvalsRequired"] != 0 {
		t.Fatalf("required: %v", pr["approvalsRequired"])
	}
	if pr["mergeable"] == "BLOCKED" {
		t.Fatal("no approval requirement must not report blocked")
	}
}

// The protocol's status is a closed enum; the client rejects the whole message on an out-of-enum
// string, so a new GitLab state must not blank the panel.
func TestGitLabCheckStatusIsClosedEnum(t *testing.T) {
	allowed := map[string]bool{"success": true, "failure": true, "pending": true, "skipped": true, "cancelled": true}
	for _, status := range []string{
		"success", "failed", "canceled", "cancelled", "skipped",
		"running", "pending", "created", "waiting_for_resource", "preparing", "manual", "something-new", "",
	} {
		got := gitLabCheckStatus(status)
		if !allowed[got] {
			t.Fatalf("gitLabCheckStatus(%q) = %q, not in the protocol enum", status, got)
		}
	}
}

func TestIsGitLabDraft(t *testing.T) {
	cases := []struct {
		data map[string]any
		want bool
	}{
		{map[string]any{"draft": true}, true},
		{map[string]any{"work_in_progress": true}, true},
		{map[string]any{"title": "Draft: x"}, true},
		{map[string]any{"title": "[Draft] x"}, true},
		{map[string]any{"title": "WIP: x"}, true},
		{map[string]any{"title": "ready"}, false},
	}
	for _, tc := range cases {
		if got := isGitLabDraft(tc.data); got != tc.want {
			t.Fatalf("isGitLabDraft(%v) = %v", tc.data, got)
		}
	}
}

// gitlabRepo builds a real repository whose origin is a GitLab remote, so DetectForge picks
// glab. A hand-written .git/config is not enough: `git remote get-url` refuses to read it.
func gitlabRepo(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"remote", "add", "origin", "https://gitlab.com/acme/repo.git"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	return dir
}
