package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

func prNodeJSON(number int, state, headRef, headOid, owner string, merged bool) map[string]any {
	node := map[string]any{
		"number":              number,
		"url":                 fmt.Sprintf("https://github.com/acme/app/pull/%d", number),
		"title":               fmt.Sprintf("PR %d", number),
		"state":               state,
		"isDraft":             false,
		"baseRefName":         "main",
		"headRefName":         headRef,
		"headRefOid":          headOid,
		"mergedAt":            nil,
		"mergeable":           "MERGEABLE",
		"reviewDecision":      nil,
		"headRepositoryOwner": map[string]any{"login": owner},
	}
	if merged {
		node["mergedAt"] = "2026-11-01T00:00:00Z"
	}
	return node
}

func checkRunJSON(name, status, conclusion string) map[string]any {
	return map[string]any{
		"__typename": "CheckRun", "name": name, "status": status, "conclusion": conclusion,
		"detailsUrl": "https://ci/" + name, "startedAt": "2026-11-01T00:00:00Z", "completedAt": "2026-11-01T00:01:00Z",
		"checkSuite": map[string]any{"workflowRun": map[string]any{"databaseId": 1, "workflow": map[string]any{"name": "CI"}}},
	}
}

// fakeGitHub answers the poller's gh calls from canned GraphQL data.
type fakeGitHub struct {
	mu        sync.Mutex
	calls     []string
	repos     map[string]map[string]any           // "owner/name" -> repository (without pullRequests)
	prs       map[string][]map[string]any         // "owner/name#head" -> PR nodes
	checks    map[string][]map[string]any         // "owner/name#number" -> contexts
	rateLimit map[string]any                      // rateLimit object returned with every query
	direct    func(args []string) (string, error) // gh pr view / list / repo view
}

func (f *fakeGitHub) run(_ context.Context, _ string, args ...string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(args) >= 4 && args[0] == "api" && args[1] == "graphql" && !strings.Contains(args[3], "PullRequestStatusFacts") {
		query := strings.TrimPrefix(args[3], "query=")
		kind := "status"
		if strings.Contains(query, "BySpaceBatchPullRequestChecks") {
			kind = "checks"
		}
		f.calls = append(f.calls, kind)
		data := map[string]any{}
		if f.rateLimit != nil {
			data["rateLimit"] = f.rateLimit
		}
		for _, line := range strings.Split(query, "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "t") || !strings.Contains(line, ": repository(owner: ") {
				continue
			}
			alias, rest, _ := strings.Cut(line, ": repository(owner: ")
			var owner, name string
			ownerJSON, rest, _ := strings.Cut(rest, ", name: ")
			_ = json.Unmarshal([]byte(ownerJSON), &owner)
			nameJSON, _, _ := strings.Cut(rest, ")")
			_ = json.Unmarshal([]byte(nameJSON), &name)
			slug := owner + "/" + name
			if kind == "status" {
				head := ""
				if i := strings.Index(query, alias+": repository("); i >= 0 {
					segment := query[i:]
					if j := strings.Index(segment, "headRefName: "); j >= 0 {
						headJSON, _, _ := strings.Cut(segment[j+len("headRefName: "):], ",")
						_ = json.Unmarshal([]byte(headJSON), &head)
					}
				}
				repo, ok := f.repos[slug]
				if !ok {
					data[alias] = nil
					continue
				}
				copied := map[string]any{}
				for k, v := range repo {
					copied[k] = v
				}
				nodes := f.prs[slug+"#"+head]
				if nodes == nil {
					nodes = []map[string]any{}
				}
				copied["pullRequests"] = map[string]any{"nodes": nodes}
				data[alias] = copied
			} else {
				var number int
				if i := strings.Index(query, alias+": repository("); i >= 0 {
					segment := query[i:]
					if j := strings.Index(segment, "pullRequest(number: "); j >= 0 {
						fmt.Sscanf(segment[j+len("pullRequest(number: "):], "%d", &number)
					}
				}
				contexts := f.checks[fmt.Sprintf("%s#%d", slug, number)]
				if contexts == nil {
					contexts = []map[string]any{}
				}
				data[alias] = map[string]any{"pullRequest": map[string]any{"commits": map[string]any{"nodes": []any{
					map[string]any{"commit": map[string]any{"statusCheckRollup": map[string]any{"contexts": map[string]any{"nodes": contexts}}}},
				}}}}
			}
		}
		raw, _ := json.Marshal(map[string]any{"data": data})
		return string(raw), nil
	}
	f.calls = append(f.calls, strings.Join(args[:min(2, len(args))], " "))
	if f.direct != nil {
		return f.direct(args)
	}
	return "", &gitHubPRCommandError{args: args, stderr: "no pull requests found", err: fmt.Errorf("exit 1")}
}

func (f *fakeGitHub) callCount(kind string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, call := range f.calls {
		if call == kind {
			count++
		}
	}
	return count
}

func useFakeGitHub(t *testing.T, fake *fakeGitHub) {
	t.Helper()
	previous := runGitHubCommand
	runGitHubCommand = fake.run
	t.Cleanup(func() { runGitHubCommand = previous })
}

type pollClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *pollClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *pollClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// newTestPoller is a poller on a fake clock whose timer never fires: tests flush by hand.
func newTestPoller(clock *pollClock) *PRStatusPoller {
	p := NewPRStatusPoller()
	p.now = clock.Now
	p.afterFunc = func(time.Duration, func()) *time.Timer { return time.NewTimer(time.Hour) }
	p.resolveIdentity = func(_ context.Context, cwd string) (string, string, error) {
		host, slug, _ := strings.Cut(cwd, "|")
		return host, slug, nil
	}
	return p
}

type statusRecorder struct {
	mu       sync.Mutex
	statuses []map[string]any
	errors   []error
}

func (r *statusRecorder) listener() PRStatusListener {
	return PRStatusListener{
		OnStatus: func(status map[string]any) { r.mu.Lock(); r.statuses = append(r.statuses, status); r.mu.Unlock() },
		OnError:  func(err error) { r.mu.Lock(); r.errors = append(r.errors, err); r.mu.Unlock() },
	}
}

func (r *statusRecorder) last() (map[string]any, int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var last map[string]any
	if len(r.statuses) > 0 {
		last = r.statuses[len(r.statuses)-1]
	}
	return last, len(r.statuses), len(r.errors)
}

func TestPRPollIntervals(t *testing.T) {
	pending := map[string]any{"checksStatus": "pending"}
	cases := []struct {
		status map[string]any
		errors int
		want   time.Duration
	}{
		{nil, 0, 2 * time.Minute},
		{pending, 0, 20 * time.Second},
		{map[string]any{"checks": []map[string]any{{"status": "pending"}}}, 0, 20 * time.Second},
		{pending, 1, 20 * time.Second},
		{pending, 2, 40 * time.Second},
		{pending, 5, 5 * time.Minute},
		{nil, 2, 4 * time.Minute},
		{nil, 3, 5 * time.Minute},
	}
	for _, c := range cases {
		if got := prPollInterval(c.status, c.errors); got != c.want {
			t.Fatalf("prPollInterval(%v, %d) = %s, want %s", c.status, c.errors, got, c.want)
		}
	}
	at := time.UnixMilli(1_000_001)
	if got := alignPollTime(at); got.UnixMilli() != 1_005_000 {
		t.Fatalf("alignPollTime = %d", got.UnixMilli())
	}
}

// pickPRCandidate follows Node: open PRs always match, merged and closed ones only on the head
// commit; open beats merged beats closed; a fork owner must match when known.
func TestPickPRCandidate(t *testing.T) {
	now := time.Now()
	candidate := func(number int, state, headOid, owner string, merged bool) prCandidate {
		raw, _ := json.Marshal(prNodeJSON(number, state, "feature", headOid, owner, merged))
		var node batchPRNode
		_ = json.Unmarshal(raw, &node)
		return *newPRCandidate(batchPRItem(node, nil), "feature", now)
	}
	merged := candidate(1, "MERGED", "sha-old", "acme", true)
	open := candidate(2, "OPEN", "sha-new", "acme", false)
	closedOnHead := candidate(3, "CLOSED", "sha-head", "acme", false)

	if got := pickPRCandidate([]prCandidate{merged}, "feature", "sha-head", ""); got != nil {
		t.Fatal("a merged PR on another commit must not describe the checkout")
	}
	if got := pickPRCandidate([]prCandidate{merged}, "feature", "sha-old", ""); got == nil || got.status["number"] != 1 {
		t.Fatalf("a merged PR on the head commit: %v", got)
	}
	if got := pickPRCandidate([]prCandidate{closedOnHead, merged, open}, "feature", "sha-head", ""); got == nil || got.status["number"] != 2 {
		t.Fatalf("open wins: %v", got)
	}
	if got := pickPRCandidate([]prCandidate{open}, "feature", "", "someone-else"); got != nil {
		t.Fatal("a fork owner that does not match must not match")
	}
	if got := pickPRCandidate([]prCandidate{open}, "other-branch", "", ""); got != nil {
		t.Fatal("another head branch must not match")
	}
}

// Targets on one host share one status query and one checks query; a checkout with no PR reports
// nil; the results reach every listener.
func TestPRPollBatchesPerHost(t *testing.T) {
	clock := &pollClock{now: time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)}
	fake := &fakeGitHub{
		repos: map[string]map[string]any{
			"acme/app": {"owner": map[string]any{"login": "acme"}, "isFork": false, "parent": nil, "squashMergeAllowed": true, "viewerDefaultMergeMethod": "SQUASH"},
			"acme/lib": {"owner": map[string]any{"login": "acme"}, "isFork": false, "parent": nil},
		},
		prs: map[string][]map[string]any{
			"acme/app#feature": {prNodeJSON(7, "OPEN", "feature", "sha1", "acme", false)},
		},
		checks: map[string][]map[string]any{
			"acme/app#7": {checkRunJSON("build", "IN_PROGRESS", "")},
		},
	}
	useFakeGitHub(t, fake)
	p := newTestPoller(clock)

	withPR, without := &statusRecorder{}, &statusRecorder{}
	p.Retain(PRPollTarget{Cwd: "|acme/app", Forge: "github", Lookup: PRLookupTarget{HeadRef: "feature", HeadSha: "sha1"}}, withPR.listener())
	p.Retain(PRPollTarget{Cwd: "|acme/lib", Forge: "github", Lookup: PRLookupTarget{HeadRef: "feature", HeadSha: "sha2"}}, without.listener())
	p.flush(context.Background())

	if fake.callCount("status") != 1 || fake.callCount("checks") != 1 {
		t.Fatalf("calls = %v, want one status and one checks query", fake.calls)
	}
	status, count, _ := withPR.last()
	if count != 1 || status["number"] != 7 || status["checksStatus"] != "pending" || status["state"] != "open" {
		t.Fatalf("status = %v", status)
	}
	facts, _ := status["forgeSpecific"].(map[string]any)
	policy, _ := facts["repository"].(map[string]any)
	if facts["forge"] != "github" || policy["squashMergeAllowed"] != true || policy["viewerDefaultMergeMethod"] != "SQUASH" || policy["rebaseMergeAllowed"] != false {
		t.Fatalf("merge facts = %v", facts)
	}
	if status, count, _ := without.last(); count != 1 || status != nil {
		t.Fatalf("a checkout with no PR reports nil once, got %v (%d)", status, count)
	}

	// Pending checks poll again on the fast cadence, on the 5-second grid; the idle one waits.
	p.mu.Lock()
	var fastDue, slowDue time.Time
	for _, target := range p.targets {
		if strings.HasSuffix(target.Cwd, "app") {
			fastDue = target.nextDueAt
		} else {
			slowDue = target.nextDueAt
		}
	}
	p.mu.Unlock()
	if want := clock.Now().Add(20 * time.Second); !fastDue.Equal(want) {
		t.Fatalf("fast due %s, want %s", fastDue, want)
	}
	if want := clock.Now().Add(2 * time.Minute); !slowDue.Equal(want) {
		t.Fatalf("slow due %s, want %s", slowDue, want)
	}
	p.Close()
}

// At 40% of the GraphQL budget the host pauses until the budget resets, and the poll's results are
// dropped as Node does.
func TestPRPollPausesAtTheGraphQLReserve(t *testing.T) {
	clock := &pollClock{now: time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)}
	reset := clock.Now().Add(30 * time.Minute)
	fake := &fakeGitHub{
		repos:     map[string]map[string]any{"acme/app": {"owner": map[string]any{"login": "acme"}, "isFork": false}},
		rateLimit: map[string]any{"limit": 5000, "remaining": 1999, "resetAt": reset.Format(time.RFC3339)},
	}
	useFakeGitHub(t, fake)
	p := newTestPoller(clock)
	recorder := &statusRecorder{}
	p.Retain(PRPollTarget{Cwd: "|acme/app", Forge: "github", Lookup: PRLookupTarget{HeadRef: "feature"}}, recorder.listener())
	p.flush(context.Background())

	if _, statuses, errs := recorder.last(); statuses != 0 || errs != 1 {
		t.Fatalf("statuses %d errors %d, want the poll reported as paused", statuses, errs)
	}
	p.mu.Lock()
	paused := p.pausedUntilByHost[""]
	var due time.Time
	for _, target := range p.targets {
		due = target.nextDueAt
	}
	p.mu.Unlock()
	if want := reset.Add(time.Second); !paused.Equal(want) || due.Before(want) {
		t.Fatalf("paused until %s, next due %s, want %s", paused, due, want)
	}
	// Due again before the reset: nothing is sent.
	clock.Advance(10 * time.Minute)
	p.flush(context.Background())
	if fake.callCount("status") != 1 {
		t.Fatalf("a paused host was queried: %v", fake.calls)
	}
	p.Close()
}

// A fork's PRs live in its parent: the batch redirects there, and the fork owner becomes the head
// owner to match.
func TestPRPollRedirectsForks(t *testing.T) {
	clock := &pollClock{now: time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)}
	fake := &fakeGitHub{
		repos: map[string]map[string]any{
			"me/app":   {"owner": map[string]any{"login": "me"}, "isFork": true, "parent": map[string]any{"owner": map[string]any{"login": "acme"}, "name": "app"}},
			"acme/app": {"owner": map[string]any{"login": "acme"}, "isFork": false},
		},
		prs: map[string][]map[string]any{
			"acme/app#feature": {
				prNodeJSON(11, "OPEN", "feature", "sha-other", "stranger", false),
				prNodeJSON(12, "OPEN", "feature", "sha-mine", "me", false),
			},
		},
	}
	useFakeGitHub(t, fake)
	p := newTestPoller(clock)
	recorder := &statusRecorder{}
	p.Retain(PRPollTarget{Cwd: "|me/app", Forge: "github", Lookup: PRLookupTarget{HeadRef: "feature", HeadSha: "sha-mine"}}, recorder.listener())
	p.flush(context.Background())
	status, _, errs := recorder.last()
	if errs != 0 || status == nil || status["number"] != 12 {
		t.Fatalf("fork PR = %v (errors %d), calls %v", status, errs, fake.calls)
	}
	p.Close()
}

// A merged PR's finished checks are kept, so its next polls skip the checks query.
func TestPRPollFreezesFinishedChecks(t *testing.T) {
	clock := &pollClock{now: time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)}
	fake := &fakeGitHub{
		repos:  map[string]map[string]any{"acme/app": {"owner": map[string]any{"login": "acme"}, "isFork": false}},
		prs:    map[string][]map[string]any{"acme/app#feature": {prNodeJSON(5, "MERGED", "feature", "sha5", "acme", true)}},
		checks: map[string][]map[string]any{"acme/app#5": {checkRunJSON("build", "COMPLETED", "SUCCESS")}},
	}
	useFakeGitHub(t, fake)
	p := newTestPoller(clock)
	recorder := &statusRecorder{}
	p.Retain(PRPollTarget{Cwd: "|acme/app", Forge: "github", Lookup: PRLookupTarget{HeadRef: "feature", HeadSha: "sha5"}}, recorder.listener())
	p.flush(context.Background())
	clock.Advance(2 * time.Minute)
	p.flush(context.Background())
	if fake.callCount("status") != 2 || fake.callCount("checks") != 1 {
		t.Fatalf("calls = %v, want the second poll to reuse the frozen checks", fake.calls)
	}
	status, count, _ := recorder.last()
	checks, _ := status["checks"].([]map[string]any)
	if count != 2 || status["isMerged"] != true || len(checks) != 1 || checks[0]["status"] != "success" {
		t.Fatalf("status = %v", status)
	}
	p.Close()
}

// A failing target backs off and recovers; a non-GitHub target polls on its own.
func TestPRPollErrorsBackOff(t *testing.T) {
	clock := &pollClock{now: time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)}
	p := newTestPoller(clock)
	fails := 3
	p.fetchStatus = func(context.Context, PRPollTarget) (map[string]any, error) {
		if fails > 0 {
			fails--
			return nil, fmt.Errorf("glab: 502")
		}
		return map[string]any{"number": 3, "state": "open", "checksStatus": "success"}, nil
	}
	recorder := &statusRecorder{}
	p.Retain(PRPollTarget{Cwd: "/repo", Forge: "gitlab", Lookup: PRLookupTarget{HeadRef: "feature"}}, recorder.listener())
	wantDelays := []time.Duration{2 * time.Minute, 4 * time.Minute, 5 * time.Minute, 2 * time.Minute}
	for i, want := range wantDelays {
		p.flush(context.Background())
		p.mu.Lock()
		var due time.Time
		for _, target := range p.targets {
			due = target.nextDueAt
		}
		p.mu.Unlock()
		if got := due.Sub(clock.Now()); got != want {
			t.Fatalf("poll %d: next in %s, want %s", i, got, want)
		}
		clock.Advance(want)
	}
	if status, statuses, errs := recorder.last(); statuses != 1 || errs != 3 || status["number"] != 3 {
		t.Fatalf("statuses %d errors %d last %v", statuses, errs, status)
	}
	p.Close()
}

// Releasing the last listener stops the poll.
func TestPRPollReleaseStops(t *testing.T) {
	clock := &pollClock{now: time.Now()}
	p := newTestPoller(clock)
	calls := 0
	p.fetchStatus = func(context.Context, PRPollTarget) (map[string]any, error) { calls++; return nil, nil }
	release := p.Retain(PRPollTarget{Cwd: "/repo", Forge: "gitlab", Lookup: PRLookupTarget{HeadRef: "x"}}, PRStatusListener{})
	release()
	release()
	p.flush(context.Background())
	if calls != 0 || len(p.targets) != 0 {
		t.Fatalf("calls %d targets %d after release", calls, len(p.targets))
	}
}

// The direct read takes `gh pr view <branch>` when it is the checkout's PR, and otherwise lists the
// branch's PRs in every state.
func TestCurrentGitHubPullRequest(t *testing.T) {
	repo := gitRepoWithOrigin(t, "https://github.com/acme/app.git")
	for _, args := range [][]string{{"checkout", "-q", "-b", "feature"}, {"-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	stubForgeLookups(t, nil, nil)
	target := ResolvePRLookupTarget(context.Background(), repo)
	if target == nil || target.HeadRef != "feature" || len(target.HeadSha) != 40 {
		t.Fatalf("lookup target = %+v", target)
	}
	merged, _ := json.Marshal(prNodeJSON(1, "MERGED", "feature", "an-old-sha", "acme", true))
	reopened, _ := json.Marshal([]any{prNodeJSON(1, "MERGED", "feature", "an-old-sha", "acme", true), prNodeJSON(2, "OPEN", "feature", target.HeadSha, "acme", false)})
	fake := &fakeGitHub{direct: func(args []string) (string, error) {
		switch {
		case args[0] == "pr" && args[1] == "view":
			if args[2] != "feature" || args[4] != "acme/app" {
				t.Errorf("pr view args = %v", args)
			}
			return string(merged), nil
		case args[0] == "repo":
			return `{"owner":{"login":"acme"},"name":"app","parent":null}`, nil
		case args[0] == "api":
			return `{"data":{"repository":{"autoMergeAllowed":true,"rebaseMergeAllowed":true,"pullRequest":{"mergeStateStatus":"CLEAN","viewerCanEnableAutoMerge":true}}}}`, nil
		case args[0] == "pr" && args[1] == "list":
			if !strings.Contains(strings.Join(args, " "), "--state all --head feature --limit 10") {
				t.Errorf("pr list args = %v", args)
			}
			return string(reopened), nil
		}
		return "", fmt.Errorf("unexpected %v", args)
	}}
	useFakeGitHub(t, fake)
	status, err := currentGitHubPullRequest(context.Background(), repo, *target)
	if err != nil || status == nil || status["number"] != 2 {
		t.Fatalf("status = %v, %v (calls %v)", status, err, fake.calls)
	}
	facts, _ := status["forgeSpecific"].(map[string]any)
	if facts["mergeStateStatus"] != "CLEAN" || facts["viewerCanEnableAutoMerge"] != true || facts["isInMergeQueue"] != false {
		t.Fatalf("merge facts = %v", facts)
	}
}

// The lookup target follows the branch's tracking and push configuration and the worktree's PR.
func TestResolvePRLookupTarget(t *testing.T) {
	stubForgeLookups(t, nil, nil)
	git := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	repo := gitRepoWithOrigin(t, "https://github.com/acme/app.git")
	git(repo, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x")
	git(repo, "checkout", "-q", "-b", "fork-fix")
	git(repo, "remote", "add", "contrib", "https://github.com/contrib/app.git")
	git(repo, "config", "branch.fork-fix.remote", "contrib")
	git(repo, "config", "branch.fork-fix.merge", "refs/heads/fix-typo")
	ctx := context.Background()
	if target := ResolvePRLookupTarget(ctx, repo); target == nil || target.HeadRef != "fix-typo" || target.HeadRepositoryOwner != "contrib" {
		t.Fatalf("fork tracking target = %+v", target)
	}

	git(repo, "checkout", "-q", "-b", "pushes-elsewhere")
	git(repo, "config", "branch.pushes-elsewhere.pushRemote", "contrib")
	git(repo, "config", "remote.contrib.push", "+HEAD:refs/heads/renamed")
	if target := ResolvePRLookupTarget(ctx, repo); target == nil || target.HeadRef != "renamed" || target.HeadRepositoryOwner != "contrib" {
		t.Fatalf("push config target = %+v", target)
	}

	git(repo, "checkout", "-q", "-b", "plain")
	if target := ResolvePRLookupTarget(ctx, repo); target == nil || target.HeadRef != "plain" || target.HeadRepositoryOwner != "" {
		t.Fatalf("plain branch target = %+v", target)
	}

	if err := WriteWorktreeMetadata(repo, WorktreeMetadata{
		Version: 2, BaseRefName: "main",
		ChangeRequestLookupTarget: &ChangeRequestLookupTarget{HeadRef: "their-branch", HeadRepositoryOwner: "them", LocalBranchName: "plain"},
	}); err != nil {
		t.Fatal(err)
	}
	if target := ResolvePRLookupTarget(ctx, repo); target == nil || target.HeadRef != "their-branch" || target.HeadRepositoryOwner != "them" {
		t.Fatalf("worktree PR target = %+v", target)
	}

	git(repo, "checkout", "-q", "--detach")
	if target := ResolvePRLookupTarget(ctx, repo); target != nil {
		t.Fatalf("detached HEAD target = %+v", target)
	}
}
