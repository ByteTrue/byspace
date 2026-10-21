package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

func runForgeCLI(ctx context.Context, bin, cwd string, args ...string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, bin, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimSpace(out.String()), nil
}

func runGH(ctx context.Context, cwd string, args ...string) (string, error) {
	return runForgeCLI(ctx, "gh", cwd, args...)
}

// DetectForge inspects the origin remote URL to classify the git forge ("github", "gitlab", or "gitea").
func DetectForge(ctx context.Context, cwd string) string {
	remote, err := runGit(ctx, cwd, "remote", "get-url", "origin")
	if err != nil || remote == "" {
		return "github"
	}
	lower := strings.ToLower(remote)
	if strings.Contains(lower, "gitlab") {
		return "gitlab"
	}
	if strings.Contains(lower, "gitea") || strings.Contains(lower, "codeberg") {
		return "gitea"
	}
	return "github"
}

// GetPRStatus queries `gh pr view` (or `glab mr view`) for the active branch in cwd.
// Returns (nil, nil) if the forge CLI is unavailable or no PR/MR exists for the current branch.
func GetPRStatus(ctx context.Context, cwd string) (map[string]any, error) {
	forge := DetectForge(ctx, cwd)
	if forge == "gitlab" {
		raw, err := runForgeCLI(ctx, "glab", cwd, "mr", "view", "-F", "json")
		if err != nil || raw == "" {
			return nil, nil
		}
		var data map[string]any
		if json.Unmarshal([]byte(raw), &data) != nil {
			return nil, nil
		}
		iid, _ := data["iid"].(float64)
		if iid <= 0 {
			return nil, nil
		}
		title, _ := data["title"].(string)
		url, _ := data["web_url"].(string)
		state, _ := data["state"].(string)
		lowerState := strings.ToLower(state)

		// A merge request's readiness is its pipeline and its approvals. Reporting an empty
		// check list and zero approvals makes a blocked MR look ready — the panel would offer a
		// merge button that the forge then rejects.
		checks := fetchGitLabPipelineChecks(ctx, cwd, int(iid))
		approvals, approvalsRequired := fetchGitLabApprovals(ctx, cwd, int(iid))
		mergeable := "UNKNOWN"
		if approvalsRequired > 0 {
			if approvals >= approvalsRequired {
				mergeable = "MERGEABLE"
			} else {
				mergeable = "BLOCKED"
			}
		}

		return map[string]any{
			"number":            int(iid),
			"title":             title,
			"url":               url,
			"state":             lowerState,
			"isDraft":           isGitLabDraft(data),
			"headRefName":       data["source_branch"],
			"baseRefName":       data["target_branch"],
			"updatedAt":         time.Now().UTC().Format(time.RFC3339Nano),
			"mergeable":         mergeable,
			"reviewDecision":    nil,
			"isMerged":          lowerState == "merged",
			"checks":            checks,
			"approvals":         approvals,
			"approvalsRequired": approvalsRequired,
		}, nil
	}
	raw, err := runGH(ctx, cwd, "pr", "view", "--json", "number,title,url,state,isDraft,mergeable,reviewDecision,headRefName,baseRefName,updatedAt")
	if err != nil || raw == "" {
		return nil, nil
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return nil, nil
	}
	num, _ := data["number"].(float64)
	if num <= 0 {
		return nil, nil
	}
	title, _ := data["title"].(string)
	url, _ := data["url"].(string)
	state, _ := data["state"].(string)
	isDraft, _ := data["isDraft"].(bool)
	headRef, _ := data["headRefName"].(string)
	baseRef, _ := data["baseRefName"].(string)
	updatedAt, _ := data["updatedAt"].(string)
	if updatedAt == "" {
		updatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}

	return map[string]any{
		"number":         int(num),
		"title":          title,
		"url":            url,
		"state":          strings.ToLower(state),
		"isDraft":        isDraft,
		"headRefName":    headRef,
		"baseRefName":    baseRef,
		"updatedAt":      updatedAt,
		"mergeable":      "UNKNOWN",
		"reviewDecision": nil,
		"checks":         []any{},
	}, nil
}

// CreatePR runs `gh pr create` and returns (url, prNumber, error).
func CreatePR(ctx context.Context, cwd, title, body, base string, draft bool) (string, *int, error) {
	args := []string{"pr", "create", "--title", title, "--body", body}
	if strings.TrimSpace(base) != "" {
		args = append(args, "--base", base)
	}
	if draft {
		args = append(args, "--draft")
	}
	out, err := runGH(ctx, cwd, args...)
	if err != nil {
		return "", nil, err
	}
	var numPtr *int
	parts := strings.Split(strings.TrimRight(out, "/"), "/")
	if len(parts) > 0 {
		if n, convErr := strconv.Atoi(parts[len(parts)-1]); convErr == nil && n > 0 {
			numPtr = &n
		}
	}
	return out, numPtr, nil
}

// MergePR runs `gh pr merge` on the current branch's PR.
func MergePR(ctx context.Context, cwd, method string) error {
	flag := "--merge"
	switch strings.ToLower(strings.TrimSpace(method)) {
	case "squash":
		flag = "--squash"
	case "rebase":
		flag = "--rebase"
	}
	_, err := runGH(ctx, cwd, "pr", "merge", flag)
	return err
}

// SetAutoMerge enables or disables auto-merge on the current branch's PR via `gh pr merge`.
func SetAutoMerge(ctx context.Context, cwd string, enabled bool, mergeMethod string) error {
	if enabled {
		// The strategy is the user's choice; hardcoding --merge meant a squash-only repo
		// rejected every auto-merge attempt.
		method := strings.TrimSpace(mergeMethod)
		switch method {
		case "merge", "squash", "rebase":
			// valid
		default:
			method = "merge"
		}
		_, err := runGH(ctx, cwd, "pr", "merge", "--auto", "--"+method)
		return err
	}
	_, err := runGH(ctx, cwd, "pr", "merge", "--disable-auto")
	return err
}

// SearchGitHubRepos searches repositories accessible via `gh search repos`.
func SearchGitHubRepos(ctx context.Context, query string, limit int) ([]map[string]any, bool) {
	if _, err := exec.LookPath("gh"); err != nil {
		return []map[string]any{}, false
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	args := []string{"repo", "list", "--limit", strconv.Itoa(limit), "--json", "nameWithOwner,name,owner,description,url,isPrivate,updatedAt,defaultBranchRef"}
	if strings.TrimSpace(query) != "" {
		args = []string{"search", "repos", query, "--limit", strconv.Itoa(limit), "--json", "fullName,name,owner,description,url,isPrivate,updatedAt,defaultBranch"}
	}
	raw, err := runGH(ctx, "", args...)
	if err != nil || raw == "" {
		return []map[string]any{}, true
	}
	var items []map[string]any
	if json.Unmarshal([]byte(raw), &items) != nil {
		return []map[string]any{}, true
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		fullName, _ := it["nameWithOwner"].(string)
		if fullName == "" {
			fullName, _ = it["fullName"].(string)
		}
		name, _ := it["name"].(string)
		ownerLogin := ""
		if ownerMap, ok := it["owner"].(map[string]any); ok {
			ownerLogin, _ = ownerMap["login"].(string)
		}
		if ownerLogin == "" && strings.Contains(fullName, "/") {
			ownerLogin = strings.SplitN(fullName, "/", 2)[0]
		}
		if fullName == "" || name == "" || ownerLogin == "" {
			continue
		}
		desc, _ := it["description"].(string)
		url, _ := it["url"].(string)
		isPriv, _ := it["isPrivate"].(bool)
		updatedAt, _ := it["updatedAt"].(string)
		defBranch := "main"
		if dbMap, ok := it["defaultBranchRef"].(map[string]any); ok {
			if bName, ok := dbMap["name"].(string); ok && bName != "" {
				defBranch = bName
			}
		} else if bName, ok := it["defaultBranch"].(string); ok && bName != "" {
			defBranch = bName
		}
		out = append(out, map[string]any{
			"nameWithOwner": fullName,
			"name":          name,
			"owner":         ownerLogin,
			"description":   desc,
			"url":           url,
			"isPrivate":     isPriv,
			"updatedAt":     updatedAt,
			"defaultBranch": defBranch,
		})
	}
	return out, true
}

// SearchIssuesAndPullRequests searches issues and PRs in the repository's forge.
//
// `forge.search.request` is what the checkout panel's search box calls; it answered with an
// empty list unconditionally, so search looked broken rather than unimplemented. Each forge has
// its own CLI, and they disagree on flags, so each branch is explicit.
func SearchIssuesAndPullRequests(ctx context.Context, cwd, query string, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	forge := DetectForge(ctx, cwd)
	limitArg := strconv.Itoa(limit)

	switch forge {
	case "gitlab":
		if _, err := exec.LookPath("glab"); err != nil {
			return []map[string]any{}, fmt.Errorf("glab is not installed")
		}
		raw, err := runForgeCLI(ctx, "glab", cwd, "api",
			fmt.Sprintf("projects/:id/search?scope=issues&search=%s&per_page=%s", url.QueryEscape(query), limitArg))
		if err != nil {
			return []map[string]any{}, err
		}
		return decodeForgeItems(raw, "title", "web_url")
	case "gitea":
		if _, err := exec.LookPath("tea"); err != nil {
			return []map[string]any{}, fmt.Errorf("tea is not installed")
		}
		raw, err := runForgeCLI(ctx, "tea", cwd, "issues", "list", "--search", query, "--limit", limitArg, "--output", "json")
		if err != nil {
			return []map[string]any{}, err
		}
		return decodeForgeItems(raw, "title", "html_url")
	default:
		if _, err := exec.LookPath("gh"); err != nil {
			return []map[string]any{}, fmt.Errorf("gh is not installed")
		}
		args := []string{"search", "prs", "--limit", limitArg,
			"--json", "number,title,state,url,isPullRequest,updatedAt,author"}
		if strings.TrimSpace(query) != "" {
			args = append(args, query)
		}
		raw, err := runGH(ctx, cwd, args...)
		if err != nil {
			return []map[string]any{}, err
		}
		return decodeForgeItems(raw, "title", "url")
	}
}

// decodeForgeItems normalizes the three CLIs' JSON into one item shape.
func decodeForgeItems(raw, titleKey, urlKey string) ([]map[string]any, error) {
	if strings.TrimSpace(raw) == "" {
		return []map[string]any{}, nil
	}
	var items []map[string]any
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return []map[string]any{}, err
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		title, _ := it[titleKey].(string)
		url, _ := it[urlKey].(string)
		if title == "" && url == "" {
			continue
		}
		state, _ := it["state"].(string)
		number := 0
		switch n := it["number"].(type) {
		case float64:
			number = int(n)
		case int:
			number = n
		}
		kind := "issue"
		if isPR, ok := it["isPullRequest"].(bool); ok && isPR {
			kind = "pull_request"
		}
		out = append(out, map[string]any{
			"title":  title,
			"url":    url,
			"state":  state,
			"number": number,
			"kind":   kind,
		})
	}
	return out, nil
}

// ResolveChangeRequestCheckoutTarget asks the forge for a PR/MR's head and base refs.
//
// Ported from resolvePrCheckoutTarget. `gh pr view --json` gives the branch names directly;
// for GitLab and Gitea the merge-request/issues API returns the same two fields under different
// keys, so each branch is explicit rather than shared.
func ResolveChangeRequestCheckoutTarget(ctx context.Context, forge, repoCwd string, number int) (ChangeRequestCheckoutTarget, error) {
	if number <= 0 {
		return ChangeRequestCheckoutTarget{}, fmt.Errorf("change request number must be positive")
	}
	numberArg := strconv.Itoa(number)

	switch forge {
	case "gitlab":
		if _, err := exec.LookPath("glab"); err != nil {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("glab is not installed")
		}
		raw, err := runForgeCLI(ctx, "glab", repoCwd, "api",
			fmt.Sprintf("projects/:id/merge_requests/%s", numberArg))
		if err != nil {
			return ChangeRequestCheckoutTarget{}, err
		}
		var mr struct {
			SourceBranch    string `json:"source_branch"`
			TargetBranch    string `json:"target_branch"`
			SourceProjectID int    `json:"source_project_id"`
			TargetProjectID int    `json:"target_project_id"`
		}
		if json.Unmarshal([]byte(raw), &mr) != nil {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("could not read merge request %d", number)
		}
		return ChangeRequestCheckoutTarget{
			HeadRef:           mr.SourceBranch,
			BaseRefName:       mr.TargetBranch,
			IsCrossRepository: mr.SourceProjectID != 0 && mr.TargetProjectID != 0 && mr.SourceProjectID != mr.TargetProjectID,
		}, nil

	case "gitea":
		if _, err := exec.LookPath("tea"); err != nil {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("tea is not installed")
		}
		raw, err := runForgeCLI(ctx, "tea", repoCwd, "prs", numberArg, "--output", "json")
		if err != nil {
			return ChangeRequestCheckoutTarget{}, err
		}
		var pr struct {
			Head struct {
				Ref string `json:"ref"`
			} `json:"head"`
			Base struct {
				Ref string `json:"ref"`
			} `json:"base"`
		}
		if json.Unmarshal([]byte(raw), &pr) != nil {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("could not read pull request %d", number)
		}
		return ChangeRequestCheckoutTarget{HeadRef: pr.Head.Ref, BaseRefName: pr.Base.Ref}, nil

	default:
		if _, err := exec.LookPath("gh"); err != nil {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("gh is not installed")
		}
		raw, err := runGH(ctx, repoCwd, "pr", "view", numberArg,
			"--json", "headRefName,baseRefName,isCrossRepository,headRepository")
		if err != nil {
			return ChangeRequestCheckoutTarget{}, err
		}
		var pr struct {
			HeadRefName       string `json:"headRefName"`
			BaseRefName       string `json:"baseRefName"`
			IsCrossRepository bool   `json:"isCrossRepository"`
			HeadRepository    struct {
				Name string `json:"name"`
			} `json:"headRepository"`
		}
		if json.Unmarshal([]byte(raw), &pr) != nil {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("could not read pull request %d", number)
		}
		return ChangeRequestCheckoutTarget{
			HeadRef:           pr.HeadRefName,
			BaseRefName:       pr.BaseRefName,
			IsCrossRepository: pr.IsCrossRepository,
			HeadRepository:    pr.HeadRepository.Name,
		}, nil
	}
}

// PullRequestTimeline fetches a PR's comments and reviews.
//
// Ported from the forge services' getPullRequestTimeline. The checkout panel shows it as one
// chronological thread, so a review and a comment have to arrive in the same shape — the client
// discriminates on `kind` and would otherwise render a review as an empty comment.
//
// `truncated` is reported rather than silently dropping: a long thread that stops at the limit
// without saying so looks like the conversation ended.
func PullRequestTimeline(ctx context.Context, forge, cwd string, number, limit int) ([]map[string]any, bool, error) {
	if number <= 0 {
		return nil, false, fmt.Errorf("pull request number must be positive")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	numberArg := strconv.Itoa(number)
	limitArg := strconv.Itoa(limit)

	switch forge {
	case "gitlab":
		if _, err := exec.LookPath("glab"); err != nil {
			return nil, false, fmt.Errorf("glab is not installed")
		}
		raw, err := runForgeCLI(ctx, "glab", cwd, "api",
			fmt.Sprintf("projects/:id/merge_requests/%s/notes?per_page=%s&sort=asc", numberArg, limitArg))
		if err != nil {
			return nil, false, err
		}
		return decodeGitLabNotes(raw, limit)

	case "gitea":
		if _, err := exec.LookPath("tea"); err != nil {
			return nil, false, fmt.Errorf("tea is not installed")
		}
		raw, err := runForgeCLI(ctx, "tea", cwd, "prs", numberArg, "--comments", "--output", "json")
		if err != nil {
			return nil, false, err
		}
		return decodeGiteaComments(raw, limit)

	default:
		if _, err := exec.LookPath("gh"); err != nil {
			return nil, false, fmt.Errorf("gh is not installed")
		}
		// Reviews and comments are separate endpoints; the panel wants one thread.
		reviewsRaw, reviewsErr := runGH(ctx, cwd, "api",
			fmt.Sprintf("repos/{owner}/{repo}/pulls/%s/reviews?per_page=%s", numberArg, limitArg))
		commentsRaw, commentsErr := runGH(ctx, cwd, "api",
			fmt.Sprintf("repos/{owner}/{repo}/issues/%s/comments?per_page=%s", numberArg, limitArg))
		if reviewsErr != nil && commentsErr != nil {
			return nil, false, reviewsErr
		}
		items := make([]map[string]any, 0, limit)
		items = append(items, decodeGitHubReviews(reviewsRaw)...)
		items = append(items, decodeGitHubComments(commentsRaw)...)
		return sortAndLimitTimeline(items, limit)
	}
}

// sortAndLimitTimeline orders by creation time and reports whether anything was dropped.
func sortAndLimitTimeline(items []map[string]any, limit int) ([]map[string]any, bool, error) {
	sort.SliceStable(items, func(i, j int) bool {
		ai, _ := items[i]["createdAt"].(int64)
		aj, _ := items[j]["createdAt"].(int64)
		return ai < aj
	})
	if len(items) > limit {
		return items[:limit], true, nil
	}
	return items, false, nil
}

func decodeGitHubReviews(raw string) []map[string]any {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var reviews []map[string]any
	if json.Unmarshal([]byte(raw), &reviews) != nil {
		return nil
	}
	out := make([]map[string]any, 0, len(reviews))
	for _, review := range reviews {
		user, _ := review["user"].(map[string]any)
		author, _ := user["login"].(string)
		avatar, _ := user["avatar_url"].(string)
		profile, _ := user["html_url"].(string)
		reviewState := "commented"
		if state, ok := review["state"].(string); ok {
			switch strings.ToUpper(state) {
			case "APPROVED":
				reviewState = "approved"
			case "CHANGES_REQUESTED":
				reviewState = "changes_requested"
			}
		}
		out = append(out, map[string]any{
			"id":          fmt.Sprintf("review-%v", review["id"]),
			"kind":        "review",
			"author":      firstNonEmpty(author, "unknown"),
			"authorUrl":   nullableString(profile),
			"avatarUrl":   nullableString(avatar),
			"body":        stringOr(review["body"], ""),
			"createdAt":   parseUnixOrISO(review["submitted_at"]),
			"url":         stringOr(review["html_url"], ""),
			"reviewState": reviewState,
		})
	}
	return out
}

func decodeGitHubComments(raw string) []map[string]any {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var comments []map[string]any
	if json.Unmarshal([]byte(raw), &comments) != nil {
		return nil
	}
	out := make([]map[string]any, 0, len(comments))
	for _, comment := range comments {
		user, _ := comment["user"].(map[string]any)
		out = append(out, map[string]any{
			"id":        fmt.Sprintf("comment-%v", comment["id"]),
			"kind":      "comment",
			"author":    firstNonEmpty(stringOr(user["login"], ""), "unknown"),
			"authorUrl": nullableString(stringOr(user["html_url"], "")),
			"avatarUrl": nullableString(stringOr(user["avatar_url"], "")),
			"body":      stringOr(comment["body"], ""),
			"createdAt": parseUnixOrISO(comment["created_at"]),
			"url":       stringOr(comment["html_url"], ""),
		})
	}
	return out
}

func decodeGitLabNotes(raw string, limit int) ([]map[string]any, bool, error) {
	var notes []map[string]any
	if json.Unmarshal([]byte(raw), &notes) != nil {
		return nil, false, fmt.Errorf("could not read merge request notes")
	}
	out := make([]map[string]any, 0, len(notes))
	for _, note := range notes {
		author, _ := note["author"].(map[string]any)
		body := stringOr(note["body"], "")
		kind := "comment"
		reviewState := ""
		// GitLab models a review as a system note carrying the approval text.
		if system, _ := note["system"].(bool); system && strings.Contains(strings.ToLower(body), "approved") {
			kind = "review"
			reviewState = "approved"
		}
		item := map[string]any{
			"id":        fmt.Sprintf("note-%v", note["id"]),
			"kind":      kind,
			"author":    firstNonEmpty(stringOr(author["username"], ""), "unknown"),
			"authorUrl": nullableString(stringOr(author["web_url"], "")),
			"avatarUrl": nullableString(stringOr(author["avatar_url"], "")),
			"body":      body,
			"createdAt": parseUnixOrISO(note["created_at"]),
			"url":       "",
		}
		if kind == "review" {
			item["reviewState"] = reviewState
		}
		out = append(out, item)
	}
	return sortAndLimitTimeline(out, limit)
}

func decodeGiteaComments(raw string, limit int) ([]map[string]any, bool, error) {
	var comments []map[string]any
	if json.Unmarshal([]byte(raw), &comments) != nil {
		return nil, false, fmt.Errorf("could not read pull request comments")
	}
	out := make([]map[string]any, 0, len(comments))
	for _, comment := range comments {
		user, _ := comment["user"].(map[string]any)
		out = append(out, map[string]any{
			"id":        fmt.Sprintf("comment-%v", comment["id"]),
			"kind":      "comment",
			"author":    firstNonEmpty(stringOr(user["login"], ""), "unknown"),
			"authorUrl": nullableString(stringOr(user["html_url"], "")),
			"avatarUrl": nullableString(stringOr(user["avatar_url"], "")),
			"body":      stringOr(comment["body"], ""),
			"createdAt": parseUnixOrISO(comment["created_at"]),
			"url":       stringOr(comment["html_url"], ""),
		})
	}
	return sortAndLimitTimeline(out, limit)
}

// parseUnixOrISO reads either an ISO timestamp or epoch seconds into epoch milliseconds.
func parseUnixOrISO(value any) int64 {
	switch v := value.(type) {
	case string:
		if v == "" {
			return 0
		}
		if parsed, err := time.Parse(time.RFC3339, v); err == nil {
			return parsed.UnixMilli()
		}
		return 0
	case float64:
		return int64(v) * 1000
	default:
		return 0
	}
}

func stringOr(value any, fallback string) string {
	if text, ok := value.(string); ok && text != "" {
		return text
	}
	return fallback
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// CheckDetails fetches a check run's details, annotations and failed jobs.
//
// Ported from the forge services' getCheckDetails. The checkout panel shows it when the user
// clicks a failing check: without it the only thing visible is "this check failed", which does
// not say what broke.
//
// `failedJobs` is GitHub-specific (a workflow run's failing jobs); the other forges report
// annotations only and leave it empty rather than inventing an equivalent.
func CheckDetails(ctx context.Context, forge, cwd string, checkRunID int) (map[string]any, error) {
	if checkRunID <= 0 {
		return nil, fmt.Errorf("check run id must be positive")
	}
	if forge != "" && forge != "github" {
		return nil, fmt.Errorf("check details are not available for %s", forge)
	}
	if _, err := exec.LookPath("gh"); err != nil {
		return nil, fmt.Errorf("gh is not installed")
	}

	raw, err := runGH(ctx, cwd, "api", fmt.Sprintf("repos/{owner}/{repo}/check-runs/%d", checkRunID))
	if err != nil {
		return nil, err
	}
	var run struct {
		ID         int64  `json:"id"`
		Name       string `json:"name"`
		Status     string `json:"status"`
		Conclusion string `json:"conclusion"`
		HTMLURL    string `json:"html_url"`
		DetailsURL string `json:"details_url"`
		Output     struct {
			Title   string `json:"title"`
			Summary string `json:"summary"`
			Text    string `json:"text"`
		} `json:"output"`
		CheckSuite struct {
			WorkflowRunID int64 `json:"workflow_run_id"`
		} `json:"check_suite"`
	}
	if json.Unmarshal([]byte(raw), &run) != nil {
		return nil, fmt.Errorf("could not read check run %d", checkRunID)
	}

	details := map[string]any{
		"checkRunId":  int(run.ID),
		"name":        run.Name,
		"status":      nullableString(run.Status),
		"conclusion":  nullableString(run.Conclusion),
		"url":         nullableString(run.HTMLURL),
		"detailsUrl":  nullableString(run.DetailsURL),
		"annotations": []map[string]any{},
		"failedJobs":  []map[string]any{},
		"truncated":   false,
	}
	if run.CheckSuite.WorkflowRunID != 0 {
		details["workflowRunId"] = run.CheckSuite.WorkflowRunID
	}
	if run.Output.Title != "" || run.Output.Summary != "" || run.Output.Text != "" {
		details["output"] = map[string]any{
			"title":   nullableString(run.Output.Title),
			"summary": nullableString(run.Output.Summary),
			"text":    nullableString(run.Output.Text),
		}
	}

	// Annotations explain *why* the check failed; the check run alone only says that it did.
	annotationsRaw, annotationsErr := runGH(ctx, cwd, "api",
		fmt.Sprintf("repos/{owner}/{repo}/check-runs/%d/annotations", checkRunID))
	if annotationsErr == nil {
		details["annotations"] = decodeCheckAnnotations(annotationsRaw)
	}
	return details, nil
}

// decodeCheckAnnotations maps GitHub's annotation list onto the wire shape.
func decodeCheckAnnotations(raw string) []map[string]any {
	if strings.TrimSpace(raw) == "" {
		return []map[string]any{}
	}
	var annotations []map[string]any
	if json.Unmarshal([]byte(raw), &annotations) != nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(annotations))
	for _, annotation := range annotations {
		out = append(out, map[string]any{
			"path":            stringOr(annotation["path"], ""),
			"startLine":       annotation["start_line"],
			"endLine":         annotation["end_line"],
			"annotationLevel": stringOr(annotation["annotation_level"], ""),
			"message":         stringOr(annotation["message"], ""),
			"title":           stringOr(annotation["title"], ""),
		})
	}
	return out
}

// fetchGitLabPipelineChecks reads the merge request's pipeline statuses.
//
// GitLab calls them pipelines, not checks; the panel renders both through the same check list,
// so each pipeline becomes one entry with the name and status the API reports.
func fetchGitLabPipelineChecks(ctx context.Context, cwd string, iid int) []map[string]any {
	if _, err := exec.LookPath("glab"); err != nil {
		return []map[string]any{}
	}
	raw, err := runForgeCLI(ctx, "glab", cwd, "api",
		fmt.Sprintf("projects/:id/merge_requests/%d/pipelines", iid))
	if err != nil || strings.TrimSpace(raw) == "" {
		return []map[string]any{}
	}
	var pipelines []map[string]any
	if json.Unmarshal([]byte(raw), &pipelines) != nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(pipelines))
	for _, pipeline := range pipelines {
		// The protocol's status is a closed enum; an unknown GitLab state maps to "pending"
		// rather than inventing a value the client would reject.
		out = append(out, map[string]any{
			"name":   fmt.Sprintf("pipeline #%v", pipeline["id"]),
			"status": gitLabCheckStatus(stringOr(pipeline["status"], "")),
			"url":    nullableString(stringOr(pipeline["web_url"], "")),
		})
	}
	return out
}

// fetchGitLabApprovals returns (approved, required).
//
// A forge that does not expose approvals answers 0,0, which the caller treats as "no approval
// requirement" rather than "blocked" — guessing blocked would hide a mergeable MR.
func fetchGitLabApprovals(ctx context.Context, cwd string, iid int) (int, int) {
	if _, err := exec.LookPath("glab"); err != nil {
		return 0, 0
	}
	raw, err := runForgeCLI(ctx, "glab", cwd, "api",
		fmt.Sprintf("projects/:id/merge_requests/%d/approvals", iid))
	if err != nil || strings.TrimSpace(raw) == "" {
		return 0, 0
	}
	var data struct {
		ApprovedBy        []map[string]any `json:"approved_by"`
		ApprovalsRequired int              `json:"approvals_required"`
		ApprovalsLeft     int              `json:"approvals_left"`
	}
	if json.Unmarshal([]byte(raw), &data) != nil {
		return 0, 0
	}
	required := data.ApprovalsRequired
	if required == 0 {
		required = len(data.ApprovedBy) + data.ApprovalsLeft
	}
	return len(data.ApprovedBy), required
}

// isGitLabDraft reads the draft flag, which lives in the title prefix or a dedicated field
// depending on the GitLab version.
func isGitLabDraft(data map[string]any) bool {
	if draft, ok := data["draft"].(bool); ok {
		return draft
	}
	if workInProgress, ok := data["work_in_progress"].(bool); ok {
		return workInProgress
	}
	title := strings.ToLower(stringOr(data["title"], ""))
	return strings.HasPrefix(title, "draft:") || strings.HasPrefix(title, "[draft]") ||
		strings.HasPrefix(title, "wip:")
}

// gitLabCheckStatus maps a pipeline status onto the protocol's closed check-status enum.
//
// An unrecognised state maps to "pending" rather than inventing a value: the client rejects the
// whole message on an out-of-enum string, so a new GitLab status would blank the panel.
func gitLabCheckStatus(status string) string {
	switch strings.ToLower(status) {
	case "success":
		return "success"
	case "failed":
		return "failure"
	case "canceled", "cancelled":
		return "cancelled"
	case "skipped":
		return "skipped"
	default:
		return "pending"
	}
}
