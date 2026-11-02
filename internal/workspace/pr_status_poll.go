package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Background PR status polling, ported from the archived Node daemon: the GitHub poller in
// github-service.ts (retainCurrentPullRequestStatusPoll and its batch machinery) and the generic
// forge poll in workspace-git-service.ts (retainGenericForgePrStatusPoll).
//
// Every checkout a client is looking at keeps its PR status fresh: every 20s while checks are
// running, every 2 minutes otherwise, backing off to 5 minutes while the forge keeps failing. GitHub
// targets due on the same 5-second grid share one GraphQL request (up to 25 per request), and
// polling pauses at 40% of the GraphQL budget until it resets: the budget is shared with everything
// else the user runs against GitHub.

const (
	prPollFastInterval        = 20 * time.Second
	prPollSlowInterval        = 120 * time.Second
	prPollErrorBackoffCap     = 300 * time.Second
	gitHubPollBatchMax        = 25
	gitHubPollAlignment       = 5 * time.Second
	gitHubGraphQLReserveRatio = 0.4
	gitHubGraphQLResetGrace   = time.Second
	batchPRCandidateLimit     = 10
	frozenPRChecksCacheMax    = 512
)

// PRPollTarget is one poll: a checkout, its forge, and how its PR is found.
type PRPollTarget struct {
	Cwd    string
	Forge  string
	Lookup PRLookupTarget
}

func (t PRPollTarget) key() string {
	return strings.Join([]string{t.Forge, t.Cwd, t.Lookup.HeadRef, t.Lookup.HeadSha, t.Lookup.HeadRepositoryOwner}, "\x00")
}

// PRStatusListener receives a target's results: the PR status (nil when the checkout has no PR) or
// the error of a failed poll.
type PRStatusListener struct {
	OnStatus func(status map[string]any)
	OnError  func(err error)
}

type prPollTarget struct {
	PRPollTarget
	retainCount int
	listeners   map[int]PRStatusListener
	// nextDueAt is when the next poll is due; scheduled is false while a poll is in flight.
	nextDueAt time.Time
	scheduled bool
	// pollCycleStartedAt anchors the next GitHub cycle at the previous one's due time, so a slow
	// request does not drift the shared grid.
	pollCycleStartedAt time.Time
	latestStatus       map[string]any
	consecutiveErrors  int
	// The GitHub batch identity: the gh host ("" for github.com) and the origin's owner/name.
	identityResolved bool
	identityErr      error
	host             string
	slug             string
}

type batchRedirect struct {
	owner, name, headOwner string
}

// PRStatusPoller polls the PR status of retained targets.
type PRStatusPoller struct {
	mu                sync.Mutex
	targets           map[string]*prPollTarget
	nextListenerID    int
	timer             *time.Timer
	closed            bool
	pausedUntilByHost map[string]time.Time
	redirects         map[string]batchRedirect
	frozenChecks      map[string][]gitHubStatusCheckNode
	frozenOrder       []string
	resetLoads        map[string]*resetLoad

	now func() time.Time
	// afterFunc arms the poll timer; tests replace it to flush by hand.
	afterFunc func(d time.Duration, f func()) *time.Timer
	// fetchStatus is a single target's direct read: Node's getCurrentPullRequestStatus.
	fetchStatus func(ctx context.Context, target PRPollTarget) (map[string]any, error)
	// resolveIdentity reads a GitHub target's host and origin slug.
	resolveIdentity func(ctx context.Context, cwd string) (host, slug string, err error)
}

type resetLoad struct {
	done    chan struct{}
	resetAt time.Time
	ok      bool
}

// NewPRStatusPoller returns a poller that reads PR status the way the PR panel does.
func NewPRStatusPoller() *PRStatusPoller {
	return &PRStatusPoller{
		targets:           map[string]*prPollTarget{},
		pausedUntilByHost: map[string]time.Time{},
		redirects:         map[string]batchRedirect{},
		frozenChecks:      map[string][]gitHubStatusCheckNode{},
		resetLoads:        map[string]*resetLoad{},
		now:               time.Now,
		afterFunc:         time.AfterFunc,
		fetchStatus: func(ctx context.Context, target PRPollTarget) (map[string]any, error) {
			return CurrentPRStatus(ctx, target.Cwd, target.Forge, target.Lookup)
		},
		resolveIdentity: func(ctx context.Context, cwd string) (string, string, error) {
			host, err := gitHubRoutingHost(ctx, cwd)
			if err != nil {
				return "", "", err
			}
			return host, gitHubRepoFromRemote(OriginRemoteURL(ctx, cwd)), nil
		},
	}
}

// Retain polls target for listener until the returned release is called. A target that is new is
// polled at once.
func (p *PRStatusPoller) Retain(target PRPollTarget, listener PRStatusListener) (release func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return func() {}
	}
	key := target.key()
	t := p.targets[key]
	if t == nil {
		t = &prPollTarget{PRPollTarget: target, listeners: map[int]PRStatusListener{}}
		p.targets[key] = t
	}
	p.nextListenerID++
	id := p.nextListenerID
	t.listeners[id] = listener
	newlyRetained := t.retainCount == 0
	t.retainCount++
	if newlyRetained {
		p.scheduleAfterLocked(t, 0)
	} else if t.latestStatus != nil && listener.OnStatus != nil {
		// A second listener on a running target starts from what is known.
		status := t.latestStatus
		go listener.OnStatus(status)
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			p.mu.Lock()
			defer p.mu.Unlock()
			delete(t.listeners, id)
			t.retainCount--
			if t.retainCount <= 0 {
				t.scheduled = false
				t.pollCycleStartedAt = time.Time{}
				t.retainCount = 0
				if p.targets[key] == t {
					delete(p.targets, key)
				}
				p.armLocked()
			}
		})
	}
}

// PollNow polls every target on cwd at once: after a PR is created, merged or pushed to from the
// app, waiting for the next slot would leave the sidebar behind the PR panel.
func (p *PRStatusPoller) PollNow(cwd string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, t := range p.targets {
		if t.Cwd == cwd && t.retainCount > 0 && t.scheduled {
			p.scheduleAfterLocked(t, 0)
		}
	}
}

// Close stops polling.
func (p *PRStatusPoller) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
	p.targets = map[string]*prPollTarget{}
}

// prPollInterval is Node's computeGithubNextInterval / computeGenericForgeNextInterval.
func prPollInterval(status map[string]any, consecutiveErrors int) time.Duration {
	base := prPollSlowInterval
	if prStatusPending(status) {
		base = prPollFastInterval
	}
	if consecutiveErrors <= 1 {
		return base
	}
	backoff := float64(base) * math.Pow(2, float64(consecutiveErrors-1))
	if backoff > float64(prPollErrorBackoffCap) {
		return prPollErrorBackoffCap
	}
	return time.Duration(backoff)
}

func prStatusPending(status map[string]any) bool {
	if status == nil {
		return false
	}
	if status["checksStatus"] == "pending" {
		return true
	}
	checks, _ := status["checks"].([]map[string]any)
	for _, check := range checks {
		if check["status"] == "pending" {
			return true
		}
	}
	return false
}

// alignPollTime rounds up to the shared 5-second grid, so GitHub targets converge on one tick and
// one batched request covers all of them.
func alignPollTime(at time.Time) time.Time {
	step := gitHubPollAlignment.Milliseconds()
	ms := at.UnixMilli()
	return time.UnixMilli((ms + step - 1) / step * step)
}

func (p *PRStatusPoller) scheduleAfterLocked(t *prPollTarget, delay time.Duration) {
	if t.retainCount <= 0 || p.closed {
		return
	}
	now := p.now()
	baseline := t.pollCycleStartedAt
	if baseline.IsZero() {
		baseline = now
	}
	t.pollCycleStartedAt = time.Time{}
	pauseUntil := p.pauseUntilLocked(t)
	var due time.Time
	switch {
	case delay <= 0:
		due = now
	case t.Forge == "github":
		// Anchor at the previous cycle's due time; when the cycle overran its slot, at completion:
		// scheduling in the past would poll back-to-back exactly when GitHub is slow or failing.
		due = alignPollTime(baseline.Add(delay))
		if due.Before(now) {
			due = alignPollTime(now.Add(delay))
		}
	default:
		due = now.Add(delay)
	}
	if pauseUntil.After(due) {
		due = pauseUntil
	}
	t.nextDueAt = due
	t.scheduled = true
	p.armLocked()
}

func (p *PRStatusPoller) pauseUntilLocked(t *prPollTarget) time.Time {
	if t.Forge != "github" || !t.identityResolved {
		return time.Time{}
	}
	until := p.pausedUntilByHost[t.host]
	if !until.After(p.now()) {
		delete(p.pausedUntilByHost, t.host)
		return time.Time{}
	}
	return until
}

func (p *PRStatusPoller) armLocked() {
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
	if p.closed {
		return
	}
	var earliest time.Time
	for _, t := range p.targets {
		if t.retainCount > 0 && t.scheduled && (earliest.IsZero() || t.nextDueAt.Before(earliest)) {
			earliest = t.nextDueAt
		}
	}
	if earliest.IsZero() {
		return
	}
	wait := earliest.Sub(p.now())
	if wait < 0 {
		wait = 0
	}
	p.timer = p.afterFunc(wait, func() { p.flush(context.Background()) })
}

// flush polls every due target: GitHub targets batched per host, the rest one by one.
func (p *PRStatusPoller) flush(ctx context.Context) {
	p.mu.Lock()
	now := p.now()
	var due []*prPollTarget
	for _, t := range p.targets {
		if t.retainCount > 0 && t.scheduled && !t.nextDueAt.After(now) {
			t.scheduled = false
			t.pollCycleStartedAt = now
			due = append(due, t)
		}
	}
	p.armLocked()
	p.mu.Unlock()
	if len(due) == 0 {
		return
	}

	var direct []*prPollTarget
	groups := map[string][]batchEntry{}
	var hosts []string
	for _, t := range due {
		if t.Forge != "github" {
			direct = append(direct, t)
			continue
		}
		p.ensureIdentity(ctx, t)
		p.mu.Lock()
		host, slug, identityErr := t.host, t.slug, t.identityErr
		p.mu.Unlock()
		if identityErr != nil {
			p.afterError(t, identityErr)
			continue
		}
		owner, name, ok := strings.Cut(slug, "/")
		// A checkout with no github.com origin slug (GitHub Enterprise, an unusual remote) polls on
		// its own: a batch needs the repository's owner and name up front.
		if !ok || owner == "" || name == "" || strings.Contains(name, "/") {
			direct = append(direct, t)
			continue
		}
		if _, seen := groups[host]; !seen {
			hosts = append(hosts, host)
		}
		groups[host] = append(groups[host], batchEntry{target: t, host: host, originOwner: owner, originName: name, owner: owner, name: name})
	}

	var wg sync.WaitGroup
	for _, t := range direct {
		wg.Add(1)
		go func(t *prPollTarget) {
			defer wg.Done()
			p.pollDirect(ctx, t)
		}(t)
	}
	for _, host := range hosts {
		wg.Add(1)
		go func(entries []batchEntry) {
			defer wg.Done()
			p.runGroup(ctx, entries, now)
		}(groups[host])
	}
	wg.Wait()
}

func (p *PRStatusPoller) ensureIdentity(ctx context.Context, t *prPollTarget) {
	p.mu.Lock()
	resolved := t.identityResolved
	p.mu.Unlock()
	if resolved {
		return
	}
	host, slug, err := p.resolveIdentity(ctx, t.Cwd)
	p.mu.Lock()
	t.host, t.slug, t.identityErr = host, slug, err
	// A failed lookup (an Enterprise host gh is not signed in to) is retried on the next poll.
	t.identityResolved = err == nil
	p.mu.Unlock()
}

func (p *PRStatusPoller) pollDirect(ctx context.Context, t *prPollTarget) {
	status, err := p.fetchStatus(ctx, t.PRPollTarget)
	if err != nil {
		p.afterError(t, err)
		return
	}
	p.afterSuccess(t, status)
}

func (p *PRStatusPoller) afterSuccess(t *prPollTarget, status map[string]any) {
	p.mu.Lock()
	if t.retainCount <= 0 {
		p.mu.Unlock()
		return
	}
	t.latestStatus = status
	t.consecutiveErrors = 0
	listeners := make([]PRStatusListener, 0, len(t.listeners))
	for _, listener := range t.listeners {
		listeners = append(listeners, listener)
	}
	p.scheduleAfterLocked(t, prPollInterval(t.latestStatus, t.consecutiveErrors))
	p.mu.Unlock()
	for _, listener := range listeners {
		if listener.OnStatus != nil {
			listener.OnStatus(status)
		}
	}
}

func (p *PRStatusPoller) afterError(t *prPollTarget, err error) {
	p.mu.Lock()
	if t.retainCount <= 0 {
		p.mu.Unlock()
		return
	}
	t.consecutiveErrors++
	listeners := make([]PRStatusListener, 0, len(t.listeners))
	for _, listener := range t.listeners {
		listeners = append(listeners, listener)
	}
	p.scheduleAfterLocked(t, prPollInterval(t.latestStatus, t.consecutiveErrors))
	p.mu.Unlock()
	for _, listener := range listeners {
		if listener.OnError != nil {
			listener.OnError(err)
		}
	}
}

// ---------------------------------------------------------------------------------- GitHub batch

type batchEntry struct {
	target                  *prPollTarget
	host                    string
	originOwner, originName string
	// owner/name are the repository queried: the origin, or a fork's parent after a redirect.
	owner, name string
	headOwner   string
}

type batchPRNode struct {
	Number              int     `json:"number"`
	URL                 string  `json:"url"`
	Title               string  `json:"title"`
	State               string  `json:"state"`
	IsDraft             bool    `json:"isDraft"`
	BaseRefName         string  `json:"baseRefName"`
	HeadRefName         string  `json:"headRefName"`
	HeadRefOid          string  `json:"headRefOid"`
	MergedAt            *string `json:"mergedAt"`
	Mergeable           string  `json:"mergeable"`
	ReviewDecision      *string `json:"reviewDecision"`
	HeadRepositoryOwner *struct {
		Login string `json:"login"`
	} `json:"headRepositoryOwner"`
	gitHubPRFactsNode
}

type batchRepository struct {
	Owner *struct {
		Login string `json:"login"`
	} `json:"owner"`
	IsFork bool `json:"isFork"`
	gitHubMergePolicy
	Parent *struct {
		Owner struct {
			Login string `json:"login"`
		} `json:"owner"`
		Name string `json:"name"`
	} `json:"parent"`
	PullRequests *struct {
		Nodes []batchPRNode `json:"nodes"`
	} `json:"pullRequests"`
}

type gitHubRateLimit struct {
	Limit     float64 `json:"limit"`
	Remaining float64 `json:"remaining"`
	ResetAt   string  `json:"resetAt"`
}

// IsPRPollPaused reports a poll that was skipped at the GraphQL reserve, which says nothing about
// the PR.
func IsPRPollPaused(err error) bool {
	var paused errGitHubPollPaused
	return errors.As(err, &paused)
}

// errGitHubPollPaused reports a poll skipped at the GraphQL reserve.
type errGitHubPollPaused struct{ rateLimit gitHubRateLimit }

func (e errGitHubPollPaused) Error() string {
	return fmt.Sprintf("GitHub GraphQL polling paused at %.0f/%.0f remaining until %s", e.rateLimit.Remaining, e.rateLimit.Limit, e.rateLimit.ResetAt)
}

const batchPRStatusFields = `number
    url
    title
    state
    isDraft
    baseRefName
    headRefName
    headRefOid
    mergedAt
    mergeable
    reviewDecision
    headRepositoryOwner {
      login
    }
    ` + gitHubPRFactsFields

func batchAlias(index int) string { return "t" + strconv.Itoa(index) }

// graphQLString quotes a value: GraphQL string literals share JSON's escaping.
func graphQLString(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func buildBatchPRStatusQuery(entries []batchEntry) string {
	var b strings.Builder
	b.WriteString("query BySpaceBatchPullRequestStatus {\n  rateLimit {\n    limit\n    remaining\n    resetAt\n  }\n")
	for index, entry := range entries {
		fmt.Fprintf(&b, "  %s: repository(owner: %s, name: %s) {\n    owner {\n      login\n    }\n    isFork\n    autoMergeAllowed\n    mergeCommitAllowed\n    squashMergeAllowed\n    rebaseMergeAllowed\n    viewerDefaultMergeMethod\n    parent {\n      owner {\n        login\n      }\n      name\n    }\n    pullRequests(headRefName: %s, first: %d, orderBy: {field: CREATED_AT, direction: DESC}) {\n      nodes {\n        ...BySpacePollPullRequest\n      }\n    }\n  }\n",
			batchAlias(index), graphQLString(entry.owner), graphQLString(entry.name), graphQLString(entry.target.Lookup.HeadRef), batchPRCandidateLimit)
	}
	b.WriteString("}\nfragment BySpacePollPullRequest on PullRequest {\n    " + batchPRStatusFields + "\n}")
	return b.String()
}

type pendingChecks struct {
	entry      batchEntry
	node       batchPRNode
	frozenKey  string
	repository batchRepository
}

func buildBatchPRChecksQuery(pending []pendingChecks) string {
	var b strings.Builder
	b.WriteString("query BySpaceBatchPullRequestChecks {\n  rateLimit {\n    limit\n    remaining\n    resetAt\n  }\n")
	for index, item := range pending {
		fmt.Fprintf(&b, `  %s: repository(owner: %s, name: %s) {
    pullRequest(number: %d) {
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    databaseId
                    name
                    status
                    conclusion
                    detailsUrl
                    startedAt
                    completedAt
                    checkSuite {
                      workflowRun {
                        databaseId
                        workflow {
                          name
                        }
                      }
                    }
                  }
                  ... on StatusContext {
                    context
                    state
                    targetUrl
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`, batchAlias(index), graphQLString(item.entry.owner), graphQLString(item.entry.name), item.node.Number)
	}
	b.WriteString("}")
	return b.String()
}

// graphQLAliases reads the data object of a GraphQL response; nil when there is none.
func graphQLAliases(stdout string) map[string]json.RawMessage {
	var body struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if json.Unmarshal([]byte(stdout), &body) != nil {
		return nil
	}
	return body.Data
}

func graphQLRateLimit(aliases map[string]json.RawMessage) *gitHubRateLimit {
	raw, ok := aliases["rateLimit"]
	if !ok {
		return nil
	}
	var rateLimit gitHubRateLimit
	if json.Unmarshal(raw, &rateLimit) != nil || rateLimit.ResetAt == "" {
		return nil
	}
	return &rateLimit
}

var gitHubRateLimitErrorPattern = regexp.MustCompile(`(?i)(?:rate limit|rate_limit).*(?:exceed|exhaust)|(?:exceed|exhaust).*rate limit`)

func isGitHubRateLimitError(err error) bool {
	var commandErr *gitHubPRCommandError
	return errors.As(err, &commandErr) && gitHubRateLimitErrorPattern.MatchString(commandErr.stderr)
}

// runGraphQL runs one batched query. When gh fails but printed a response, the aliases that did
// answer are returned with the error.
func (p *PRStatusPoller) runGraphQL(ctx context.Context, cwd, query string) (map[string]json.RawMessage, error) {
	stdout, err := runGitHubCommand(ctx, cwd, "api", "graphql", "-f", "query="+query)
	if err == nil {
		aliases := graphQLAliases(stdout)
		if aliases == nil {
			aliases = map[string]json.RawMessage{}
		}
		return aliases, nil
	}
	var commandErr *gitHubPRCommandError
	if errors.As(err, &commandErr) && commandErr.stdout != "" {
		return graphQLAliases(commandErr.stdout), err
	}
	return nil, err
}

func (p *PRStatusPoller) runGroup(ctx context.Context, entries []batchEntry, startedAt time.Time) {
	for start := 0; start < len(entries); start += gitHubPollBatchMax {
		end := min(start+gitHubPollBatchMax, len(entries))
		p.mu.Lock()
		paused := p.pausedUntilByHost[entries[start].host].After(p.now())
		p.mu.Unlock()
		if paused {
			return
		}
		p.runBatch(ctx, entries[start:end], startedAt)
	}
}

func redirectKey(entry batchEntry) string {
	return entry.host + "\n" + entry.originOwner + "/" + entry.originName
}

func (p *PRStatusPoller) runBatch(ctx context.Context, entries []batchEntry, startedAt time.Time) {
	if len(entries) == 0 {
		return
	}
	p.mu.Lock()
	for i := range entries {
		if redirect, ok := p.redirects[redirectKey(entries[i])]; ok {
			entries[i].owner, entries[i].name, entries[i].headOwner = redirect.owner, redirect.name, redirect.headOwner
		}
	}
	p.mu.Unlock()
	first := entries[0]

	aliases, err := p.runGraphQL(ctx, first.target.Cwd, buildBatchPRStatusQuery(entries))
	if err != nil {
		paused := p.pauseAfterRateLimit(ctx, first, err)
		if paused || aliases == nil {
			p.reportBatchError(entries, err)
			return
		}
	}
	if rateLimit := graphQLRateLimit(aliases); rateLimit != nil && p.pauseAtReserve(first.host, *rateLimit) {
		p.reportBatchError(entries, errGitHubPollPaused{rateLimit: *rateLimit})
		return
	}

	var pending []pendingChecks
	var direct []*prPollTarget
	var redirected []batchEntry
	for index, entry := range entries {
		raw, ok := aliases[batchAlias(index)]
		var repository batchRepository
		if !ok || string(raw) == "null" || json.Unmarshal(raw, &repository) != nil || repository.PullRequests == nil {
			p.afterError(entry.target, fmt.Errorf("GitHub batch PR status response is missing repository %s/%s", entry.owner, entry.name))
			continue
		}
		if repository.IsFork && repository.Parent != nil {
			forkOwner := entry.owner
			if repository.Owner != nil && repository.Owner.Login != "" {
				forkOwner = repository.Owner.Login
			}
			p.mu.Lock()
			p.redirects[redirectKey(entry)] = batchRedirect{owner: repository.Parent.Owner.Login, name: repository.Parent.Name, headOwner: forkOwner}
			p.mu.Unlock()
			redirected = append(redirected, entry)
			continue
		}
		node := selectBatchPRNode(entry, repository)
		if node == nil {
			// No match is only conclusive on a partial page of a non-fork: a fork's PR lives in its
			// parent, and ten newer same-named fork PRs can crowd the checkout's own out of the page.
			if repository.IsFork || len(repository.PullRequests.Nodes) >= batchPRCandidateLimit {
				direct = append(direct, entry.target)
			} else {
				p.afterSuccess(entry.target, nil)
			}
			continue
		}
		frozenKey := ""
		if node.State != "OPEN" && node.HeadRefOid != "" {
			frozenKey = fmt.Sprintf("%s/%s#%d@%s", entry.owner, entry.name, node.Number, node.HeadRefOid)
		}
		if rollup, cached := p.frozenRollup(frozenKey); cached {
			p.afterSuccess(entry.target, batchPRStatus(entry, *node, repository, rollup))
			continue
		}
		pending = append(pending, pendingChecks{entry: entry, node: *node, frozenKey: frozenKey, repository: repository})
	}
	if len(pending) > 0 {
		p.loadBatchChecks(ctx, pending)
	}
	var wg sync.WaitGroup
	for _, t := range direct {
		wg.Add(1)
		go func(t *prPollTarget) {
			defer wg.Done()
			p.pollDirect(ctx, t)
		}(t)
	}
	wg.Wait()
	if len(redirected) > 0 {
		p.runBatch(ctx, redirected, startedAt)
	}
}

// selectBatchPRNode picks the checkout's PR among the repository's PRs for the head branch.
func selectBatchPRNode(entry batchEntry, repository batchRepository) *batchPRNode {
	// The response's owner is canonical: the origin can carry stale casing or a pre-transfer owner.
	selfOwner := strings.ToLower(entry.owner)
	if repository.Owner != nil && repository.Owner.Login != "" {
		selfOwner = strings.ToLower(repository.Owner.Login)
	}
	headOwner := entry.target.Lookup.HeadRepositoryOwner
	if headOwner == "" {
		headOwner = entry.headOwner
	}
	now := time.Now()
	var candidates []prCandidate
	for index, node := range repository.PullRequests.Nodes {
		candidate := newPRCandidate(batchPRItem(node, nil), entry.target.Lookup.HeadRef, now)
		if candidate == nil {
			continue
		}
		// headRefName also matches forks whose branch has the same name. Without a fork owner the
		// branch lives in this repository, so only its own heads count (as `gh pr view` resolves it).
		if headOwner == "" && strings.ToLower(candidate.headOwner) != selfOwner {
			continue
		}
		candidate.index = index
		candidates = append(candidates, *candidate)
	}
	match := pickPRCandidate(candidates, entry.target.Lookup.HeadRef, entry.target.Lookup.HeadSha, headOwner)
	if match == nil {
		return nil
	}
	node := repository.PullRequests.Nodes[match.index]
	return &node
}

func batchPRItem(node batchPRNode, rollup []gitHubStatusCheckNode) gitHubPRViewItem {
	item := gitHubPRViewItem{
		Number:            node.Number,
		URL:               node.URL,
		Title:             node.Title,
		State:             node.State,
		IsDraft:           node.IsDraft,
		BaseRefName:       node.BaseRefName,
		HeadRefName:       node.HeadRefName,
		Mergeable:         node.Mergeable,
		StatusCheckRollup: rollup,
		HeadRefOid:        node.HeadRefOid,
	}
	if node.MergedAt != nil {
		item.MergedAt = *node.MergedAt
	}
	if node.ReviewDecision != nil {
		item.ReviewDecision = *node.ReviewDecision
	}
	if node.HeadRepositoryOwner != nil {
		item.HeadRepositoryOwner.Login = node.HeadRepositoryOwner.Login
	}
	return item
}

func batchPRStatus(entry batchEntry, node batchPRNode, repository batchRepository, rollup []gitHubStatusCheckNode) map[string]any {
	status := gitHubPRStatusWithHeadRef(batchPRItem(node, rollup), entry.target.Lookup.HeadRef, time.Now())
	if status != nil {
		status["forgeSpecific"] = gitHubPRForgeFacts(node.gitHubPRFactsNode, repository.gitHubMergePolicy)
	}
	return status
}

type batchChecksRepository struct {
	PullRequest *struct {
		Commits struct {
			Nodes []struct {
				Commit struct {
					StatusCheckRollup *struct {
						Contexts struct {
							Nodes []json.RawMessage `json:"nodes"`
						} `json:"contexts"`
					} `json:"statusCheckRollup"`
				} `json:"commit"`
			} `json:"nodes"`
		} `json:"commits"`
	} `json:"pullRequest"`
}

// batchRollupNode turns a GraphQL check context into the shape `gh pr view` reports.
func batchRollupNode(raw json.RawMessage) gitHubStatusCheckNode {
	var node gitHubStatusCheckNode
	_ = json.Unmarshal(raw, &node)
	if node.Typename == "CheckRun" {
		var run struct {
			CheckSuite *struct {
				WorkflowRun *struct {
					Workflow *struct {
						Name string `json:"name"`
					} `json:"workflow"`
				} `json:"workflowRun"`
			} `json:"checkSuite"`
		}
		if json.Unmarshal(raw, &run) == nil && run.CheckSuite != nil && run.CheckSuite.WorkflowRun != nil && run.CheckSuite.WorkflowRun.Workflow != nil {
			node.WorkflowName = run.CheckSuite.WorkflowRun.Workflow.Name
		}
	}
	return node
}

func (p *PRStatusPoller) loadBatchChecks(ctx context.Context, pending []pendingChecks) {
	first := pending[0]
	aliases, err := p.runGraphQL(ctx, first.entry.target.Cwd, buildBatchPRChecksQuery(pending))
	if err != nil {
		if p.pauseAfterRateLimit(ctx, first.entry, err) || aliases == nil {
			for _, item := range pending {
				p.afterError(item.entry.target, err)
			}
			return
		}
	}
	if rateLimit := graphQLRateLimit(aliases); rateLimit != nil {
		p.pauseAtReserve(first.entry.host, *rateLimit)
	}
	now := time.Now()
	for index, item := range pending {
		raw, ok := aliases[batchAlias(index)]
		var repository batchChecksRepository
		if !ok || json.Unmarshal(raw, &repository) != nil || repository.PullRequest == nil {
			p.afterError(item.entry.target, fmt.Errorf("GitHub batch PR checks response is missing %s/%s#%d", item.entry.owner, item.entry.name, item.node.Number))
			continue
		}
		rollup := []gitHubStatusCheckNode{}
		if commits := repository.PullRequest.Commits.Nodes; len(commits) > 0 && commits[0].Commit.StatusCheckRollup != nil {
			for _, raw := range commits[0].Commit.StatusCheckRollup.Contexts.Nodes {
				rollup = append(rollup, batchRollupNode(raw))
			}
		}
		// Only a fully finished rollup is frozen: a PR closed while CI runs would otherwise keep
		// "pending" checks, and the fast poll, for the daemon's lifetime.
		pendingCheck := false
		for _, check := range gitHubPRChecks(rollup, now) {
			if check["status"] == "pending" {
				pendingCheck = true
			}
		}
		if item.frozenKey != "" && !pendingCheck {
			p.rememberFrozenRollup(item.frozenKey, rollup)
		}
		p.afterSuccess(item.entry.target, batchPRStatus(item.entry, item.node, item.repository, rollup))
	}
}

func (p *PRStatusPoller) frozenRollup(key string) ([]gitHubStatusCheckNode, bool) {
	if key == "" {
		return nil, false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	rollup, ok := p.frozenChecks[key]
	if ok {
		p.touchFrozenLocked(key)
	}
	return rollup, ok
}

func (p *PRStatusPoller) rememberFrozenRollup(key string, rollup []gitHubStatusCheckNode) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.frozenChecks[key] = rollup
	p.touchFrozenLocked(key)
	for len(p.frozenOrder) > frozenPRChecksCacheMax {
		oldest := p.frozenOrder[0]
		p.frozenOrder = p.frozenOrder[1:]
		delete(p.frozenChecks, oldest)
	}
}

func (p *PRStatusPoller) touchFrozenLocked(key string) {
	for i, existing := range p.frozenOrder {
		if existing == key {
			p.frozenOrder = append(p.frozenOrder[:i], p.frozenOrder[i+1:]...)
			break
		}
	}
	p.frozenOrder = append(p.frozenOrder, key)
}

func (p *PRStatusPoller) reportBatchError(entries []batchEntry, err error) {
	for _, entry := range entries {
		p.afterError(entry.target, err)
	}
}

// pauseAtReserve pauses a host's polls once the GraphQL budget is down to the reserve.
func (p *PRStatusPoller) pauseAtReserve(host string, rateLimit gitHubRateLimit) bool {
	if rateLimit.Remaining > rateLimit.Limit*gitHubGraphQLReserveRatio {
		return false
	}
	resetAt, err := time.Parse(time.RFC3339, rateLimit.ResetAt)
	if err != nil {
		return false
	}
	p.pauseHostUntil(host, resetAt.Add(gitHubGraphQLResetGrace))
	return true
}

func (p *PRStatusPoller) pauseHostUntil(host string, until time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !until.After(p.now()) {
		return
	}
	if current := p.pausedUntilByHost[host]; until.After(current) {
		p.pausedUntilByHost[host] = until
	}
	for _, t := range p.targets {
		if t.Forge != "github" || !t.identityResolved || t.host != host || t.retainCount <= 0 {
			continue
		}
		t.pollCycleStartedAt = time.Time{}
		if !t.scheduled || t.nextDueAt.Before(until) {
			t.nextDueAt = until
		}
		t.scheduled = true
	}
	p.armLocked()
}

// pauseAfterRateLimit pauses a host that ran out of GraphQL budget until it resets.
func (p *PRStatusPoller) pauseAfterRateLimit(ctx context.Context, entry batchEntry, err error) bool {
	if !isGitHubRateLimitError(err) {
		return false
	}
	resetAt, ok := p.loadGraphQLResetAt(ctx, entry)
	if !ok {
		return false
	}
	p.pauseHostUntil(entry.host, resetAt.Add(gitHubGraphQLResetGrace))
	return true
}

// loadGraphQLResetAt asks GitHub when the GraphQL budget resets, once per host at a time.
func (p *PRStatusPoller) loadGraphQLResetAt(ctx context.Context, entry batchEntry) (time.Time, bool) {
	p.mu.Lock()
	load := p.resetLoads[entry.host]
	owner := load == nil
	if owner {
		load = &resetLoad{done: make(chan struct{})}
		p.resetLoads[entry.host] = load
	}
	p.mu.Unlock()
	if !owner {
		<-load.done
		return load.resetAt, load.ok
	}
	defer func() {
		p.mu.Lock()
		delete(p.resetLoads, entry.host)
		p.mu.Unlock()
		close(load.done)
	}()
	out, err := runGitHubCommand(ctx, entry.target.Cwd, "api", "rate_limit")
	if err != nil {
		return time.Time{}, false
	}
	var response struct {
		Resources struct {
			GraphQL struct {
				Reset int64 `json:"reset"`
			} `json:"graphql"`
		} `json:"resources"`
	}
	if json.Unmarshal([]byte(out), &response) != nil || response.Resources.GraphQL.Reset == 0 {
		return time.Time{}, false
	}
	load.resetAt = time.Unix(response.Resources.GraphQL.Reset, 0)
	load.ok = true
	return load.resetAt, true
}

// CurrentPRStatus is a checkout's PR status on its forge: the PR panel's read and the poll's.
func CurrentPRStatus(ctx context.Context, cwd, forge string, target PRLookupTarget) (map[string]any, error) {
	switch forge {
	case "gitlab":
		return currentGitLabMergeRequest(ctx, cwd, target)
	case "gitea":
		// shortcut: Gitea's PR status is not ported (Node's gitea-service loadCurrentPullRequestStatus
		// and its commit-status and Actions checks); port both together.
		return nil, nil
	default:
		return currentGitHubPullRequest(ctx, cwd, target)
	}
}
