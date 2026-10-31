package workspace

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// A `gh pr view --json ...,statusCheckRollup` payload maps to the protocol's PR status the way
// Node's toCurrentPullRequestStatus did. isMerged is required by the protocol: without it the
// client rejects the whole checkout_pr_status_response.
func TestGitHubPRStatusFromView(t *testing.T) {
	raw := `{
		"number": 16,
		"url": "https://github.com/ByteTrue/byspace/pull/16",
		"title": "fix: thing",
		"state": "MERGED",
		"isDraft": false,
		"baseRefName": "main",
		"headRefName": "fix/thing",
		"mergedAt": "2026-10-03T05:43:09Z",
		"reviewDecision": "CHANGES_REQUESTED",
		"mergeable": "SOMETHING_NEW",
		"statusCheckRollup": [
			{"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE",
			 "detailsUrl": "https://ci/1", "workflowName": "CI",
			 "startedAt": "2026-10-03T05:00:00Z", "completedAt": "2026-10-03T05:01:05Z"},
			{"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "SUCCESS",
			 "detailsUrl": "https://ci/2", "workflowName": "CI",
			 "startedAt": "2026-10-03T06:00:00Z", "completedAt": "2026-10-03T07:02:03Z"},
			{"__typename": "CheckRun", "name": "lint", "status": "IN_PROGRESS", "conclusion": "",
			 "detailsUrl": "", "workflowName": "", "startedAt": "2026-10-03T08:00:00Z", "completedAt": "0001-01-01T00:00:00Z"},
			{"__typename": "StatusContext", "context": "deploy", "state": "ERROR", "targetUrl": "https://deploy"},
			{"__typename": "Unknown", "name": "ignored"}
		]
	}`
	var item gitHubPRViewItem
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 3, 8, 0, 30, 0, time.UTC)
	status := gitHubPRStatus(item, now)

	if status["isMerged"] != true || status["state"] != "merged" {
		t.Fatalf("merged: isMerged=%v state=%v", status["isMerged"], status["state"])
	}
	if status["mergeable"] != "UNKNOWN" {
		t.Fatalf("an unknown mergeable value must fall back to UNKNOWN, got %v", status["mergeable"])
	}
	if status["reviewDecision"] != "changes_requested" {
		t.Fatalf("reviewDecision = %v", status["reviewDecision"])
	}
	if status["repoOwner"] != "ByteTrue" || status["repoName"] != "byspace" {
		t.Fatalf("repo = %v/%v", status["repoOwner"], status["repoName"])
	}
	want := []map[string]any{
		// The later run of "test" replaces the earlier one, in the earlier one's place.
		{"name": "test", "status": "success", "url": "https://ci/2", "workflow": "CI", "duration": "1h 2m 3s"},
		// A running check measures to now and has no URL.
		{"name": "lint", "status": "pending", "url": nil, "duration": "30s"},
		{"name": "deploy", "status": "failure", "url": "https://deploy"},
	}
	if got := status["checks"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("checks:\n got %#v\nwant %#v", got, want)
	}
	if status["checksStatus"] != "failure" {
		t.Fatalf("checksStatus = %v", status["checksStatus"])
	}
}

func TestGitHubPRStatusOpenWithoutChecks(t *testing.T) {
	item := gitHubPRViewItem{
		Number: 3, URL: "https://ghe.example.com/team/app/pull/3", Title: "t", State: "OPEN",
		Mergeable: "CONFLICTING", ReviewDecision: "",
	}
	status := gitHubPRStatus(item, time.Now())
	if status["isMerged"] != false || status["state"] != "open" || status["mergeable"] != "CONFLICTING" {
		t.Fatalf("open PR: %#v", status)
	}
	if status["checksStatus"] != "none" || status["reviewDecision"] != nil {
		t.Fatalf("no checks or review: %#v", status)
	}
	if status["repoOwner"] != "team" || status["repoName"] != "app" {
		t.Fatalf("enterprise repo = %v/%v", status["repoOwner"], status["repoName"])
	}
	if gitHubPRStatus(gitHubPRViewItem{Number: 1, URL: "", Title: "x"}, time.Now()) != nil {
		t.Fatal("a PR without a URL is no PR")
	}
}
