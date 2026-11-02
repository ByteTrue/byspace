package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The current branch's pull request on GitHub, ported from resolveCurrentPullRequestView and
// pickPullRequestCandidate in the archived Node daemon's github-service.ts. The PR panel's status
// request and the background PR status poll both resolve through here, so the sidebar and the
// panel always agree on which PR a checkout has.

// gitHubPRCommandError is a failed gh command with what it printed.
type gitHubPRCommandError struct {
	args   []string
	stderr string
	stdout string
	err    error
}

func (e *gitHubPRCommandError) Error() string {
	if message := strings.TrimSpace(e.stderr); message != "" {
		return message
	}
	return e.err.Error()
}

func (e *gitHubPRCommandError) Unwrap() error { return e.err }

// runGitHubCommand runs gh for a checkout and keeps stdout on failure: `gh api graphql` exits
// non-zero when one aliased query in a batch fails, and still prints the others. A variable so
// tests can stand in for gh.
var runGitHubCommand = func(ctx context.Context, cwd string, args ...string) (string, error) {
	if _, err := exec.LookPath("gh"); err != nil {
		return "", &GitHubCLIError{Kind: GitHubCLIMissing, message: "GitHub CLI (gh) is not installed or not in PATH"}
	}
	var env []string
	if cwd != "" {
		host, err := gitHubRoutingHost(ctx, cwd)
		if err != nil {
			return "", err
		}
		if host != "" {
			env = append(ghProbeEnv(), "GH_HOST="+host)
		}
	}
	stdout, stderr, err := runForgeCommandKeepingStdout(ctx, forgeCommandTimeout, "gh", cwd, env, args...)
	if err != nil {
		return "", &gitHubPRCommandError{args: args, stderr: stderr, stdout: stdout, err: err}
	}
	return stdout, nil
}

func isNoPullRequestFoundError(err error) bool {
	var commandErr *gitHubPRCommandError
	return errors.As(err, &commandErr) && strings.Contains(strings.ToLower(commandErr.stderr), "no pull requests found")
}

func isStatusCheckRollupPermissionError(err error) bool {
	var commandErr *gitHubPRCommandError
	return errors.As(err, &commandErr) && strings.Contains(strings.ToLower(commandErr.stderr), "statuscheckrollup")
}

// runGitHubPRStatusCommand asks for the status fields, and again without the checks when the token
// cannot read them.
func runGitHubPRStatusCommand(ctx context.Context, cwd string, args []string) (string, error) {
	out, err := runGitHubCommand(ctx, cwd, append(append([]string(nil), args...), "--json", gitHubPRStatusBaseFields+",statusCheckRollup")...)
	if err == nil || !isStatusCheckRollupPermissionError(err) {
		return out, err
	}
	return runGitHubCommand(ctx, cwd, append(append([]string(nil), args...), "--json", gitHubPRStatusBaseFields)...)
}

// prCandidate is a pull request that could be the checkout's.
type prCandidate struct {
	status    map[string]any
	headSha   string
	headOwner string
	// index is the candidate's position in the batch response it came from.
	index int
}

func newPRCandidate(item gitHubPRViewItem, fallbackHeadRef string, now time.Time) *prCandidate {
	status := gitHubPRStatusWithHeadRef(item, fallbackHeadRef, now)
	if status == nil {
		return nil
	}
	return &prCandidate{status: status, headSha: item.HeadRefOid, headOwner: item.HeadRepositoryOwner.Login}
}

// pickPRCandidate is Node's pickPullRequestCandidate. A candidate must be for the head branch and
// name its repository; an open PR always counts, a merged or closed one only while the checkout is
// still on its head commit; a fork owner, when known, must match. Open (or draft) beats merged beats
// closed, then an exact head commit wins.
func pickPRCandidate(candidates []prCandidate, headRef, headSha, headOwner string) *prCandidate {
	var matching []prCandidate
	for _, candidate := range candidates {
		if candidate.status["headRefName"] != headRef || !prStatusNamesRepo(candidate.status) {
			continue
		}
		if candidate.status["state"] != "open" && (headSha == "" || candidate.headSha != headSha) {
			continue
		}
		if headOwner != "" && candidate.headOwner != headOwner {
			continue
		}
		matching = append(matching, candidate)
	}
	sort.SliceStable(matching, func(i, j int) bool {
		left, right := prStateRank(matching[i].status), prStateRank(matching[j].status)
		if left != right {
			return left < right
		}
		leftExact := headSha != "" && matching[i].headSha == headSha
		rightExact := headSha != "" && matching[j].headSha == headSha
		return leftExact && !rightExact
	})
	if len(matching) == 0 {
		return nil
	}
	return &matching[0]
}

func prStatusNamesRepo(status map[string]any) bool {
	owner, _ := status["repoOwner"].(string)
	name, _ := status["repoName"].(string)
	return owner != "" && name != ""
}

func prStateRank(status map[string]any) int {
	if status["state"] == "open" || status["isDraft"] == true {
		return 0
	}
	if status["state"] == "merged" {
		return 1
	}
	return 2
}

// currentGitHubPullRequest resolves the checkout's PR: `gh pr view <branch>` first, then, when that
// is not the checkout's (a fork's PR, or an old PR for a reused branch name), the branch's PRs in
// every state, in the parent repository for a fork. nil means the checkout has no PR.
func currentGitHubPullRequest(ctx context.Context, cwd string, target PRLookupTarget) (map[string]any, error) {
	status, err := resolveCurrentGitHubPullRequest(ctx, cwd, target)
	if err != nil || status == nil {
		return status, err
	}
	return withGitHubPRFacts(ctx, cwd, status)
}

func resolveCurrentGitHubPullRequest(ctx context.Context, cwd string, target PRLookupTarget) (map[string]any, error) {
	now := time.Now()
	slug := gitHubRepoFromRemote(OriginRemoteURL(ctx, cwd))

	viewArgs := []string{"pr", "view"}
	if slug != "" {
		viewArgs = []string{"pr", "view", target.HeadRef, "--repo", slug}
	}
	out, err := runGitHubPRStatusCommand(ctx, cwd, viewArgs)
	switch {
	case err == nil:
		var item gitHubPRViewItem
		if strings.TrimSpace(out) != "" {
			if jsonErr := json.Unmarshal([]byte(out), &item); jsonErr != nil {
				return nil, jsonErr
			}
		}
		if candidate := newPRCandidate(item, target.HeadRef, now); candidate != nil {
			if match := pickPRCandidate([]prCandidate{*candidate}, target.HeadRef, target.HeadSha, target.HeadRepositoryOwner); match != nil {
				return match.status, nil
			}
		}
	case !isNoPullRequestFoundError(err):
		return nil, err
	}

	listHeadRef := target.HeadRef
	listRepo := slug
	headOwner := target.HeadRepositoryOwner
	if headOwner == "" {
		repoView, err := gitHubRepoView(ctx, cwd)
		if err != nil {
			return nil, err
		}
		if repoView == nil || repoView.Owner.Login == "" {
			return nil, nil
		}
		if repoView.Parent != nil && repoView.Parent.Owner.Login != "" && repoView.Parent.Name != "" {
			listHeadRef = repoView.Owner.Login + ":" + target.HeadRef
			listRepo = repoView.Parent.Owner.Login + "/" + repoView.Parent.Name
		}
		headOwner = repoView.Owner.Login
	}

	listArgs := []string{"pr", "list"}
	if listRepo != "" {
		listArgs = append(listArgs, "--repo", listRepo)
	}
	listArgs = append(listArgs, "--state", "all", "--head", listHeadRef, "--limit", "10")
	out, err = runGitHubPRStatusCommand(ctx, cwd, listArgs)
	if err != nil {
		if isNoPullRequestFoundError(err) {
			return nil, nil
		}
		return nil, err
	}
	var items []gitHubPRViewItem
	if strings.TrimSpace(out) != "" {
		if err := json.Unmarshal([]byte(out), &items); err != nil {
			return nil, err
		}
	}
	candidates := make([]prCandidate, 0, len(items))
	for _, item := range items {
		if candidate := newPRCandidate(item, target.HeadRef, now); candidate != nil {
			candidates = append(candidates, *candidate)
		}
	}
	if match := pickPRCandidate(candidates, target.HeadRef, target.HeadSha, headOwner); match != nil {
		return match.status, nil
	}
	return nil, nil
}

type gitHubRepoViewResult struct {
	Owner struct {
		Login string `json:"login"`
	} `json:"owner"`
	Name   string `json:"name"`
	Parent *struct {
		Owner struct {
			Login string `json:"login"`
		} `json:"owner"`
		Name string `json:"name"`
	} `json:"parent"`
}

// gitHubRepoView reads the checkout's repository and, for a fork, its parent. A command failure
// means the repository cannot be resolved (nil); a missing CLI or a sign-in problem is the error
// the caller has to report.
func gitHubRepoView(ctx context.Context, cwd string) (*gitHubRepoViewResult, error) {
	out, err := runGitHubCommand(ctx, cwd, "repo", "view", "--json", "owner,name,parent")
	if err != nil {
		var cliErr *GitHubCLIError
		var unauthenticated errGitHubHostUnauthenticated
		var commandErr *gitHubPRCommandError
		if errors.As(err, &cliErr) || errors.As(err, &unauthenticated) ||
			(errors.As(err, &commandErr) && isGitHubAuthFailureText(commandErr.stderr)) {
			return nil, err
		}
		return nil, nil
	}
	var view gitHubRepoViewResult
	if strings.TrimSpace(out) == "" {
		return &view, nil
	}
	if err := json.Unmarshal([]byte(out), &view); err != nil {
		return nil, nil
	}
	return &view, nil
}

// The merge facts the PR panel's merge controls read: what GitHub lets this viewer do with the PR
// and how the repository allows merging. Ported from loadPullRequestGithubFacts.
const gitHubPRFactsQuery = `query PullRequestStatusFacts($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    autoMergeAllowed
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    viewerDefaultMergeMethod
    pullRequest(number: $number) {
      ` + gitHubPRFactsFields + `
    }
  }
}`

const gitHubPRFactsFields = `mergeStateStatus
      autoMergeRequest {
        enabledAt
        mergeMethod
        enabledBy {
          login
        }
      }
      viewerCanEnableAutoMerge
      viewerCanDisableAutoMerge
      viewerCanMergeAsAdmin
      viewerCanUpdateBranch
      isMergeQueueEnabled
      isInMergeQueue`

type gitHubMergePolicy struct {
	AutoMergeAllowed         *bool   `json:"autoMergeAllowed"`
	MergeCommitAllowed       *bool   `json:"mergeCommitAllowed"`
	SquashMergeAllowed       *bool   `json:"squashMergeAllowed"`
	RebaseMergeAllowed       *bool   `json:"rebaseMergeAllowed"`
	ViewerDefaultMergeMethod *string `json:"viewerDefaultMergeMethod"`
}

type gitHubPRFactsNode struct {
	MergeStateStatus *string `json:"mergeStateStatus"`
	AutoMergeRequest *struct {
		EnabledAt   *string `json:"enabledAt"`
		MergeMethod *string `json:"mergeMethod"`
		EnabledBy   *struct {
			Login string `json:"login"`
		} `json:"enabledBy"`
	} `json:"autoMergeRequest"`
	ViewerCanEnableAutoMerge  *bool `json:"viewerCanEnableAutoMerge"`
	ViewerCanDisableAutoMerge *bool `json:"viewerCanDisableAutoMerge"`
	ViewerCanMergeAsAdmin     *bool `json:"viewerCanMergeAsAdmin"`
	ViewerCanUpdateBranch     *bool `json:"viewerCanUpdateBranch"`
	IsMergeQueueEnabled       *bool `json:"isMergeQueueEnabled"`
	IsInMergeQueue            *bool `json:"isInMergeQueue"`
}

func boolOrFalse(value *bool) bool { return value != nil && *value }

func stringOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// gitHubPRForgeFacts is the status's forgeSpecific envelope.
func gitHubPRForgeFacts(node gitHubPRFactsNode, policy gitHubMergePolicy) map[string]any {
	var autoMerge any
	if request := node.AutoMergeRequest; request != nil {
		var enabledBy any
		if request.EnabledBy != nil {
			enabledBy = request.EnabledBy.Login
		}
		autoMerge = map[string]any{
			"enabledAt":   stringOrNil(request.EnabledAt),
			"mergeMethod": stringOrNil(request.MergeMethod),
			"enabledBy":   enabledBy,
		}
	}
	return map[string]any{
		"forge":                     "github",
		"mergeStateStatus":          stringOrNil(node.MergeStateStatus),
		"autoMergeRequest":          autoMerge,
		"viewerCanEnableAutoMerge":  boolOrFalse(node.ViewerCanEnableAutoMerge),
		"viewerCanDisableAutoMerge": boolOrFalse(node.ViewerCanDisableAutoMerge),
		"viewerCanMergeAsAdmin":     boolOrFalse(node.ViewerCanMergeAsAdmin),
		"viewerCanUpdateBranch":     boolOrFalse(node.ViewerCanUpdateBranch),
		"repository": map[string]any{
			"autoMergeAllowed":         boolOrFalse(policy.AutoMergeAllowed),
			"mergeCommitAllowed":       boolOrFalse(policy.MergeCommitAllowed),
			"squashMergeAllowed":       boolOrFalse(policy.SquashMergeAllowed),
			"rebaseMergeAllowed":       boolOrFalse(policy.RebaseMergeAllowed),
			"viewerDefaultMergeMethod": stringOrNil(policy.ViewerDefaultMergeMethod),
		},
		"isMergeQueueEnabled": boolOrFalse(node.IsMergeQueueEnabled),
		"isInMergeQueue":      boolOrFalse(node.IsInMergeQueue),
	}
}

// withGitHubPRFacts adds the merge facts to a status. A failed facts query keeps the status as it
// is, as in Node: the PR is still the PR without them.
func withGitHubPRFacts(ctx context.Context, cwd string, status map[string]any) (map[string]any, error) {
	owner, _ := status["repoOwner"].(string)
	name, _ := status["repoName"].(string)
	number, ok := status["number"].(int)
	if owner == "" || name == "" || !ok {
		return status, nil
	}
	out, err := runGitHubCommand(ctx, cwd, "api", "graphql", "-f", "query="+gitHubPRFactsQuery,
		"-F", "owner="+owner, "-F", "name="+name, "-F", "number="+strconv.Itoa(number))
	if err != nil {
		var commandErr *gitHubPRCommandError
		if errors.As(err, &commandErr) {
			return status, nil
		}
		return nil, err
	}
	var response struct {
		Data struct {
			Repository *struct {
				gitHubMergePolicy
				PullRequest *gitHubPRFactsNode `json:"pullRequest"`
			} `json:"repository"`
		} `json:"data"`
	}
	if json.Unmarshal([]byte(out), &response) != nil || response.Data.Repository == nil || response.Data.Repository.PullRequest == nil {
		return status, nil
	}
	status["forgeSpecific"] = gitHubPRForgeFacts(*response.Data.Repository.PullRequest, response.Data.Repository.gitHubMergePolicy)
	return status, nil
}
