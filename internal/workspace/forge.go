package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ByteTrue/byspace/internal/proc"
	"net/url"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

// forgeCommandTimeout bounds one gh/glab/tea invocation: Node's GITHUB_COMMAND_TIMEOUT_MS,
// GLAB_COMMAND_TIMEOUT_MS and TEA_COMMAND_TIMEOUT_MS, all 30 seconds. Go had 5, so a merge or a
// PR status read on a slow network failed where Node waited. The auth probe keeps its own 10s.
const forgeCommandTimeout = 30 * time.Second

func runForgeCLI(ctx context.Context, bin, cwd string, args ...string) (string, error) {
	out, _, err := runForgeCLIWithStderr(ctx, forgeCommandTimeout, bin, cwd, args...)
	return out, err
}

// runForgeCLIWithStderr also returns stderr, which is where the forge CLIs say why they failed.
func runForgeCLIWithStderr(ctx context.Context, timeout time.Duration, bin, cwd string, args ...string) (string, string, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := proc.CommandContext(cctx, bin, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return "", errBuf.String(), err
	}
	return strings.TrimSpace(out.String()), errBuf.String(), nil
}

func runGH(ctx context.Context, cwd string, args ...string) (string, error) {
	return runForgeCLI(ctx, "gh", cwd, args...)
}

// OriginRemoteURL returns the URL the user configured for origin.
//
// `git remote get-url` is deliberately not used: it applies `url.<base>.insteadOf` rewriting, so a
// repository that redirects a hosted forge to a local mirror answers with the mirror's path. That
// value is right for fetching and wrong for everything that has to name the host — forge detection,
// the client's pasted-URL matching, and the remote URL the checkout status reports — which is why
// the Node server reads `config remote.origin.url` too.
func OriginRemoteURL(ctx context.Context, cwd string) string {
	if out, err := runGit(ctx, cwd, "config", "--get", "remote.origin.url"); err == nil {
		if trimmed := strings.TrimSpace(out); trimmed != "" {
			return trimmed
		}
	}
	out, err := runGit(ctx, cwd, "remote", "get-url", "origin")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// DetectForge inspects the origin remote URL to classify the git forge ("github", "gitlab", or "gitea").
func DetectForge(ctx context.Context, cwd string) string {
	remote := OriginRemoteURL(ctx, cwd)
	if remote == "" {
		return "github"
	}
	return ForgeForRemote(remote)
}

// forgeCloudHosts maps the public hosts each forge owns exactly.
//
// Ported from forge-manifest's cloudHosts. An exact list is the point: matching on substrings
// means a GitHub repository called `gitlab-mirror` is detected as GitLab, and every gh call for
// it is then run through glab.
var forgeCloudHosts = map[string]string{
	"github.com":     "github",
	"ssh.github.com": "github",
	"gitlab.com":     "gitlab",
	"gitea.com":      "gitea",
	"codeberg.org":   "gitea",
}

// selfHostedHostHints catch the common self-hosted naming without a network probe.
//
// Checked only after the exact list fails, and only on the host — never on the path, which is
// what produced the `gitlab-mirror` bug.
var selfHostedHostHints = []struct {
	fragment string
	forge    string
}{
	{"gitlab", "gitlab"},
	{"gitea", "gitea"},
	{"codeberg", "gitea"},
	{"forgejo", "gitea"},
}

// ForgeForRemote resolves a forge from a git remote URL.
func ForgeForRemote(remote string) string {
	host := remoteHost(remote)
	if host == "" {
		return "github"
	}
	if forge, ok := forgeCloudHosts[host]; ok {
		return forge
	}
	for _, hint := range selfHostedHostHints {
		if strings.Contains(host, hint.fragment) {
			return hint.forge
		}
	}
	// A host we do not recognise: GitHub is the overwhelmingly common case, and the caller falls
	// back to the forge CLI's own error if it is wrong.
	return "github"
}

// remoteHost extracts the host from any of git's remote URL shapes.
//
// Handles `https://host/path`, `ssh://git@host:port/path`, `git@host:path` (scp syntax) and bare
// `host:path`. Returns the lowercased host with any port stripped.
func remoteHost(remote string) string {
	trimmed := strings.TrimSpace(remote)
	if trimmed == "" {
		return ""
	}

	// scheme://[user@]host[:port]/path
	if index := strings.Index(trimmed, "://"); index >= 0 {
		rest := trimmed[index+3:]
		if slash := strings.Index(rest, "/"); slash >= 0 {
			rest = rest[:slash]
		}
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			rest = rest[at+1:]
		}
		if colon := strings.LastIndex(rest, ":"); colon >= 0 {
			rest = rest[:colon]
		}
		return strings.ToLower(rest)
	}

	// [user@]host:path — scp syntax. The first colon separates host from path.
	if at := strings.LastIndex(trimmed, "@"); at >= 0 {
		rest := trimmed[at+1:]
		if colon := strings.Index(rest, ":"); colon >= 0 {
			return strings.ToLower(rest[:colon])
		}
		return strings.ToLower(rest)
	}
	if colon := strings.Index(trimmed, ":"); colon >= 0 {
		head := trimmed[:colon]
		// A Windows drive letter (C:\repo) is not a host.
		if len(head) == 1 && (head[0] >= 'a' && head[0] <= 'z' || head[0] >= 'A' && head[0] <= 'Z') {
			return ""
		}
		return strings.ToLower(head)
	}
	// A bare path with no host: local repository, no forge.
	if strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, ".") {
		return ""
	}
	return strings.ToLower(trimmed)
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
	raw, err := currentGitHubPRView(ctx, cwd)
	if err != nil || raw == "" {
		return nil, nil
	}
	var item gitHubPRViewItem
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		return nil, nil
	}
	return gitHubPRStatus(item, time.Now()), nil
}

// The fields Node read for the current branch's PR (github-service.ts CURRENT_PR_STATUS_FIELDS).
// statusCheckRollup is a separate field because a token without checks scope fails the whole
// query when it is asked for; the status is then read without checks.
const gitHubPRStatusBaseFields = "number,url,title,state,isDraft,baseRefName,headRefName,headRefOid,mergedAt,reviewDecision,mergeable,headRepositoryOwner"

func currentGitHubPRView(ctx context.Context, cwd string) (string, error) {
	out, stderr, err := runForgeCLIWithStderr(ctx, forgeCommandTimeout, "gh", cwd,
		"pr", "view", "--json", gitHubPRStatusBaseFields+",statusCheckRollup")
	if err != nil {
		if !strings.Contains(strings.ToLower(stderr), "statuscheckrollup") {
			return "", err
		}
		return runGH(ctx, cwd, "pr", "view", "--json", gitHubPRStatusBaseFields)
	}
	return out, nil
}

type gitHubPRViewItem struct {
	Number            int                     `json:"number"`
	URL               string                  `json:"url"`
	Title             string                  `json:"title"`
	State             string                  `json:"state"`
	IsDraft           bool                    `json:"isDraft"`
	BaseRefName       string                  `json:"baseRefName"`
	HeadRefName       string                  `json:"headRefName"`
	MergedAt          string                  `json:"mergedAt"`
	ReviewDecision    string                  `json:"reviewDecision"`
	Mergeable         string                  `json:"mergeable"`
	StatusCheckRollup []gitHubStatusCheckNode `json:"statusCheckRollup"`
}

type gitHubStatusCheckNode struct {
	Typename     string `json:"__typename"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	Conclusion   string `json:"conclusion"`
	DetailsURL   string `json:"detailsUrl"`
	WorkflowName string `json:"workflowName"`
	StartedAt    string `json:"startedAt"`
	CompletedAt  string `json:"completedAt"`
	Context      string `json:"context"`
	State        string `json:"state"`
	TargetURL    string `json:"targetUrl"`
}

// gitHubPRStatus is Node's toCurrentPullRequestStatus (github-service.ts): a merged PR reports
// state "merged" and isMerged, checks come from the status check rollup, and the review decision
// is mapped to the protocol's lowercase values.
func gitHubPRStatus(item gitHubPRViewItem, now time.Time) map[string]any {
	if item.URL == "" || item.Title == "" || item.Number <= 0 {
		return nil
	}
	merged := strings.TrimSpace(item.MergedAt) != ""
	state := strings.ToLower(strings.TrimSpace(item.State))
	if merged {
		state = "merged"
	}
	mergeable := item.Mergeable
	if mergeable != "MERGEABLE" && mergeable != "CONFLICTING" {
		mergeable = "UNKNOWN"
	}
	checks := gitHubPRChecks(item.StatusCheckRollup, now)
	status := map[string]any{
		"number":         item.Number,
		"url":            item.URL,
		"title":          item.Title,
		"state":          state,
		"baseRefName":    item.BaseRefName,
		"headRefName":    item.HeadRefName,
		"isMerged":       merged,
		"isDraft":        item.IsDraft,
		"mergeable":      mergeable,
		"checks":         checks,
		"checksStatus":   gitHubChecksStatus(checks),
		"reviewDecision": gitHubReviewDecision(item.ReviewDecision),
	}
	if owner, name, ok := gitHubPRRepo(item.URL); ok {
		status["repoOwner"] = owner
		status["repoName"] = name
	}
	return status
}

// gitHubPRRepo reads owner/name from a PR URL's `/owner/name/pull/N` path, on any host, so a
// GitHub Enterprise URL works too.
func gitHubPRRepo(raw string) (string, string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", "", false
	}
	var parts []string
	for _, part := range strings.Split(parsed.Path, "/") {
		if part != "" {
			parts = append(parts, part)
		}
	}
	if len(parts) < 3 || parts[2] != "pull" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// gitHubPRChecks is Node's parseStatusCheckRollup: one check per name, the most recent run wins,
// in the order the rollup first lists each name.
func gitHubPRChecks(nodes []gitHubStatusCheckNode, now time.Time) []map[string]any {
	checks := []map[string]any{}
	index := map[string]int{}
	recency := map[string]int64{}
	for _, node := range nodes {
		check, rank, ok := gitHubPRCheck(node, now)
		if !ok {
			continue
		}
		name, _ := check["name"].(string)
		if at, seen := index[name]; seen {
			if rank > recency[name] {
				checks[at] = check
				recency[name] = rank
			}
			continue
		}
		index[name] = len(checks)
		recency[name] = rank
		checks = append(checks, check)
	}
	return checks
}

func gitHubPRCheck(node gitHubStatusCheckNode, now time.Time) (map[string]any, int64, bool) {
	switch node.Typename {
	case "CheckRun":
		if node.Name == "" {
			return nil, 0, false
		}
		check := map[string]any{
			"name":   node.Name,
			"status": gitHubCheckRunStatus(node.Status, node.Conclusion),
			"url":    nullableString(node.DetailsURL),
		}
		if strings.TrimSpace(node.WorkflowName) != "" {
			check["workflow"] = node.WorkflowName
		}
		if duration, ok := gitHubCheckRunDuration(node, now); ok {
			check["duration"] = duration
		}
		recency := parseCheckTime(node.CompletedAt)
		if recency == 0 {
			recency = parseCheckTime(node.StartedAt)
		}
		return check, recency, true
	case "StatusContext":
		if node.Context == "" {
			return nil, 0, false
		}
		return map[string]any{
			"name":   node.Context,
			"status": gitHubStatusContextState(node.State),
			"url":    nullableString(node.TargetURL),
		}, parseCheckTime(node.StartedAt), true
	}
	return nil, 0, false
}

func parseCheckTime(value string) int64 {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil || t.IsZero() || t.Year() < 1971 {
		return 0
	}
	return t.UnixMilli()
}

func gitHubCheckRunStatus(status, conclusion string) string {
	if status != "COMPLETED" {
		return "pending"
	}
	switch conclusion {
	case "SUCCESS":
		return "success"
	case "FAILURE", "TIMED_OUT", "ACTION_REQUIRED":
		return "failure"
	case "CANCELLED":
		return "cancelled"
	case "SKIPPED", "NEUTRAL":
		return "skipped"
	}
	return "pending"
}

func gitHubStatusContextState(state string) string {
	switch state {
	case "SUCCESS":
		return "success"
	case "FAILURE", "ERROR":
		return "failure"
	}
	return "pending"
}

// gitHubCheckRunDuration is how long a finished run took, or how long a running one has been
// going, as "1h 2m 3s" (Node's formatCheckRunDuration).
func gitHubCheckRunDuration(node gitHubStatusCheckNode, now time.Time) (string, bool) {
	started := parseCheckTime(node.StartedAt)
	if started <= 0 {
		return "", false
	}
	ended := parseCheckTime(node.CompletedAt)
	if ended <= 0 {
		ended = now.UnixMilli()
	}
	if ended < started {
		return "", false
	}
	total := (ended - started) / 1000
	hours, minutes, seconds := total/3600, (total%3600)/60, total%60
	var parts []string
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
	}
	if seconds > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%ds", seconds))
	}
	return strings.Join(parts, " "), true
}

func gitHubChecksStatus(checks []map[string]any) string {
	if len(checks) == 0 {
		return "none"
	}
	pending := false
	for _, check := range checks {
		switch check["status"] {
		case "failure":
			return "failure"
		case "pending":
			pending = true
		}
	}
	if pending {
		return "pending"
	}
	return "success"
}

func gitHubReviewDecision(value string) any {
	switch value {
	case "APPROVED":
		return "approved"
	case "CHANGES_REQUESTED":
		return "changes_requested"
	case "REVIEW_REQUIRED":
		return "pending"
	}
	return nil
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
// MergeReadiness is why a pull request may or may not be merged right now.
//
// Ported from assertDirectPullRequestMergeReady. Without these guards the merge button is offered
// whenever the branch has a PR, and the user finds out from gh's raw error — or, worse, merges in
// a state the repository did not intend.
type MergeReadiness struct {
	Ready bool
	// Reason is the user-facing explanation when Ready is false.
	Reason string
}

// mergeStateAllowlist are the GitHub merge states that mean "safe to merge now".
//
// CLEAN is a mergeable branch with passing required checks. HAS_HOOKS means the same but with
// hooks configured. Everything else (BLOCKED, BEHIND, DIRTY, DRAFT, UNSTABLE) needs the user to
// act first, and GitHub would refuse anyway.
var mergeStateAllowlist = map[string]bool{"CLEAN": true, "HAS_HOOKS": true}

// CheckMergeReadiness asks GitHub whether a direct merge is allowed now.
//
// Returns Ready=true when the forge does not report the facts (a forge other than GitHub, or an
// older CLI): refusing on missing information would block merging on every forge we cannot query.
func CheckMergeReadiness(ctx context.Context, cwd, method string) MergeReadiness {
	if _, err := exec.LookPath("gh"); err != nil {
		return MergeReadiness{Ready: true}
	}
	raw, err := runGH(ctx, cwd, "pr", "view", "--json",
		"mergeStateStatus,isInMergeQueue,autoMergeRequest,"+
			"mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed")
	if err != nil || strings.TrimSpace(raw) == "" {
		return MergeReadiness{Ready: true}
	}
	var facts struct {
		MergeStateStatus   *string `json:"mergeStateStatus"`
		IsInMergeQueue     bool    `json:"isInMergeQueue"`
		AutoMergeRequest   any     `json:"autoMergeRequest"`
		MergeCommitAllowed bool    `json:"mergeCommitAllowed"`
		SquashMergeAllowed bool    `json:"squashMergeAllowed"`
		RebaseMergeAllowed bool    `json:"rebaseMergeAllowed"`
	}
	if json.Unmarshal([]byte(raw), &facts) != nil {
		return MergeReadiness{Ready: true}
	}

	if facts.MergeStateStatus != nil && !mergeStateAllowlist[*facts.MergeStateStatus] {
		return MergeReadiness{
			Reason: "GitHub does not report this pull request as ready for direct merge (" +
				*facts.MergeStateStatus + ")",
		}
	}
	if facts.IsInMergeQueue {
		return MergeReadiness{Reason: "Direct merge is not available because this pull request is in the merge queue"}
	}
	if facts.AutoMergeRequest != nil {
		return MergeReadiness{Reason: "Direct merge is not available because auto-merge is already enabled"}
	}
	// The repository decides which methods exist; offering a disabled one means the button is
	// there and the merge fails.
	switch strings.ToLower(strings.TrimSpace(method)) {
	case "squash":
		if !facts.SquashMergeAllowed {
			return MergeReadiness{Reason: "Direct merge is not available because squash merging is disabled"}
		}
	case "rebase":
		if !facts.RebaseMergeAllowed {
			return MergeReadiness{Reason: "Direct merge is not available because rebase merging is disabled"}
		}
	case "", "merge":
		if !facts.MergeCommitAllowed {
			return MergeReadiness{Reason: "Direct merge is not available because merge commits are disabled"}
		}
	}
	return MergeReadiness{Ready: true}
}

func MergePR(ctx context.Context, cwd, method string) error {
	// Checked here rather than only in the UI: the RPC is reachable directly, and the CLI calls
	// it too.
	if readiness := CheckMergeReadiness(ctx, cwd, method); !readiness.Ready {
		return errors.New(readiness.Reason)
	}

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

// ForgeSearchItem is one row of `forge.search.response`.
//
// The shape is the wire contract (GitHubSearchItemSchema extended with the neutral kinds), not a
// convenience: a field the client requires but the daemon omits makes the client reject the whole
// response, so search silently looked empty.
type ForgeSearchItem struct {
	Kind        string   `json:"kind"` // "issue" | "change_request"
	Number      int      `json:"number"`
	Title       string   `json:"title"`
	URL         string   `json:"url"`
	State       string   `json:"state"`
	Body        *string  `json:"body"`
	Labels      []string `json:"labels"`
	BaseRefName *string  `json:"baseRefName"`
	HeadRefName *string  `json:"headRefName"`
	UpdatedAt   string   `json:"updatedAt,omitempty"`
	Forge       string   `json:"forge,omitempty"`
}

// SearchIssuesAndPullRequests searches change requests and issues in the repository's forge.
//
// `forge.search.request` is what the starting-ref picker calls; it answered with an empty list
// unconditionally, and the rows it did return carried `kind: "pull_request"` — a value the wire
// enum does not contain — so the client discarded the response.
func SearchIssuesAndPullRequests(ctx context.Context, cwd, query string, limit int, kinds []string) ([]ForgeSearchItem, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	wantIssues, wantChangeRequests := normalizeForgeSearchKinds(kinds)
	if !wantIssues && !wantChangeRequests {
		return []ForgeSearchItem{}, nil
	}
	forge := DetectForge(ctx, cwd)
	limitArg := strconv.Itoa(limit)

	var (
		items []ForgeSearchItem
		err   error
	)
	switch forge {
	case "gitlab":
		items, err = searchGitLabIssues(ctx, cwd, query, limitArg, wantIssues, wantChangeRequests)
	case "gitea":
		items, err = searchGiteaIssues(ctx, cwd, query, limitArg, wantIssues, wantChangeRequests)
	default:
		items, err = searchGitHubItems(ctx, cwd, query, limitArg, wantIssues, wantChangeRequests)
	}
	if err != nil {
		return []ForgeSearchItem{}, err
	}
	for index := range items {
		items[index].Forge = forge
	}
	// Newest first: the picker lists rows in the order the daemon sent them, and the row a user
	// wants is almost always the change request they just opened.
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].UpdatedAt > items[j].UpdatedAt
	})
	return items, nil
}

// normalizeForgeSearchKinds maps the legacy GitHub kind aliases onto the neutral pair.
//
// COMPAT(githubSearchKind): the aliases shipped with the legacy github_search_request RPC; remove
// together with it after 2027-01-17.
func normalizeForgeSearchKinds(kinds []string) (issues, changeRequests bool) {
	if len(kinds) == 0 {
		return true, true
	}
	for _, kind := range kinds {
		switch strings.ToLower(strings.TrimSpace(kind)) {
		case "issue", "github-issue":
			issues = true
		case "change_request", "github-pr", "pr", "pull_request":
			changeRequests = true
		}
	}
	return issues, changeRequests
}

func searchGitHubItems(ctx context.Context, cwd, query, limitArg string, wantIssues, wantChangeRequests bool) ([]ForgeSearchItem, error) {
	if _, err := exec.LookPath("gh"); err != nil {
		return nil, fmt.Errorf("gh is not installed")
	}
	var items []ForgeSearchItem
	if wantChangeRequests {
		args := []string{"pr", "list", "--limit", limitArg,
			"--json", "number,title,url,state,body,labels,baseRefName,headRefName,updatedAt"}
		if trimmed := strings.TrimSpace(query); trimmed != "" {
			args = append(args, "--search", trimmed)
		}
		raw, err := runGH(ctx, cwd, args...)
		if err != nil {
			return nil, err
		}
		decoded, err := decodeGitHubItems(raw, "change_request", true)
		if err != nil {
			return nil, err
		}
		items = append(items, decoded...)
	}
	if wantIssues {
		args := []string{"issue", "list", "--limit", limitArg,
			"--json", "number,title,url,state,body,labels,updatedAt"}
		if trimmed := strings.TrimSpace(query); trimmed != "" {
			args = append(args, "--search", trimmed)
		}
		raw, err := runGH(ctx, cwd, args...)
		if err != nil {
			// An issue search failing must not hide the change requests that did resolve, which
			// are the rows the starting-ref picker actually shows.
			if len(items) == 0 {
				return nil, err
			}
			return items, nil
		}
		decoded, err := decodeGitHubItems(raw, "issue", false)
		if err != nil {
			if len(items) == 0 {
				return nil, err
			}
			return items, nil
		}
		items = append(items, decoded...)
	}
	return items, nil
}

func decodeGitHubItems(raw, kind string, withRefs bool) ([]ForgeSearchItem, error) {
	if strings.TrimSpace(raw) == "" {
		return []ForgeSearchItem{}, nil
	}
	var rows []struct {
		Number      int    `json:"number"`
		Title       string `json:"title"`
		URL         string `json:"url"`
		State       string `json:"state"`
		Body        string `json:"body"`
		UpdatedAt   string `json:"updatedAt"`
		BaseRefName string `json:"baseRefName"`
		HeadRefName string `json:"headRefName"`
		Labels      []struct {
			Name string `json:"name"`
		} `json:"labels"`
	}
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return []ForgeSearchItem{}, err
	}
	out := make([]ForgeSearchItem, 0, len(rows))
	for _, row := range rows {
		if row.Title == "" && row.URL == "" {
			continue
		}
		item := ForgeSearchItem{
			Kind:      kind,
			Number:    row.Number,
			Title:     row.Title,
			URL:       row.URL,
			State:     row.State,
			Body:      emptyToNil(row.Body),
			Labels:    labelNames(row.Labels),
			UpdatedAt: row.UpdatedAt,
		}
		if withRefs {
			item.BaseRefName = emptyToNil(row.BaseRefName)
			item.HeadRefName = emptyToNil(row.HeadRefName)
		}
		out = append(out, item)
	}
	return out, nil
}

func searchGitLabIssues(ctx context.Context, cwd, query, limitArg string, wantIssues, wantChangeRequests bool) ([]ForgeSearchItem, error) {
	if _, err := exec.LookPath("glab"); err != nil {
		return nil, fmt.Errorf("glab is not installed")
	}
	var items []ForgeSearchItem
	if wantIssues {
		raw, err := runForgeCLI(ctx, "glab", cwd, "api",
			fmt.Sprintf("projects/:id/issues?search=%s&per_page=%s", url.QueryEscape(query), limitArg))
		if err != nil && len(items) == 0 && !wantChangeRequests {
			return nil, err
		}
		if err == nil {
			decoded, decodeErr := decodeForgeItems(raw, "issue", "web_url", false)
			if decodeErr != nil && !wantChangeRequests {
				return nil, decodeErr
			}
			items = append(items, decoded...)
		}
	}
	if wantChangeRequests {
		raw, err := runForgeCLI(ctx, "glab", cwd, "api",
			fmt.Sprintf("projects/:id/merge_requests?search=%s&per_page=%s", url.QueryEscape(query), limitArg))
		if err != nil {
			if len(items) == 0 {
				return nil, err
			}
			return items, nil
		}
		decoded, decodeErr := decodeForgeItems(raw, "change_request", "web_url", true)
		if decodeErr != nil {
			if len(items) == 0 {
				return nil, decodeErr
			}
			return items, nil
		}
		items = append(items, decoded...)
	}
	return items, nil
}

func searchGiteaIssues(ctx context.Context, cwd, query, limitArg string, wantIssues, wantChangeRequests bool) ([]ForgeSearchItem, error) {
	if _, err := exec.LookPath("tea"); err != nil {
		return nil, fmt.Errorf("tea is not installed")
	}
	var items []ForgeSearchItem
	if wantIssues {
		raw, err := runForgeCLI(ctx, "tea", cwd, "issues", "list", "--search", query, "--limit", limitArg, "--output", "json")
		if err != nil && !wantChangeRequests {
			return nil, err
		}
		if err == nil {
			decoded, decodeErr := decodeForgeItems(raw, "issue", "html_url", false)
			if decodeErr != nil && !wantChangeRequests {
				return nil, decodeErr
			}
			items = append(items, decoded...)
		}
	}
	if wantChangeRequests {
		raw, err := runForgeCLI(ctx, "tea", cwd, "pulls", "list", "--search", query, "--limit", limitArg, "--output", "json")
		if err != nil {
			if len(items) == 0 {
				return nil, err
			}
			return items, nil
		}
		decoded, decodeErr := decodeForgeItems(raw, "change_request", "html_url", true)
		if decodeErr != nil {
			if len(items) == 0 {
				return nil, decodeErr
			}
			return items, nil
		}
		items = append(items, decoded...)
	}
	return items, nil
}

// decodeForgeItems normalizes glab's and tea's JSON into the wire item shape.
func decodeForgeItems(raw, kind, urlKey string, withRefs bool) ([]ForgeSearchItem, error) {
	if strings.TrimSpace(raw) == "" {
		return []ForgeSearchItem{}, nil
	}
	var rows []map[string]any
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return []ForgeSearchItem{}, err
	}
	out := make([]ForgeSearchItem, 0, len(rows))
	for _, row := range rows {
		title, _ := row["title"].(string)
		link, _ := row[urlKey].(string)
		if title == "" && link == "" {
			continue
		}
		item := ForgeSearchItem{
			Kind:      kind,
			Title:     title,
			URL:       link,
			State:     stringField(row, "state"),
			Body:      emptyToNil(stringField(row, "description")),
			Labels:    []string{},
			UpdatedAt: firstStringField(row, "updated_at", "updatedAt"),
		}
		if raw, ok := row["number"].(float64); ok {
			item.Number = int(raw)
		}
		if withRefs {
			item.HeadRefName = emptyToNil(stringField(row, "source_branch"))
			item.BaseRefName = emptyToNil(stringField(row, "target_branch"))
		}
		out = append(out, item)
	}
	return out, nil
}

func stringField(row map[string]any, key string) string {
	value, _ := row[key].(string)
	return value
}

func firstStringField(row map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := row[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

// emptyToNil keeps an empty value as an explicit null: the wire schema declares these fields
// nullable, and omitting `body` makes the client's parse fail on a required key.
func emptyToNil(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	trimmed := value
	return &trimmed
}

func labelNames(labels []struct {
	Name string `json:"name"`
}) []string {
	names := make([]string, 0, len(labels))
	for _, label := range labels {
		if label.Name != "" {
			names = append(names, label.Name)
		}
	}
	return names
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
		// The GraphQL query, not `gh pr view`: the checkout gate needs the head repository, and
		// only this query returns it alongside the base ref. Without it a PR from a fork looked
		// local, so its author's byspace.json was trusted.
		repoRaw, err := runGH(ctx, repoCwd, "repo", "view", "--json", "owner,name")
		if err != nil {
			return ChangeRequestCheckoutTarget{}, err
		}
		var repoView struct {
			Owner struct {
				Login string `json:"login"`
			} `json:"owner"`
			Name string `json:"name"`
		}
		if json.Unmarshal([]byte(repoRaw), &repoView) != nil || repoView.Owner.Login == "" || repoView.Name == "" {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("unable to resolve repository for pull request checkout")
		}
		raw, err := runGH(ctx, repoCwd, "api", "graphql",
			"-f", "query="+pullRequestCheckoutTargetQuery,
			"-F", "owner="+repoView.Owner.Login,
			"-F", "name="+repoView.Name,
			"-F", "number="+numberArg)
		if err != nil {
			return ChangeRequestCheckoutTarget{}, err
		}
		var result struct {
			Data struct {
				Repository struct {
					PullRequest struct {
						BaseRefName         string `json:"baseRefName"`
						HeadRefName         string `json:"headRefName"`
						IsCrossRepository   bool   `json:"isCrossRepository"`
						HeadRepositoryOwner struct {
							Login string `json:"login"`
						} `json:"headRepositoryOwner"`
						HeadRepository struct {
							SSHURL string `json:"sshUrl"`
							URL    string `json:"url"`
						} `json:"headRepository"`
					} `json:"pullRequest"`
				} `json:"repository"`
			} `json:"data"`
		}
		if json.Unmarshal([]byte(raw), &result) != nil {
			return ChangeRequestCheckoutTarget{}, fmt.Errorf("could not read pull request %d", number)
		}
		pull := result.Data.Repository.PullRequest
		owner := strings.TrimSpace(pull.HeadRepositoryOwner.Login)
		return ChangeRequestCheckoutTarget{
			HeadRef:           pull.HeadRefName,
			BaseRefName:       pull.BaseRefName,
			IsCrossRepository: pull.IsCrossRepository,
			HeadRepository:    headRepositoryName(owner, pull.HeadRepository.URL, pull.HeadRepository.SSHURL),
		}, nil
	}
}

// pullRequestCheckoutTargetQuery is the forge's own checkout-target query, ported verbatim.
//
// It is a constant rather than a `gh pr view --json` field list because the REST-shaped field
// set does not expose the head repository's owner and URL, which is exactly what decides whether
// a checkout is cross-repository.
const pullRequestCheckoutTargetQuery = `
query PullRequestCheckoutTarget($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      baseRefName
      headRefName
      isCrossRepository
      headRepositoryOwner {
        login
      }
      headRepository {
        sshUrl
        url
      }
    }
  }
}`

// headRepositoryName reports "owner/repo" for a change request's head repository.
//
// The owner comes from the login when GitHub sent one, otherwise from the second-to-last path
// segment: forks are identified by owner, and a clone URL is the only place it appears.
func headRepositoryName(owner, httpsURL, sshURL string) string {
	raw := httpsURL
	if raw == "" {
		raw = sshURL
	}
	if raw == "" {
		return owner
	}
	path := strings.TrimSuffix(raw, ".git")
	sanitized := strings.NewReplacer(":", "/", "//", "/").Replace(path)
	segments := []string{}
	for _, segment := range strings.Split(sanitized, "/") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) == 0 {
		return owner
	}
	repository := segments[len(segments)-1]
	if owner == "" && len(segments) >= 2 {
		owner = segments[len(segments)-2]
	}
	if owner == "" {
		return repository
	}
	return owner + "/" + repository
}

// PullRequestTimeline fetches a PR's comments and reviews.
//
// Ported from the forge services' getPullRequestTimeline. The checkout panel shows it as one
// chronological thread, so a review and a comment have to arrive in the same shape — the client
// discriminates on `kind` and would otherwise render a review as an empty comment.
//
// `truncated` is reported rather than silently dropping: a long thread that stops at the limit
// without saying so looks like the conversation ended.
//
// owner and name identify the GitHub repository (the GraphQL query needs them); the other forges
// resolve the repository from cwd.
func PullRequestTimeline(ctx context.Context, forge, cwd, owner, name string, number, limit int) ([]map[string]any, bool, error) {
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
		return gitHubPullRequestTimeline(ctx, cwd, owner, name, number)
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
