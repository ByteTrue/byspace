package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// The current branch's merge request on GitLab, ported from getCurrentPullRequestStatus in the
// archived Node daemon's gitlab-service.ts.
//
// The MR is found by source branch, not by asking glab for "the current branch's" MR: an open MR
// wins, and a merged or closed one counts only while the checkout is still on its head commit. Its
// checks are the latest pipeline's jobs, and the aggregate is GitLab's own pipeline status.

type gitLabPipelineRef struct {
	ID     *int64  `json:"id"`
	Status *string `json:"status"`
	WebURL *string `json:"web_url"`
}

type gitLabMergeRequest struct {
	IID                         int                `json:"iid"`
	Title                       string             `json:"title"`
	WebURL                      string             `json:"web_url"`
	State                       string             `json:"state"`
	SourceBranch                string             `json:"source_branch"`
	TargetBranch                string             `json:"target_branch"`
	SHA                         string             `json:"sha"`
	Draft                       *bool              `json:"draft"`
	WorkInProgress              *bool              `json:"work_in_progress"`
	HasConflicts                *bool              `json:"has_conflicts"`
	BlockingDiscussionsResolved *bool              `json:"blocking_discussions_resolved"`
	MergeWhenPipelineSucceeds   *bool              `json:"merge_when_pipeline_succeeds"`
	ApprovalsRequired           *int               `json:"approvals_required"`
	ApprovalsGiven              *int               `json:"approvals_given"`
	MergedAt                    *string            `json:"merged_at"`
	DetailedMergeStatus         *string            `json:"detailed_merge_status"`
	MergeStatus                 *string            `json:"merge_status"`
	HeadPipeline                *gitLabPipelineRef `json:"head_pipeline"`
	References                  *struct {
		Full string `json:"full"`
	} `json:"references"`
}

type gitLabApprovalsResponse struct {
	ApprovedBy        []json.RawMessage `json:"approved_by"`
	ApprovalsRequired *int              `json:"approvals_required"`
	ApprovalsLeft     *int              `json:"approvals_left"`
}

type gitLabPipelineJob struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Stage        string  `json:"stage"`
	Status       string  `json:"status"`
	AllowFailure bool    `json:"allow_failure"`
	WebURL       *string `json:"web_url"`
}

var noMergeRequestPattern = regexp.MustCompile(`(?i)no (open )?merge requests?`)

// gitLabActivePipelineStatuses are GitLab's not-yet-finished statuses (protocol gitlab-pipeline.ts).
var gitLabActivePipelineStatuses = map[string]bool{
	"created": true, "waiting_for_resource": true, "preparing": true, "pending": true,
	"running": true, "canceling": true, "scheduled": true,
}

// currentGitLabMergeRequest resolves and describes the checkout's MR; nil when it has none.
func currentGitLabMergeRequest(ctx context.Context, cwd string, target PRLookupTarget) (map[string]any, error) {
	if !forgeCLIInstalled("glab") {
		return nil, nil
	}
	mr, err := resolveCurrentGitLabMergeRequest(ctx, cwd, target)
	if err != nil {
		if noMergeRequestPattern.MatchString(err.Error()) {
			return nil, nil
		}
		return nil, err
	}
	if mr == nil {
		return nil, nil
	}
	approvals := fetchGitLabMergeRequestApprovals(ctx, cwd, *mr)
	checks, pipelineStatus := fetchGitLabMergeRequestJobs(ctx, cwd, *mr)
	return gitLabMergeRequestStatus(*mr, approvals, checks, pipelineStatus), nil
}

func resolveCurrentGitLabMergeRequest(ctx context.Context, cwd string, target PRLookupTarget) (*gitLabMergeRequest, error) {
	if strings.HasPrefix(target.HeadRef, "-") {
		return nil, fmt.Errorf("refusing branch name that starts with a dash: %q", target.HeadRef)
	}
	out, stderr, err := runForgeCLIWithStderr(ctx, forgeCommandTimeout, "glab", cwd, "mr", "list", "--all",
		"--source-branch", target.HeadRef, "--order", "updated_at", "--sort", "desc", "--per-page", "100", "-F", "json")
	if err != nil {
		return nil, fmt.Errorf("%s", strings.TrimSpace(stderr+" "+err.Error()))
	}
	var listed []gitLabMergeRequest
	if strings.TrimSpace(out) != "" {
		if err := json.Unmarshal([]byte(out), &listed); err != nil {
			return nil, err
		}
	}
	var match *gitLabMergeRequest
	for i := range listed {
		if listed[i].SourceBranch == target.HeadRef && gitLabMergeRequestState(listed[i].State) == "open" {
			match = &listed[i]
			break
		}
	}
	if match == nil && target.HeadSha != "" {
		for i := range listed {
			if listed[i].SourceBranch == target.HeadRef && gitLabMergeRequestState(listed[i].State) != "open" && listed[i].SHA == target.HeadSha {
				match = &listed[i]
				break
			}
		}
	}
	if match == nil {
		return nil, nil
	}
	out, stderr, err = runForgeCLIWithStderr(ctx, forgeCommandTimeout, "glab", cwd, "mr", "view", strconv.Itoa(match.IID), "-F", "json")
	if err != nil {
		return nil, fmt.Errorf("%s", strings.TrimSpace(stderr+" "+err.Error()))
	}
	var mr gitLabMergeRequest
	if err := json.Unmarshal([]byte(out), &mr); err != nil {
		return nil, err
	}
	return &mr, nil
}

// fetchGitLabMergeRequestApprovals is best-effort: a host without the endpoint keeps the MR status.
func fetchGitLabMergeRequestApprovals(ctx context.Context, cwd string, mr gitLabMergeRequest) *gitLabApprovalsResponse {
	projectPath := gitLabProjectPath(gitLabFullReference(mr))
	if projectPath == "" {
		return nil
	}
	out, _, err := runForgeCLIWithStderr(ctx, forgeCommandTimeout, "glab", cwd, "api",
		fmt.Sprintf("projects/%s/merge_requests/%d/approvals", url.PathEscape(projectPath), mr.IID))
	if err != nil {
		return nil
	}
	var approvals gitLabApprovalsResponse
	if json.Unmarshal([]byte(out), &approvals) != nil {
		return nil
	}
	return &approvals
}

// fetchGitLabMergeRequestJobs reads the MR's latest pipeline: its jobs as checks, and its status.
func fetchGitLabMergeRequestJobs(ctx context.Context, cwd string, mr gitLabMergeRequest) ([]map[string]any, string) {
	if mr.HeadPipeline == nil || mr.HeadPipeline.ID == nil {
		return []map[string]any{}, ""
	}
	out, _, err := runForgeCLIWithStderr(ctx, forgeCommandTimeout, "glab", cwd, "ci", "get",
		"--merge-request", strconv.Itoa(mr.IID), "--with-job-details", "-F", "json")
	if err != nil {
		return []map[string]any{}, ""
	}
	var pipeline struct {
		Status string              `json:"status"`
		Jobs   []gitLabPipelineJob `json:"jobs"`
	}
	if json.Unmarshal([]byte(out), &pipeline) != nil {
		return []map[string]any{}, ""
	}
	// glab lists jobs newest first; ascending id is creation order.
	sort.SliceStable(pipeline.Jobs, func(i, j int) bool { return pipeline.Jobs[i].ID < pipeline.Jobs[j].ID })
	checks := make([]map[string]any, 0, len(pipeline.Jobs))
	for _, job := range pipeline.Jobs {
		checks = append(checks, gitLabJobCheck(job))
	}
	return checks, pipeline.Status
}

func gitLabJobCheck(job gitLabPipelineJob) map[string]any {
	raw := strings.ToLower(job.Status)
	var status string
	switch {
	case raw == "failed" && job.AllowFailure:
		// GitLab counts it as passed with a warning: the aggregate stays green.
		status = "success"
	case raw == "manual" && job.AllowFailure:
		status = "skipped"
	default:
		status = gitLabJobCheckStatus(raw)
	}
	check := map[string]any{
		"name":       job.Name,
		"status":     status,
		"url":        nil,
		"workflow":   job.Stage,
		"checkRunId": job.ID,
	}
	if job.WebURL != nil {
		check["url"] = *job.WebURL
	}
	switch {
	case raw == "manual" && job.AllowFailure:
		check["traits"] = []string{"manual"}
	case raw == "manual":
		check["traits"] = []string{"manual", "action_required"}
	case raw == "failed" && job.AllowFailure:
		check["traits"] = []string{"warning"}
	}
	return check
}

func gitLabJobCheckStatus(raw string) string {
	switch raw {
	case "success", "passed":
		return "success"
	case "failed":
		return "failure"
	case "canceled", "cancelled":
		return "cancelled"
	case "skipped":
		return "skipped"
	default:
		// running, pending, manual, created and anything still active or unknown.
		return "pending"
	}
}

// gitLabPipelineChecksStatus is GitLab's own aggregate: post-success manual deploy jobs must not
// hold an MR at "pending" forever, which deriving it from the jobs would.
func gitLabPipelineChecksStatus(status string) string {
	switch status {
	case "success", "passed":
		return "success"
	case "failed":
		return "failure"
	case "canceled", "cancelled":
		return "none"
	case "manual":
		return "pending"
	}
	if gitLabActivePipelineStatuses[status] {
		return "pending"
	}
	return "none"
}

func gitLabMergeRequestState(state string) string {
	switch state {
	case "opened":
		return "open"
	case "merged":
		return "merged"
	default:
		return "closed"
	}
}

func gitLabFullReference(mr gitLabMergeRequest) string {
	if mr.References == nil {
		return ""
	}
	return mr.References.Full
}

func gitLabMergeRequestStatus(mr gitLabMergeRequest, approvals *gitLabApprovalsResponse, checks []map[string]any, pipelineStatus string) map[string]any {
	projectPath := gitLabProjectPath(gitLabFullReference(mr))
	status := map[string]any{
		"number":         mr.IID,
		"url":            mr.WebURL,
		"title":          mr.Title,
		"state":          gitLabMergeRequestState(mr.State),
		"baseRefName":    mr.TargetBranch,
		"headRefName":    mr.SourceBranch,
		"isMerged":       mr.State == "merged" || (mr.MergedAt != nil && *mr.MergedAt != ""),
		"isDraft":        gitLabDraft(mr),
		"mergeable":      gitLabMergeable(mr),
		"checks":         checks,
		"reviewDecision": nil,
		"forgeSpecific":  gitLabStatusFacts(mr, approvals),
	}
	if pipelineStatus == "" && mr.HeadPipeline != nil && mr.HeadPipeline.Status != nil {
		pipelineStatus = *mr.HeadPipeline.Status
	}
	status["checksStatus"] = gitLabPipelineChecksStatus(pipelineStatus)
	if projectPath != "" {
		status["projectPath"] = projectPath
		segments := strings.Split(strings.Trim(projectPath, "/"), "/")
		status["repoOwner"] = segments[0]
		status["repoName"] = segments[len(segments)-1]
	}
	return status
}

func gitLabDraft(mr gitLabMergeRequest) bool {
	if mr.Draft != nil {
		return *mr.Draft
	}
	return mr.WorkInProgress != nil && *mr.WorkInProgress
}

// gitLabMergeable reads GitLab's merge signals: detailed_merge_status (15.6+), else the legacy
// merge_status without conflicts.
func gitLabMergeable(mr gitLabMergeRequest) string {
	conflicts := mr.HasConflicts != nil && *mr.HasConflicts
	if conflicts {
		return "CONFLICTING"
	}
	if mr.DetailedMergeStatus != nil {
		if *mr.DetailedMergeStatus == "mergeable" {
			return "MERGEABLE"
		}
		return "UNKNOWN"
	}
	if mr.MergeStatus != nil && *mr.MergeStatus == "can_be_merged" {
		return "MERGEABLE"
	}
	return "UNKNOWN"
}

func gitLabStatusFacts(mr gitLabMergeRequest, approvals *gitLabApprovalsResponse) map[string]any {
	required := 0
	if approvals != nil && approvals.ApprovalsRequired != nil {
		required = *approvals.ApprovalsRequired
	} else if mr.ApprovalsRequired != nil {
		required = *mr.ApprovalsRequired
	}
	given := 0
	switch {
	case approvals != nil && approvals.ApprovedBy != nil:
		given = len(approvals.ApprovedBy)
	case approvals != nil && approvals.ApprovalsRequired != nil && approvals.ApprovalsLeft != nil:
		given = max(0, *approvals.ApprovalsRequired-*approvals.ApprovalsLeft)
	case mr.ApprovalsGiven != nil:
		given = *mr.ApprovalsGiven
	}
	facts := map[string]any{
		"forge":                       "gitlab",
		"detailedMergeStatus":         stringOrNil(mr.DetailedMergeStatus),
		"mergeStatus":                 stringOrNil(mr.MergeStatus),
		"hasConflicts":                mr.HasConflicts != nil && *mr.HasConflicts,
		"blockingDiscussionsResolved": mr.BlockingDiscussionsResolved == nil || *mr.BlockingDiscussionsResolved,
		"approvalsRequired":           required,
		"approvalsGiven":              given,
		"pipelineStatus":              nil,
		"pipelineId":                  nil,
		"pipelineUrl":                 nil,
		"mergeWhenPipelineSucceeds":   mr.MergeWhenPipelineSucceeds != nil && *mr.MergeWhenPipelineSucceeds,
	}
	if pipeline := mr.HeadPipeline; pipeline != nil {
		facts["pipelineStatus"] = stringOrNil(pipeline.Status)
		facts["pipelineUrl"] = stringOrNil(pipeline.WebURL)
		if pipeline.ID != nil {
			facts["pipelineId"] = *pipeline.ID
		}
	}
	return facts
}
