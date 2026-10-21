package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os/exec"
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
		return map[string]any{
			"number":         int(iid),
			"title":          title,
			"url":            url,
			"state":          strings.ToLower(state),
			"isDraft":        false,
			"headRefName":    data["source_branch"],
			"baseRefName":    data["target_branch"],
			"updatedAt":      time.Now().UTC().Format(time.RFC3339Nano),
			"mergeable":      "UNKNOWN",
			"reviewDecision": nil,
			"checks":         []any{},
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
