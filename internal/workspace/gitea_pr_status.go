package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// The current branch's pull request on Gitea and Forgejo, ported from loadCurrentPullRequestStatus
// in the archived Node daemon's gitea-service.ts. The PR is found among the open PRs by head
// branch, then among the recently updated ones; its checks are the head commit's statuses together
// with the repository's Actions tasks for that commit.

const (
	giteaPRLookupPageSize     = 50
	giteaOpenPRLookupMaxPages = 4
	// Gitea caps list pages at 50; five pages bound the sweep to the 250 most recent tasks.
	giteaActionPageLimit = 50
	giteaActionMaxPages  = 5
	// tea's default `pr list` fields omit url, mergeable, base, head and ci.
	giteaPRListFields = "index,state,author,url,title,body,mergeable,base,head,created,updated,labels,comments,ci"
)

// teaString reads a value `tea ... -o json` printed: the list commands flatten every value to a
// string, other commands keep JSON types.
type teaString string

func (s *teaString) UnmarshalJSON(raw []byte) error {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		*s = teaString(text)
		return nil
	}
	if string(raw) == "null" {
		*s = ""
		return nil
	}
	*s = teaString(strings.TrimSpace(string(raw)))
	return nil
}

type giteaPRListItem struct {
	Index     teaString  `json:"index"`
	State     teaString  `json:"state"`
	URL       teaString  `json:"url"`
	Title     teaString  `json:"title"`
	Mergeable *teaString `json:"mergeable"`
	Base      teaString  `json:"base"`
	Head      teaString  `json:"head"`
	CI        teaString  `json:"ci"`
}

type giteaRepoRef struct {
	Owner *struct {
		Login string `json:"login"`
	} `json:"owner"`
}

type giteaPullAPI struct {
	Number    int    `json:"number"`
	HTMLURL   string `json:"html_url"`
	Title     string `json:"title"`
	State     string `json:"state"`
	Merged    bool   `json:"merged"`
	Mergeable *bool  `json:"mergeable"`
	Head      struct {
		Ref  string        `json:"ref"`
		Sha  string        `json:"sha"`
		Repo *giteaRepoRef `json:"repo"`
	} `json:"head"`
	Base struct {
		Ref  string        `json:"ref"`
		Repo *giteaRepoRef `json:"repo"`
	} `json:"base"`
}

func (r *giteaRepoRef) login() string {
	if r == nil || r.Owner == nil {
		return ""
	}
	return r.Owner.Login
}

// listItem is Node's currentPullRequestApiToListItem.
func (pr giteaPullAPI) listItem() giteaPRListItem {
	head := pr.Head.Ref
	if headOwner := pr.Head.Repo.login(); headOwner != "" && headOwner != pr.Base.Repo.login() {
		head = headOwner + ":" + pr.Head.Ref
	}
	state := pr.State
	if pr.Merged {
		state = "merged"
	}
	item := giteaPRListItem{
		Index: teaString(strconv.Itoa(pr.Number)),
		State: teaString(state),
		URL:   teaString(pr.HTMLURL),
		Title: teaString(pr.Title),
		Base:  teaString(pr.Base.Ref),
		Head:  teaString(head),
	}
	if pr.Mergeable != nil {
		mergeable := teaString(strconv.FormatBool(*pr.Mergeable))
		item.Mergeable = &mergeable
	}
	return item
}

type giteaCommitStatus struct {
	ID        int64   `json:"id"`
	Status    string  `json:"status"`
	TargetURL *string `json:"target_url"`
	Context   string  `json:"context"`
}

type giteaCombinedStatus struct {
	State    string              `json:"state"`
	Statuses []giteaCommitStatus `json:"statuses"`
}

type giteaActionTask struct {
	ID           int64   `json:"id"`
	Name         *string `json:"name"`
	HeadSha      string  `json:"head_sha"`
	RunNumber    *int64  `json:"run_number"`
	DisplayTitle *string `json:"display_title"`
	Status       string  `json:"status"`
	NeedApproval bool    `json:"need_approval"`
	WorkflowID   *string `json:"workflow_id"`
	URL          *string `json:"url"`
	CreatedAt    *string `json:"created_at"`
	RunStartedAt *string `json:"run_started_at"`
}

type giteaActionRun struct {
	ID           *int64  `json:"id"`
	RunNumber    *int64  `json:"run_number"`
	IndexInRepo  *int64  `json:"index_in_repo"`
	HeadSha      *string `json:"head_sha"`
	CommitSha    *string `json:"commit_sha"`
	Status       *string `json:"status"`
	NeedApproval bool    `json:"need_approval"`
	PullRequests []struct {
		Head *struct {
			Repo *struct {
				ID *int64 `json:"id"`
			} `json:"repo"`
		} `json:"head"`
		Base *struct {
			Repo *struct {
				ID *int64 `json:"id"`
			} `json:"repo"`
		} `json:"base"`
	} `json:"pull_requests"`
}

func runTea(ctx context.Context, cwd string, args ...string) (string, error) {
	out, stderr, err := runForgeCLIWithStderr(ctx, forgeCommandTimeout, "tea", cwd, args...)
	if err != nil {
		if message := strings.TrimSpace(stderr); message != "" {
			return "", fmt.Errorf("%s", message)
		}
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// currentGiteaPullRequest resolves and describes the checkout's PR; nil when it has none.
func currentGiteaPullRequest(ctx context.Context, cwd string, target PRLookupTarget) (map[string]any, error) {
	if !forgeCLIInstalled("tea") {
		return nil, nil
	}
	match, err := findGiteaPullRequest(ctx, cwd, target)
	if err != nil || match == nil {
		return nil, err
	}
	status := giteaPRStatus(*match)
	return withGiteaChecks(ctx, cwd, *match, status), nil
}

func findGiteaPullRequest(ctx context.Context, cwd string, target PRLookupTarget) (*giteaPRListItem, error) {
	repo := remoteRepositoryIdentity(OriginRemoteURL(ctx, cwd))
	expectedHeadOwner, _, _ := strings.Cut(repo, "/")
	if open, err := findOpenGiteaPullRequest(ctx, cwd, target.HeadRef, expectedHeadOwner); err != nil || open != nil {
		return open, err
	}

	// tea finds the repository from any remote, Node's resolver only from origin: keep tea's
	// placeholders for a repository whose primary remote has another name.
	repoPath := "repos/{owner}/{repo}"
	if owner, name, ok := strings.Cut(repo, "/"); ok {
		repoPath = "repos/" + url.PathEscape(owner) + "/" + url.PathEscape(name)
	}
	out, err := runTea(ctx, cwd, "api", fmt.Sprintf("%s/pulls?state=all&sort=recentupdate&page=1&limit=%d", repoPath, giteaPRLookupPageSize))
	if err != nil {
		return nil, err
	}
	var recent []giteaPullAPI
	if out != "" {
		if err := json.Unmarshal([]byte(out), &recent); err != nil {
			return nil, err
		}
	}
	var candidates []giteaPullAPI
	for _, pr := range recent {
		// A fork's PR names the fork owner in its head, which the owner check rejects; its head
		// commit is an unambiguous identity, so a match on that is accepted.
		if giteaHeadMatches(pr.listItem(), target.HeadRef, expectedHeadOwner) || (target.HeadSha != "" && pr.Head.Sha == target.HeadSha) {
			candidates = append(candidates, pr)
		}
	}
	for _, pr := range candidates {
		if giteaPRState(pr.listItem().State) == "open" {
			item := pr.listItem()
			return &item, nil
		}
	}
	for _, pr := range candidates {
		if target.HeadSha != "" && pr.Head.Sha == target.HeadSha {
			item := pr.listItem()
			return &item, nil
		}
	}
	return nil, nil
}

func findOpenGiteaPullRequest(ctx context.Context, cwd, headRef, expectedHeadOwner string) (*giteaPRListItem, error) {
	for page := 1; page <= giteaOpenPRLookupMaxPages; page++ {
		out, err := runTea(ctx, cwd, "pr", "list", "--fields", giteaPRListFields, "--state", "open", "-o", "json",
			"--limit", strconv.Itoa(giteaPRLookupPageSize), "--page", strconv.Itoa(page))
		if err != nil {
			return nil, err
		}
		var items []giteaPRListItem
		if out != "" {
			if err := json.Unmarshal([]byte(out), &items); err != nil {
				return nil, err
			}
		}
		for i := range items {
			if giteaHeadMatches(items[i], headRef, expectedHeadOwner) {
				return &items[i], nil
			}
		}
		if len(items) < giteaPRLookupPageSize {
			return nil, nil
		}
	}
	return nil, nil
}

// giteaHeadMatches is Node's matchesCurrentHeadRef. Without an expected owner only a head with no
// owner prefix matches.
func giteaHeadMatches(item giteaPRListItem, headRef, expectedHeadOwner string) bool {
	head := string(item.Head)
	if _, ref, ok := strings.Cut(head, ":"); ok {
		if ref != headRef {
			return false
		}
	} else if head != headRef {
		return false
	}
	if expectedHeadOwner == "" {
		return !strings.Contains(head, ":")
	}
	return giteaHeadOwner(item) == expectedHeadOwner
}

func giteaHeadOwner(item giteaPRListItem) string {
	if owner, _, ok := strings.Cut(string(item.Head), ":"); ok {
		return owner
	}
	owner, _ := giteaRepoFromURL(string(item.URL))
	return owner
}

func giteaRepoFromURL(raw string) (string, string) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", ""
	}
	var segments []string
	for _, segment := range strings.Split(parsed.Path, "/") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) < 2 {
		return "", ""
	}
	return segments[0], segments[1]
}

func giteaPRState(state teaString) string {
	switch strings.ToLower(string(state)) {
	case "open":
		return "open"
	case "merged":
		return "merged"
	default:
		return "closed"
	}
}

func teaBool(value *teaString) bool {
	return value != nil && strings.ToLower(strings.TrimSpace(string(*value))) == "true"
}

// giteaCIStatus maps tea's combined CI state. Gitea's "warning" is terminal and not passing: it
// fails required checks and blocks the merge.
func giteaCIStatus(ci string) string {
	switch strings.ToLower(ci) {
	case "success":
		return "success"
	case "failure", "error", "warning":
		return "failure"
	case "pending", "running":
		return "pending"
	default:
		return "none"
	}
}

// giteaPRStatus is Node's toCurrentPullRequestStatus.
func giteaPRStatus(item giteaPRListItem) map[string]any {
	owner, name := giteaRepoFromURL(string(item.URL))
	state := giteaPRState(item.State)
	mergeable := "UNKNOWN"
	if item.Mergeable != nil {
		mergeable = "CONFLICTING"
		if teaBool(item.Mergeable) {
			mergeable = "MERGEABLE"
		}
	}
	headRef := string(item.Head)
	if _, ref, ok := strings.Cut(headRef, ":"); ok {
		headRef = ref
	}
	var ciStatus any
	if item.CI != "" {
		ciStatus = string(item.CI)
	}
	status := map[string]any{
		"url":            string(item.URL),
		"title":          string(item.Title),
		"state":          state,
		"baseRefName":    string(item.Base),
		"headRefName":    headRef,
		"isMerged":       state == "merged",
		"mergeable":      mergeable,
		"checks":         []map[string]any{},
		"checksStatus":   giteaCIStatus(string(item.CI)),
		"reviewDecision": nil,
		// The whole Gitea family (Gitea, Forgejo, Codeberg) tags its facts "gitea".
		"forgeSpecific": map[string]any{
			"forge":     "gitea",
			"mergeable": teaBool(item.Mergeable),
			"hasMerged": state == "merged",
			"ciStatus":  ciStatus,
		},
	}
	if number, err := strconv.Atoi(strings.TrimSpace(string(item.Index))); err == nil {
		status["number"] = number
	}
	if owner != "" && name != "" {
		status["repoOwner"] = owner
		status["repoName"] = name
		status["projectPath"] = owner + "/" + name
	}
	return status
}

// withGiteaChecks adds the head commit's checks. Every failure keeps the status as it is, as in
// Node: a PR without its checks is still the PR.
func withGiteaChecks(ctx context.Context, cwd string, item giteaPRListItem, status map[string]any) map[string]any {
	owner, _ := status["repoOwner"].(string)
	name, _ := status["repoName"].(string)
	number, ok := status["number"].(int)
	if !ok || owner == "" || name == "" {
		return status
	}
	out, err := runTea(ctx, cwd, "pr", strconv.Itoa(number), "-o", "json")
	if err != nil {
		return status
	}
	var view struct {
		HeadSha string `json:"headSha"`
	}
	if json.Unmarshal([]byte(out), &view) != nil || view.HeadSha == "" {
		return status
	}
	repo := giteaRepo{cwd: cwd, owner: owner, name: name}
	combined := repo.combinedStatus(ctx, view.HeadSha)
	tasks := repo.actionTasks(ctx, view.HeadSha)
	actionRequired := repo.actionRequiredRunIDs(ctx, view.HeadSha, combined, tasks)
	checks := giteaChecks(combined.Statuses, tasks, actionRequired)
	if len(checks) == 0 {
		return status
	}
	// The aggregate covers commit statuses and Actions runs: Gitea's combined state covers only
	// the statuses, and would report a failing Actions run as passing.
	status["checks"] = checks
	status["checksStatus"] = aggregateChecksStatus(checks)
	return status
}

func aggregateChecksStatus(checks []map[string]any) string {
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

type giteaRepo struct {
	cwd, owner, name string
}

func (r giteaRepo) apiPath(rest string) string {
	return "repos/" + url.PathEscape(r.owner) + "/" + url.PathEscape(r.name) + "/" + rest
}

func (r giteaRepo) combinedStatus(ctx context.Context, sha string) giteaCombinedStatus {
	var combined giteaCombinedStatus
	out, err := runTea(ctx, r.cwd, "api", r.apiPath("commits/"+url.PathEscape(sha)+"/status"))
	if err == nil {
		_ = json.Unmarshal([]byte(out), &combined)
	}
	return combined
}

// actionPages pages an Actions list until it is exhausted: the tasks endpoint pages at a small
// server default and cannot filter by commit, so a short page is not the last one.
func (r giteaRepo) actionPages(ctx context.Context, endpoint, query string) ([]json.RawMessage, error) {
	var items []json.RawMessage
	fetched := 0
	for page := 1; page <= giteaActionMaxPages; page++ {
		prefix := ""
		if query != "" {
			prefix = query + "&"
		}
		out, err := runTea(ctx, r.cwd, "api", fmt.Sprintf("%s?%slimit=%d&page=%d", r.apiPath("actions/"+endpoint), prefix, giteaActionPageLimit, page))
		if err != nil {
			return nil, err
		}
		var response struct {
			WorkflowRuns []json.RawMessage `json:"workflow_runs"`
			TotalCount   *int              `json:"total_count"`
		}
		if err := json.Unmarshal([]byte(out), &response); err != nil {
			return nil, err
		}
		if len(response.WorkflowRuns) == 0 {
			break
		}
		fetched += len(response.WorkflowRuns)
		items = append(items, response.WorkflowRuns...)
		if response.TotalCount != nil && fetched >= *response.TotalCount {
			break
		}
	}
	return items, nil
}

// actionTasks is the latest execution of each workflow's tasks for the commit.
func (r giteaRepo) actionTasks(ctx context.Context, sha string) []giteaActionTask {
	raw, err := r.actionPages(ctx, "tasks", "")
	if err != nil {
		return nil
	}
	var tasks []giteaActionTask
	for _, item := range raw {
		var task giteaActionTask
		// One malformed task drops only itself.
		if json.Unmarshal(item, &task) != nil || task.ID == 0 || task.Status == "" || task.HeadSha == "" {
			continue
		}
		if task.HeadSha == sha {
			tasks = append(tasks, task)
		}
	}
	tasks = latestGiteaTasksByWorkflow(tasks)
	return r.markTasksAwaitingApproval(ctx, sha, tasks)
}

// markTasksAwaitingApproval marks blocked tasks whose run needs approval.
func (r giteaRepo) markTasksAwaitingApproval(ctx context.Context, sha string, tasks []giteaActionTask) []giteaActionTask {
	blocked := false
	for _, task := range tasks {
		if strings.EqualFold(task.Status, "blocked") {
			blocked = true
		}
	}
	if !blocked {
		return tasks
	}
	runs, err := r.actionPages(ctx, "runs", "head_sha="+url.QueryEscape(sha))
	if err != nil {
		return tasks
	}
	approvalRunNumbers := map[int64]bool{}
	for _, raw := range runs {
		var run giteaActionRun
		if json.Unmarshal(raw, &run) != nil || !run.NeedApproval {
			continue
		}
		runSha := run.HeadSha
		if runSha == nil {
			runSha = run.CommitSha
		}
		runNumber := run.RunNumber
		if runNumber == nil {
			runNumber = run.IndexInRepo
		}
		if runSha != nil && *runSha == sha && runNumber != nil {
			approvalRunNumbers[*runNumber] = true
		}
	}
	for i := range tasks {
		if strings.EqualFold(tasks[i].Status, "blocked") && tasks[i].RunNumber != nil && approvalRunNumbers[*tasks[i].RunNumber] {
			tasks[i].NeedApproval = true
		}
	}
	return tasks
}

// actionRequiredRunIDs finds runs held for approval. Only fetched when a pending status mirrors a
// run with no task, which is how gitea.com shows an approval hold.
func (r giteaRepo) actionRequiredRunIDs(ctx context.Context, sha string, combined giteaCombinedStatus, tasks []giteaActionTask) map[int64]bool {
	taskRuns := map[int64]bool{}
	for _, task := range tasks {
		if runID, ok := giteaRunIDFromURL(stringValue(task.URL)); ok {
			taskRuns[runID] = true
		}
	}
	uncovered := false
	for _, status := range combined.Statuses {
		runID, ok := giteaRunIDFromURL(stringValue(status.TargetURL))
		if ok && !taskRuns[runID] && giteaCommitState(status.Status) == "pending" {
			uncovered = true
		}
	}
	if !uncovered {
		return nil
	}
	runs, err := r.actionPages(ctx, "runs", "head_sha="+url.QueryEscape(sha))
	if err != nil {
		return nil
	}
	required := map[int64]bool{}
	for _, raw := range runs {
		var run giteaActionRun
		if json.Unmarshal(raw, &run) != nil || run.ID == nil {
			continue
		}
		runSha := run.HeadSha
		if runSha == nil {
			runSha = run.CommitSha
		}
		if runSha == nil || *runSha != sha {
			continue
		}
		if giteaRunAwaitingApproval(run) {
			required[*run.ID] = true
		}
	}
	return required
}

// giteaRunAwaitingApproval: an explicit need_approval, or a fork PR's run held waiting or blocked
// (gitea.com sets no need_approval and shows the hold as a waiting run with no tasks).
func giteaRunAwaitingApproval(run giteaActionRun) bool {
	if run.NeedApproval {
		return true
	}
	status := strings.ToLower(stringValue(run.Status))
	if status != "waiting" && status != "blocked" {
		return false
	}
	if len(run.PullRequests) == 0 {
		return false
	}
	pr := run.PullRequests[0]
	if pr.Head == nil || pr.Head.Repo == nil || pr.Head.Repo.ID == nil || pr.Base == nil || pr.Base.Repo == nil || pr.Base.Repo.ID == nil {
		return false
	}
	return *pr.Head.Repo.ID != *pr.Base.Repo.ID
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// giteaCommitState is the protocol's mapGiteaCommitState.
func giteaCommitState(state string) string {
	switch strings.ToLower(state) {
	case "success":
		return "success"
	case "failure", "error", "warning":
		return "failure"
	case "skipped":
		return "skipped"
	default:
		return "pending"
	}
}

func giteaTaskState(status string) string {
	switch strings.ToLower(status) {
	case "success":
		return "success"
	case "failure", "failed", "error":
		return "failure"
	case "cancelled", "canceled":
		return "cancelled"
	case "skipped":
		return "skipped"
	default:
		return "pending"
	}
}

var (
	giteaRunURLPattern = regexp.MustCompile(`/actions/runs/(\d+)(?:/jobs/\d+)?/?$`)
	giteaJobURLPattern = regexp.MustCompile(`/actions/runs/\d+/jobs/\d+/?$`)
)

// giteaRunIDFromURL reads the run id from an Actions run or job URL, absolute or relative.
func giteaRunIDFromURL(raw string) (int64, bool) {
	if raw == "" {
		return 0, false
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return 0, false
	}
	match := giteaRunURLPattern.FindStringSubmatch(parsed.Path)
	if match == nil {
		return 0, false
	}
	id, err := strconv.ParseInt(match[1], 10, 64)
	return id, err == nil
}

func urlOrigin(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

// giteaChecks is Node's combineGiteaChecks. A commit status Gitea synthesizes to mirror one of its
// own Actions jobs (its URL points at a job of a run the tasks list returned) is dropped: keeping
// both would report every job twice.
func giteaChecks(statuses []giteaCommitStatus, tasks []giteaActionTask, actionRequired map[int64]bool) []map[string]any {
	origins := map[string]bool{}
	runIDs := map[int64]bool{}
	for _, task := range tasks {
		if origin := urlOrigin(stringValue(task.URL)); origin != "" {
			origins[origin] = true
		}
		if runID, ok := giteaRunIDFromURL(stringValue(task.URL)); ok {
			runIDs[runID] = true
		}
	}
	checks := []map[string]any{}
	for _, status := range statuses {
		target := stringValue(status.TargetURL)
		if isGiteaActionShadow(target, origins, runIDs) {
			continue
		}
		checks = append(checks, giteaStatusCheck(status, actionRequired))
	}
	seen := map[int64]bool{}
	for _, task := range tasks {
		if seen[task.ID] {
			continue
		}
		seen[task.ID] = true
		checks = append(checks, giteaTaskCheck(task))
	}
	return checks
}

func isGiteaActionShadow(target string, origins map[string]bool, runIDs map[int64]bool) bool {
	if target == "" {
		return false
	}
	parsed, err := url.Parse(target)
	if err != nil || !giteaJobURLPattern.MatchString(parsed.Path) {
		return false
	}
	if origin := urlOrigin(target); origin != "" && !origins[origin] {
		return false
	}
	runID, ok := giteaRunIDFromURL(target)
	return ok && runIDs[runID]
}

func giteaStatusCheck(status giteaCommitStatus, actionRequired map[int64]bool) map[string]any {
	name := status.Context
	if name == "" {
		name = fmt.Sprintf("status-%d", status.ID)
	}
	var target any
	if status.TargetURL != nil {
		target = *status.TargetURL
	}
	check := map[string]any{"name": name, "url": target, "checkRunId": status.ID}
	if runID, ok := giteaRunIDFromURL(stringValue(status.TargetURL)); ok && actionRequired[runID] {
		// The run behind this mirrored status waits for approval; the status itself reads pending.
		check["status"] = "pending"
		check["traits"] = []string{"action_required"}
		return check
	}
	check["status"] = giteaCommitState(status.Status)
	if strings.EqualFold(status.Status, "warning") {
		check["traits"] = []string{"warning"}
	}
	return check
}

func giteaTaskName(task giteaActionTask) string {
	for _, candidate := range []*string{task.Name, task.DisplayTitle, task.WorkflowID} {
		if candidate != nil && *candidate != "" {
			return *candidate
		}
	}
	return fmt.Sprintf("actions-%d", task.ID)
}

func giteaTaskCheck(task giteaActionTask) map[string]any {
	var target any
	if task.URL != nil {
		target = *task.URL
	}
	check := map[string]any{
		"name":          giteaTaskName(task),
		"status":        giteaTaskState(task.Status),
		"url":           target,
		"workflowRunId": task.ID,
	}
	if strings.EqualFold(task.Status, "blocked") && task.NeedApproval {
		check["traits"] = []string{"action_required"}
	}
	return check
}

// latestGiteaTasksByWorkflow keeps each workflow's latest execution: reruns of the same job
// collapse to the newest.
func latestGiteaTasksByWorkflow(tasks []giteaActionTask) []giteaActionTask {
	latest := map[string]giteaActionTask{}
	for _, task := range tasks {
		identity := giteaWorkflowIdentity(task)
		current, ok := latest[identity]
		if !ok || compareGiteaTaskRecency(current, task) < 0 {
			latest[identity] = task
		}
	}
	var kept []giteaActionTask
	for _, task := range tasks {
		if newest, ok := latest[giteaWorkflowIdentity(task)]; ok && giteaExecutionIdentity(task) == giteaExecutionIdentity(newest) {
			kept = append(kept, task)
		}
	}
	return kept
}

func giteaWorkflowIdentity(task giteaActionTask) string {
	if task.WorkflowID != nil && *task.WorkflowID != "" {
		return "workflow\x00" + *task.WorkflowID
	}
	// Payloads without workflow_id still collapse reruns of a job, by name.
	for _, name := range []*string{task.Name, task.DisplayTitle} {
		if name != nil && *name != "" {
			return "name\x00" + *name
		}
	}
	return "task\x00" + giteaExecutionIdentity(task)
}

func giteaExecutionIdentity(task giteaActionTask) string {
	if task.RunNumber != nil {
		return fmt.Sprintf("run-number\x00%d", *task.RunNumber)
	}
	if runID, ok := giteaRunIDFromURL(stringValue(task.URL)); ok {
		return fmt.Sprintf("run-id\x00%d", runID)
	}
	if task.URL != nil && *task.URL != "" {
		return "url\x00" + *task.URL
	}
	return fmt.Sprintf("task\x00%d", task.ID)
}

func giteaTaskTime(task giteaActionTask) int64 {
	stamp := task.CreatedAt
	if stamp == nil {
		stamp = task.RunStartedAt
	}
	if stamp == nil {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339, *stamp)
	if err != nil {
		return 0
	}
	return parsed.UnixMilli()
}

func compareGiteaTaskRecency(left, right giteaActionTask) int64 {
	var leftRun, rightRun int64
	if left.RunNumber != nil {
		leftRun = *left.RunNumber
	}
	if right.RunNumber != nil {
		rightRun = *right.RunNumber
	}
	if leftRun != rightRun {
		return leftRun - rightRun
	}
	if leftTime, rightTime := giteaTaskTime(left), giteaTaskTime(right); leftTime != rightTime {
		return leftTime - rightTime
	}
	return left.ID - right.ID
}
