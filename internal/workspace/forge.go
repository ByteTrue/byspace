package workspace

import (
	"bytes"
	"context"
	"encoding/json"
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
func SetAutoMerge(ctx context.Context, cwd string, enabled bool) error {
	if enabled {
		_, err := runGH(ctx, cwd, "pr", "merge", "--auto", "--merge")
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
