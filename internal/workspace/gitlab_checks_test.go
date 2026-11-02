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

// The MR is the one for the checkout's branch, described the way Node did: an open MR's state is
// "open", its checks are the pipeline's jobs with GitLab's own aggregate, and its approvals and
// merge signals travel as the GitLab facts the merge controls read.
func TestGitLabPRStatus(t *testing.T) {
	stubForge(t, "glab", `#!/bin/sh
case "$*" in
  "mr list --all --source-branch main"*) echo '[{"iid":6,"title":"Old","web_url":"u6","state":"merged","source_branch":"main","target_branch":"dev","sha":"old"},{"iid":7,"title":"x","web_url":"u7","state":"opened","source_branch":"main","target_branch":"dev"}]' ;;
  "mr view 7 -F json") echo '{"iid":7,"title":"Draft: wip","web_url":"https://gitlab.com/acme/repo/-/merge_requests/7","state":"opened","source_branch":"main","target_branch":"dev","draft":true,"detailed_merge_status":"not_approved","has_conflicts":false,"references":{"full":"acme/repo!7"},"head_pipeline":{"id":11,"status":"running","web_url":"https://gl/p/11"}}' ;;
  "api projects/acme%2Frepo/merge_requests/7/approvals") echo '{"approved_by":[{"user":{"username":"a"}}],"approvals_required":2,"approvals_left":1}' ;;
  "ci get --merge-request 7 --with-job-details -F json") echo '{"id":11,"status":"failed","jobs":[{"id":3,"name":"deploy","stage":"deploy","status":"manual","allow_failure":false},{"id":1,"name":"lint","stage":"test","status":"failed","allow_failure":true,"web_url":"https://gl/j/1"},{"id":2,"name":"unit","stage":"test","status":"failed"}]}' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`)
	pr, err := GetPRStatus(t.Context(), gitlabRepo(t))
	if err != nil || pr == nil {
		t.Fatalf("status: %v %v", pr, err)
	}
	if pr["number"] != 7 || pr["state"] != "open" || pr["isMerged"] != false || pr["isDraft"] != true || pr["repoOwner"] != "acme" || pr["repoName"] != "repo" || pr["projectPath"] != "acme/repo" {
		t.Fatalf("status: %+v", pr)
	}
	if pr["mergeable"] != "UNKNOWN" || pr["checksStatus"] != "failure" {
		t.Fatalf("mergeable %v checksStatus %v", pr["mergeable"], pr["checksStatus"])
	}
	checks, _ := pr["checks"].([]map[string]any)
	if len(checks) != 3 || checks[0]["name"] != "lint" || checks[0]["status"] != "success" || checks[2]["name"] != "deploy" || checks[2]["status"] != "pending" {
		t.Fatalf("checks: %+v", checks)
	}
	if traits, _ := checks[2]["traits"].([]string); len(traits) != 2 || traits[1] != "action_required" {
		t.Fatalf("manual job traits: %v", checks[2]["traits"])
	}
	facts, _ := pr["forgeSpecific"].(map[string]any)
	if facts["forge"] != "gitlab" || facts["approvalsGiven"] != 1 || facts["approvalsRequired"] != 2 || facts["detailedMergeStatus"] != "not_approved" || facts["pipelineId"] != int64(11) {
		t.Fatalf("facts: %+v", facts)
	}
}

// A merged or closed MR describes the checkout only while it is still on the MR's head commit.
func TestGitLabPRStatusIgnoresOldMergeRequests(t *testing.T) {
	stubForge(t, "glab", `#!/bin/sh
case "$*" in
  "mr list"*) echo '[{"iid":6,"title":"Old","web_url":"u6","state":"merged","source_branch":"main","target_branch":"dev","sha":"not-the-head"}]' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`)
	pr, err := GetPRStatus(t.Context(), gitlabRepo(t))
	if err != nil || pr != nil {
		t.Fatalf("status: %v %v", pr, err)
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
