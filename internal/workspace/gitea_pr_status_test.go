package workspace

import (
	"os/exec"
	"path/filepath"
	"testing"
)

func giteaTestRepo(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "repo")
	for _, args := range [][]string{
		{"init", "-q", "-b", "main", dir},
		{"-C", dir, "remote", "add", "origin", "https://gitea.example.com/acme/app.git"},
		{"-C", dir, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"},
		{"-C", dir, "checkout", "-q", "-b", "feature"},
	} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	return dir
}

// The open PR for the branch, with checks from the commit statuses and the Actions tasks: the
// status Gitea mirrors from its own job is dropped, the latest run of a workflow wins, and the
// aggregate covers both kinds.
func TestGiteaPRStatus(t *testing.T) {
	stubForge(t, "tea", `#!/bin/sh
case "$*" in
  "pr list --fields "*"--page 1") echo '[{"index":"3","state":"open","url":"https://gitea.example.com/acme/app/pulls/3","title":"Other","head":"someone:feature","base":"main","ci":""},{"index":"7","state":"open","url":"https://gitea.example.com/acme/app/pulls/7","title":"Fix it","head":"feature","base":"main","mergeable":"true","ci":"success"}]' ;;
  "pr 7 -o json") echo '{"index":7,"url":"u","headSha":"abc123"}' ;;
  "api repos/acme/app/commits/abc123/status") echo '{"state":"success","statuses":[{"id":1,"status":"success","context":"ci/external","target_url":"https://ci.example.com/b/1"},{"id":2,"status":"success","context":"CI / test (push)","target_url":"https://gitea.example.com/acme/app/actions/runs/40/jobs/1"}]}' ;;
  "api repos/acme/app/actions/tasks?limit=50&page=1") echo '{"total_count":3,"workflow_runs":[{"id":11,"name":"test","head_sha":"abc123","run_number":4,"status":"success","workflow_id":"ci.yml","url":"https://gitea.example.com/acme/app/actions/runs/39/jobs/1"},{"id":12,"name":"test","head_sha":"abc123","run_number":5,"status":"failure","workflow_id":"ci.yml","url":"https://gitea.example.com/acme/app/actions/runs/40/jobs/1"},{"id":13,"name":"other","head_sha":"zzz","run_number":1,"status":"success","workflow_id":"x.yml","url":"https://gitea.example.com/acme/app/actions/runs/2/jobs/1"}]}' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`)
	repo := giteaTestRepo(t)
	target := ResolvePRLookupTarget(t.Context(), repo)
	if target == nil {
		t.Fatal("no lookup target")
	}
	pr, err := CurrentPRStatus(t.Context(), repo, "gitea", *target)
	if err != nil || pr == nil {
		t.Fatalf("status: %v %v", pr, err)
	}
	if pr["number"] != 7 || pr["state"] != "open" || pr["isMerged"] != false || pr["mergeable"] != "MERGEABLE" || pr["headRefName"] != "feature" || pr["repoOwner"] != "acme" || pr["projectPath"] != "acme/app" {
		t.Fatalf("status: %+v", pr)
	}
	checks, _ := pr["checks"].([]map[string]any)
	if len(checks) != 2 || checks[0]["name"] != "ci/external" || checks[1]["name"] != "test" || checks[1]["status"] != "failure" || checks[1]["workflowRunId"] != int64(12) {
		t.Fatalf("checks: %+v", checks)
	}
	if pr["checksStatus"] != "failure" {
		t.Fatalf("checksStatus %v: the failing Actions run must outweigh the passing combined state", pr["checksStatus"])
	}
	facts, _ := pr["forgeSpecific"].(map[string]any)
	if facts["forge"] != "gitea" || facts["mergeable"] != true || facts["ciStatus"] != "success" {
		t.Fatalf("facts: %+v", facts)
	}
}

// With no open PR, the recently updated ones are searched: a merged PR counts while the checkout is
// still on its head commit.
func TestGiteaPRStatusFindsMergedOnHead(t *testing.T) {
	repo := giteaTestRepo(t)
	head, err := exec.Command("git", "-C", repo, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	sha := string(head[:40])
	stubForge(t, "tea", `#!/bin/sh
case "$*" in
  "pr list --fields "*) echo '[]' ;;
  "api repos/acme/app/pulls?state=all&sort=recentupdate&page=1&limit=50") echo '[{"number":9,"html_url":"https://gitea.example.com/acme/app/pulls/9","title":"Old","state":"closed","merged":true,"head":{"ref":"feature","sha":"`+sha+`","repo":{"owner":{"login":"acme"}}},"base":{"ref":"main","repo":{"owner":{"login":"acme"}}}},{"number":8,"html_url":"https://gitea.example.com/acme/app/pulls/8","title":"Older","state":"closed","merged":true,"head":{"ref":"feature","sha":"not-the-head","repo":{"owner":{"login":"acme"}}},"base":{"ref":"main","repo":{"owner":{"login":"acme"}}}}]' ;;
  "pr 9 -o json") echo '{"index":9,"url":"u"}' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`)
	target := ResolvePRLookupTarget(t.Context(), repo)
	pr, err := CurrentPRStatus(t.Context(), repo, "gitea", *target)
	if err != nil || pr == nil {
		t.Fatalf("status: %v %v", pr, err)
	}
	if pr["number"] != 9 || pr["state"] != "merged" || pr["isMerged"] != true || pr["checksStatus"] != "none" {
		t.Fatalf("status: %+v", pr)
	}
}

// A mirrored status whose run waits for approval reads as pending with the action_required trait.
func TestGiteaChecksApprovalHold(t *testing.T) {
	target := "https://gitea.example.com/acme/app/actions/runs/40/jobs/1"
	checks := giteaChecks([]giteaCommitStatus{{ID: 2, Status: "pending", Context: "CI / test", TargetURL: &target}}, nil, map[int64]bool{40: true})
	if len(checks) != 1 || checks[0]["status"] != "pending" {
		t.Fatalf("checks: %+v", checks)
	}
	if traits, _ := checks[0]["traits"].([]string); len(traits) != 1 || traits[0] != "action_required" {
		t.Fatalf("traits: %v", checks[0]["traits"])
	}
	warning := giteaChecks([]giteaCommitStatus{{ID: 3, Status: "warning", Context: "lint"}}, nil, nil)
	if warning[0]["status"] != "failure" {
		t.Fatalf("a warning status is not passing: %+v", warning)
	}
}
