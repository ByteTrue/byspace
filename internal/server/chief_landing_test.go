package server

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

type chiefLandingFixture struct {
	srv       *Server
	root      string
	targetCwd string
	missionID string
	threadID  string
}

func newChiefLandingFixture(t *testing.T, requireApproval bool) *chiefLandingFixture {
	t.Helper()
	root := t.TempDir()
	target := filepath.Join(root, "target")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	initTestGitRepo(t, target)
	f := &chiefLandingFixture{
		srv:       newTestServer(t, filepath.Join(root, "home")),
		root:      root,
		targetCwd: target,
		missionID: "mis_landing_test",
	}
	landing := chief.DefaultLandingPolicy()
	landing.RequireHumanApproval = requireApproval
	_, err := f.srv.chief.store.CreateMission(chief.Mission{
		ID:         f.missionID,
		Goal:       "test landing",
		BaseCwd:    target,
		BaseBranch: "main",
		Tier:       chief.TierL2,
		Status:     chief.MissionStatusActive,
		Landing:    &landing,
		Threads:    []chief.Thread{},
		Cursors:    map[string]int64{},
	})
	if err != nil {
		t.Fatal(err)
	}
	f.threadID = f.addReadyThread(t, "thr_one")
	return f
}

func (f *chiefLandingFixture) addReadyThread(t *testing.T, threadID string) string {
	t.Helper()
	source := filepath.Join(f.root, threadID+"-source")
	landingTestGit(t, f.targetCwd, "worktree", "add", "-b", threadID+"_branch", source)
	name := threadID + ".txt"
	if err := os.WriteFile(filepath.Join(source, name), []byte("from "+threadID+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	landingTestGit(t, source, "add", name)
	landingTestGit(t, source, "commit", "-m", "change "+threadID)
	head := strings.TrimSpace(landingTestGit(t, source, "rev-parse", "HEAD"))
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		m.Threads = append(m.Threads, chief.Thread{
			ID:          threadID,
			MissionID:   f.missionID,
			OwnedPaths:  []string{name},
			Cwd:         source,
			Branch:      threadID + "_branch",
			BaseRef:     "main",
			Isolation:   chief.IsolationWorktree,
			Status:      chief.ThreadStatusReadyToLand,
			LastVerdict: &chief.VerifyVerdict{Outcome: "pass", CommitSha: &head},
			MergeCheck: &chief.MergeDryRunResult{
				Clean:     true,
				TargetRef: "main",
				SourceRef: threadID + "_branch",
				SourceSha: &head,
				CheckedAt: "2026-01-01T00:00:00Z",
			},
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return threadID
}

func (f *chiefLandingFixture) makeVerifying(t *testing.T, threadID string) {
	t.Helper()
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		for i := range m.Threads {
			if m.Threads[i].ID == threadID {
				head := strings.TrimSpace(landingTestGit(t, m.Threads[i].Cwd, "rev-parse", "HEAD"))
				m.Threads[i].Status = chief.ThreadStatusVerifying
				m.Threads[i].LastVerdict = nil
				m.Threads[i].LastSubmit = &chief.ThreadSubmission{CommitSha: head}
				return nil
			}
		}
		return errors.New("thread not found")
	})
	if err != nil {
		t.Fatal(err)
	}
}

func (f *chiefLandingFixture) head(t *testing.T) string {
	t.Helper()
	return strings.TrimSpace(landingTestGit(t, f.targetCwd, "rev-parse", "HEAD"))
}

func (f *chiefLandingFixture) mission(t *testing.T) *chief.Mission {
	t.Helper()
	m, err := f.srv.chief.store.GetMission(f.missionID)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func (f *chiefLandingFixture) thread(t *testing.T, threadID string) chief.Thread {
	t.Helper()
	for _, th := range f.mission(t).Threads {
		if th.ID == threadID {
			return th
		}
	}
	t.Fatalf("thread %s not found", threadID)
	return chief.Thread{}
}

func landingTestGit(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	out, err := workspace.Git(t.Context(), cwd, args...)
	if err != nil {
		t.Fatalf("git %v in %s: %v", args, cwd, err)
	}
	return out
}

func landingLand(t *testing.T, f *chiefLandingFixture, threadID string) map[string]any {
	return callChiefRPC(t, f.srv, "chief.thread.land.request", map[string]any{
		"requestId": "land-" + threadID, "missionId": f.missionID, "threadId": threadID,
		"strategy": "squash", "commitMessage": "land " + threadID,
	})
}

func landingResolve(t *testing.T, f *chiefLandingFixture, decisionID, optionID string) map[string]any {
	return callChiefRPC(t, f.srv, "chief.mission.resolve_decision.request", map[string]any{
		"requestId": "resolve-" + decisionID, "missionId": f.missionID,
		"decisionId": decisionID, "optionId": optionID,
	})
}

func landingError(payload map[string]any) string {
	if payload == nil || payload["error"] == nil {
		return ""
	}
	s, _ := payload["error"].(string)
	return s
}

func landingAccepted(payload map[string]any) bool {
	v, _ := payload["accepted"].(bool)
	return v
}

func landingMissionFromPayload(payload map[string]any) map[string]any {
	m, _ := payload["mission"].(map[string]any)
	return m
}

func landingPendingDecision(m map[string]any) map[string]any {
	d, _ := m["pendingDecision"].(map[string]any)
	return d
}

func TestChiefLandingMergeCheckUsesMovingBaseBranch(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	if err := os.WriteFile(filepath.Join(f.targetCwd, "target.txt"), []byte("advanced target\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	landingTestGit(t, f.targetCwd, "add", "target.txt")
	landingTestGit(t, f.targetCwd, "commit", "-m", "advance target")
	targetHead := f.head(t)

	p := callChiefRPC(t, f.srv, "chief.thread.merge_check.request", map[string]any{
		"requestId": "merge-check", "missionId": f.missionID, "threadId": f.threadID,
	})
	if !landingAccepted(p) || landingError(p) != "" {
		t.Fatalf("merge check failed: %+v", p)
	}
	check, _ := p["mergeCheck"].(map[string]any)
	if check == nil || check["targetRef"] != "main" || check["targetSha"] != targetHead {
		t.Fatalf("merge check did not use moving base branch: %+v", p)
	}
	if check["sourceRef"] != f.threadID+"_branch" || check["clean"] != true {
		t.Fatalf("unexpected merge check: %+v", check)
	}
	if landingMissionFromPayload(p) == nil {
		t.Fatalf("missing full mission: %+v", p)
	}
}

func TestChiefLandingMergeCheckRejectsEitherDirtyWorktree(t *testing.T) {
	for _, side := range []string{"target", "source"} {
		t.Run(side, func(t *testing.T) {
			f := newChiefLandingFixture(t, true)
			cwd := f.targetCwd
			if side == "source" {
				cwd = f.thread(t, f.threadID).Cwd
			}
			if err := os.WriteFile(filepath.Join(cwd, "dirt.txt"), []byte("keep me\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			p := callChiefRPC(t, f.srv, "chief.thread.merge_check.request", map[string]any{
				"requestId": "dirty-check", "missionId": f.missionID, "threadId": f.threadID,
			})
			check, _ := p["mergeCheck"].(map[string]any)
			if check == nil || check["dirtyWorktree"] != true || check["clean"] != false {
				t.Fatalf("%s dirt was not reported: %+v", side, p)
			}
			if land := landingLand(t, f, f.threadID); landingAccepted(land) || landingError(land) == "" {
				t.Fatalf("dirty %s landing unexpectedly succeeded: %+v", side, land)
			}
		})
	}
}

func TestChiefVerdictReadinessRequestsApprovalWithoutLandingAndHoldDoesNotLand(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	f.makeVerifying(t, f.threadID)
	before := f.head(t)
	p := callChiefRPC(t, f.srv, "chief.thread.verdict.request", map[string]any{
		"requestId": "verdict", "missionId": f.missionID, "threadId": f.threadID,
		"outcome": "pass", "summary": "verified",
	})
	if !landingAccepted(p) || landingError(p) != "" {
		t.Fatalf("verdict failed: %+v", p)
	}
	m := f.mission(t)
	if m.PendingDecision == nil || m.PendingDecision.Kind != chief.LandingDecisionKind {
		t.Fatalf("ready verdict did not request landing approval: %+v", m.PendingDecision)
	}
	if got := f.head(t); got != before {
		t.Fatalf("default readiness mutated target: before %s after %s", before, got)
	}
	decisionID := m.PendingDecision.ID
	resolved := landingResolve(t, f, decisionID, chief.LandingOptionHold)
	if landingError(resolved) != "" {
		t.Fatalf("hold failed: %+v", resolved)
	}
	if got := f.head(t); got != before || f.thread(t, f.threadID).Status == chief.ThreadStatusLanded {
		t.Fatalf("hold landed thread: target=%s thread=%s", got, f.thread(t, f.threadID).Status)
	}
}

func TestChiefLandingApprovalLandsOnce(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	before := f.head(t)
	p := landingLand(t, f, f.threadID)
	if landingAccepted(p) || p["approvalRequired"] != true || landingError(p) != "" || landingMissionFromPayload(p) == nil {
		t.Fatalf("approval was not requested: %+v", p)
	}
	if got := f.head(t); got != before {
		t.Fatalf("untrusted land mutated target: %s", got)
	}
	m := f.mission(t)
	resolved := landingResolve(t, f, m.PendingDecision.ID, chief.LandingOptionApprove)
	if landingError(resolved) != "" || landingMissionFromPayload(resolved) == nil {
		t.Fatalf("approval failed: %+v", resolved)
	}
	if f.thread(t, f.threadID).Status != chief.ThreadStatusLanded || f.head(t) == before {
		t.Fatalf("approval did not land exactly once: %+v", f.thread(t, f.threadID))
	}
	after := f.head(t)
	again := landingResolve(t, f, m.PendingDecision.ID, chief.LandingOptionApprove)
	if landingError(again) == "" || f.head(t) != after {
		t.Fatalf("duplicate approval was not rejected safely: %+v", again)
	}
}

func TestChiefLandingRequireApprovalFalseAutoLandsAfterVerdict(t *testing.T) {
	f := newChiefLandingFixture(t, false)
	f.makeVerifying(t, f.threadID)
	before := f.head(t)
	p := callChiefRPC(t, f.srv, "chief.thread.verdict.request", map[string]any{
		"requestId": "auto-verdict", "missionId": f.missionID, "threadId": f.threadID,
		"outcome": "pass", "summary": "verified",
	})
	if !landingAccepted(p) || landingError(p) != "" {
		t.Fatalf("automatic landing verdict failed: %+v", p)
	}
	if f.thread(t, f.threadID).Status != chief.ThreadStatusLanded || f.head(t) == before {
		t.Fatalf("requireHumanApproval:false did not auto-land: %+v", f.mission(t))
	}
	if f.mission(t).Status != chief.MissionStatusCompleted {
		t.Fatalf("terminal mission did not complete: %s", f.mission(t).Status)
	}
}

func TestChiefLandingPreGitFailureCanBeExplicitlyRetried(t *testing.T) {
	f := newChiefLandingFixture(t, false)
	dirt := filepath.Join(f.targetCwd, "dirt.txt")
	if err := os.WriteFile(dirt, []byte("temporary\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	before := f.head(t)
	failed := landingLand(t, f, f.threadID)
	if landingAccepted(failed) || !strings.Contains(landingError(failed), "clean worktrees") || f.head(t) != before {
		t.Fatalf("pre-Git failure was not actionable and non-mutating: %+v", failed)
	}
	if err := os.Remove(dirt); err != nil {
		t.Fatal(err)
	}
	retried := landingLand(t, f, f.threadID)
	if !landingAccepted(retried) || landingError(retried) != "" || f.thread(t, f.threadID).Status != chief.ThreadStatusLanded {
		t.Fatalf("explicit retry after removing dirt failed: %+v", retried)
	}
}

func TestChiefLandingPostLandErrorIsNotBlindlyRetried(t *testing.T) {
	f := newChiefLandingFixture(t, false)
	broken := "thr_broken"
	head := "0000000000000000000000000000000000000000"
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		m.Threads = append(m.Threads, chief.Thread{
			ID: broken, MissionID: f.missionID, Cwd: filepath.Join(f.root, "missing"),
			Branch: "missing", BaseRef: "main", Isolation: chief.IsolationWorktree,
			Status:      chief.ThreadStatusReadyToLand,
			LastVerdict: &chief.VerifyVerdict{Outcome: "pass", CommitSha: &head},
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	before := f.head(t)
	p := landingLand(t, f, f.threadID)
	if landingAccepted(p) || !strings.Contains(landingError(p), "post-land") {
		t.Fatalf("expected post-land error, got %+v", p)
	}
	if landingMissionFromPayload(p) == nil || f.thread(t, f.threadID).Status != chief.ThreadStatusLanded || f.head(t) == before {
		t.Fatalf("post-land response hid committed Git/state changes: %+v", p)
	}
	after := f.head(t)
	retry := landingLand(t, f, f.threadID)
	if landingAccepted(retry) || f.head(t) != after || !strings.Contains(landingError(retry), "not ready_to_land") {
		t.Fatalf("post-land failure was blindly retried: %+v", retry)
	}
}

func TestChiefLandingSimultaneousReadyThreadsShareOneDecision(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	second := f.addReadyThread(t, "thr_two")
	before := f.head(t)
	responses := make([]map[string]any, 2)
	var wg sync.WaitGroup
	for i, threadID := range []string{f.threadID, second} {
		wg.Add(1)
		go func(i int, threadID string) {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{
				"type": "chief.thread.land.request", "requestId": "concurrent-" + threadID,
				"missionId": f.missionID, "threadId": threadID, "strategy": "squash", "commitMessage": "land",
			})
			sink := &recordingSink{}
			f.srv.handleSessionMessage(context.Background(), sink, body)
			sink.mu.Lock()
			rawMessages := append([]string(nil), sink.texts...)
			sink.mu.Unlock()
			if len(rawMessages) > 0 {
				var msg map[string]any
				_ = json.Unmarshal([]byte(rawMessages[len(rawMessages)-1]), &msg)
				inner, _ := msg["message"].(map[string]any)
				responses[i], _ = inner["payload"].(map[string]any)
			}
		}(i, threadID)
	}
	wg.Wait()
	if responses[0] == nil || responses[1] == nil {
		t.Fatalf("concurrent routes produced no response: %+v", responses)
	}
	firstDecision := landingPendingDecision(landingMissionFromPayload(responses[0]))
	secondDecision := landingPendingDecision(landingMissionFromPayload(responses[1]))
	if firstDecision == nil || secondDecision == nil || firstDecision["id"] != secondDecision["id"] {
		t.Fatalf("ready threads overwrote the pending decision: %+v %+v", responses[0], responses[1])
	}
	if f.head(t) != before {
		t.Fatal("concurrent approval requests landed without trusted approval")
	}
	resolved := landingResolve(t, f, firstDecision["id"].(string), chief.LandingOptionApprove)
	if landingError(resolved) != "" {
		t.Fatalf("first sequential approval failed: %+v", resolved)
	}
	next := f.mission(t).PendingDecision
	if next == nil || next.ResolvedAt != nil || next.ID == firstDecision["id"] {
		t.Fatalf("next ready thread did not receive a sequential decision: %+v", next)
	}
}

type abortTrackingSession struct {
	providers.ManagedSession
	mu    sync.Mutex
	calls int
}

func (s *abortTrackingSession) Abort(context.Context) error {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	return nil
}

func (s *abortTrackingSession) abortCalls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func TestChiefCancelAbortsWorkersAndPreservesWorktree(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	th := f.thread(t, f.threadID)
	workerIDs := []string{"agt_author_cancel", "agt_verifier_cancel", "agt_integrator_cancel"}
	sessions := make([]*abortTrackingSession, 0, len(workerIDs))
	for _, id := range workerIDs {
		sess := &abortTrackingSession{ManagedSession: providers.StartMockSession(providers.MockLaunchOptions{Cwd: th.Cwd})}
		sessions = append(sessions, sess)
		f.srv.mu.Lock()
		f.srv.agents[id] = &managedPi{record: store.AgentRecord{ID: id}, session: sess}
		f.srv.mu.Unlock()
	}
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		for i := range m.Threads {
			if m.Threads[i].ID == f.threadID {
				m.Threads[i].Status = chief.ThreadStatusAuthoring
				m.Threads[i].AuthorAgentID = workerIDs[0]
				m.Threads[i].VerifierAgentID = workerIDs[1]
				m.Threads[i].IntegratorAgentID = workerIDs[2]
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	wip := filepath.Join(th.Cwd, "uncommitted.txt")
	if err := os.WriteFile(wip, []byte("do not delete\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := callChiefRPC(t, f.srv, "chief.thread.cancel.request", map[string]any{
		"requestId": "cancel", "missionId": f.missionID, "threadId": f.threadID, "reason": "stop",
	})
	if !landingAccepted(p) || landingError(p) != "" || landingMissionFromPayload(p) == nil {
		t.Fatalf("cancel failed: %+v", p)
	}
	for i, sess := range sessions {
		if sess.abortCalls() != 1 {
			t.Fatalf("worker %s abort calls = %d, want 1", workerIDs[i], sess.abortCalls())
		}
	}
	if f.thread(t, f.threadID).Status != chief.ThreadStatusCanceled {
		t.Fatalf("thread was not canceled: %+v", f.thread(t, f.threadID))
	}
	if data, err := os.ReadFile(wip); err != nil || string(data) != "do not delete\n" {
		t.Fatalf("cancellation destroyed worktree/WIP: data=%q err=%v", data, err)
	}
}

func TestChiefAuthoritativeChangedFilesPreservesLeadingSpace(t *testing.T) {
	dir := t.TempDir()
	initTestGitRepo(t, dir)
	if err := os.WriteFile(filepath.Join(dir, " leading.txt"), []byte("raw path"), 0o644); err != nil {
		t.Fatal(err)
	}
	paths, err := authoritativeThreadChangedFiles(t.Context(), chief.Thread{Cwd: dir, BaseRef: "main"})
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != " leading.txt" {
		t.Fatalf("authoritative paths = %#v, want exact raw leading-space path", paths)
	}
}

func TestChiefThreadSubmitIgnoresSpoofedChangedFiles(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	th := f.thread(t, f.threadID)
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		for i := range m.Threads {
			if m.Threads[i].ID == f.threadID {
				m.Threads[i].Status = chief.ThreadStatusAuthoring
				m.Threads[i].OwnedPaths = []string{"owned.txt"}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(th.Cwd, "actual.txt"), []byte("outside ownership\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := callChiefRPC(t, f.srv, "chief.thread.submit.request", map[string]any{
		"requestId": "spoof", "missionId": f.missionID, "threadId": f.threadID,
		"summary": "spoofed", "changedFiles": []string{"owned.txt"},
	})
	if landingAccepted(p) || landingError(p) == "" {
		t.Fatalf("spoofed changedFiles bypassed ownership: %+v", p)
	}
	violations, _ := p["ownershipViolations"].([]any)
	joined := landingError(p)
	for _, v := range violations {
		s, _ := v.(string)
		joined += " " + s
	}
	if !strings.Contains(joined, "actual.txt") || strings.Contains(joined, "owned.txt is not") {
		t.Fatalf("authoritative Git changes were not validated: %+v", p)
	}
}

func TestChiefThreadSubmitL2EmptyOwnershipFailsClosed(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	th := f.thread(t, f.threadID)
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		for i := range m.Threads {
			if m.Threads[i].ID == f.threadID {
				m.Threads[i].Status = chief.ThreadStatusAuthoring
				m.Threads[i].OwnedPaths = nil
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(th.Cwd, "actual.txt"), []byte("change\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := callChiefRPC(t, f.srv, "chief.thread.submit.request", map[string]any{
		"requestId": "empty-ownership", "missionId": f.missionID, "threadId": f.threadID,
		"summary": "must fail closed", "changedFiles": []string{"actual.txt"},
	})
	if landingAccepted(p) || !strings.Contains(landingError(p), "no owned paths") {
		t.Fatalf("L2 empty ownership did not fail closed: %+v", p)
	}
}

func landingRequireEventActor(t *testing.T, f *chiefLandingFixture, kind, want string) {
	t.Helper()
	events, err := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.Kind != kind {
			continue
		}
		if event.ActorAgentID == nil || *event.ActorAgentID != want {
			t.Fatalf("%s actor = %v, want %q; events=%+v", kind, event.ActorAgentID, want, events)
		}
		return
	}
	t.Fatalf("missing %s event: %+v", kind, events)
}

func TestChiefLandingRPCCallerAgentIDAttribution(t *testing.T) {
	t.Run("merge check", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		p := callChiefRPC(t, f.srv, "chief.thread.merge_check.request", map[string]any{
			"requestId": "actor-merge", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_rpc_merge",
		})
		if !landingAccepted(p) || landingError(p) != "" {
			t.Fatalf("merge check failed: %+v", p)
		}
		landingRequireEventActor(t, f, chief.EventMergeDryrunPassed, "agt_rpc_merge")
	})
	t.Run("approval request", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		p := callChiefRPC(t, f.srv, "chief.thread.land.request", map[string]any{
			"requestId": "actor-approval", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_rpc_approval", "strategy": "squash", "commitMessage": "land",
		})
		if landingAccepted(p) || p["approvalRequired"] != true || landingError(p) != "" {
			t.Fatalf("approval request failed: %+v", p)
		}
		landingRequireEventActor(t, f, chief.EventDecisionRequested, "agt_rpc_approval")
	})
	t.Run("landed", func(t *testing.T) {
		f := newChiefLandingFixture(t, false)
		p := callChiefRPC(t, f.srv, "chief.thread.land.request", map[string]any{
			"requestId": "actor-land", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_rpc_land", "strategy": "squash", "commitMessage": "land",
		})
		if !landingAccepted(p) || landingError(p) != "" {
			t.Fatalf("land failed: %+v", p)
		}
		landingRequireEventActor(t, f, chief.EventThreadLanded, "agt_rpc_land")
	})
	t.Run("cancel", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		p := callChiefRPC(t, f.srv, "chief.thread.cancel.request", map[string]any{
			"requestId": "actor-cancel", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_rpc_cancel", "reason": "stop",
		})
		if !landingAccepted(p) || landingError(p) != "" {
			t.Fatalf("cancel failed: %+v", p)
		}
		landingRequireEventActor(t, f, chief.EventThreadCanceled, "agt_rpc_cancel")
	})
}

func installChiefLandingVerifier(t *testing.T, f *chiefLandingFixture, verifierID string) *chiefFakeNonPiSession {
	t.Helper()
	th := f.thread(t, f.threadID)
	rec := store.AgentRecord{ID: verifierID, Cwd: th.Cwd, Provider: "mock"}
	if err := f.srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	session := newChiefFakeNonPiSession(th.Cwd, th.ID, verifierID)
	f.srv.agents[verifierID] = &managedPi{record: rec, session: session}
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		for i := range m.Threads {
			if m.Threads[i].ID == f.threadID {
				m.Threads[i].AuthorAgentID = "agt_author"
				m.Threads[i].VerifierAgentID = verifierID
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func assertChiefSubmitDidNotAdvance(t *testing.T, f *chiefLandingFixture, session *chiefFakeNonPiSession, eventsBefore, promptsBefore int) {
	t.Helper()
	if got := f.thread(t, f.threadID).Status; got != chief.ThreadStatusAuthoring {
		t.Fatalf("failed submit advanced status to %s", got)
	}
	events, err := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != eventsBefore {
		t.Fatalf("failed submit appended events: before=%d after=%d events=%+v", eventsBefore, len(events), events)
	}
	session.mu.Lock()
	promptsAfter := len(session.prompts)
	session.mu.Unlock()
	if promptsAfter != promptsBefore {
		t.Fatalf("failed submit prompted verifier: before=%d after=%d", promptsBefore, promptsAfter)
	}
}

func TestChiefThreadSubmitCollectionFailureDoesNotAdvance(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	session := installChiefLandingVerifier(t, f, "agt_verifier")
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		for i := range m.Threads {
			if m.Threads[i].ID == f.threadID {
				m.Threads[i].Status = chief.ThreadStatusAuthoring
				m.Threads[i].Cwd = filepath.Join(f.root, "missing-source")
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	eventsBefore, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
	p := callChiefRPC(t, f.srv, "chief.thread.submit.request", map[string]any{
		"requestId": "collection-failure", "missionId": f.missionID, "threadId": f.threadID,
		"callerAgentId": "agt_author", "summary": "must not advance",
	})
	if landingAccepted(p) {
		t.Fatalf("collection failure accepted: %+v", p)
	}
	assertChiefSubmitDidNotAdvance(t, f, session, len(eventsBefore), 0)
}

func TestChiefThreadSubmitLockFailureDoesNotAdvance(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	session := installChiefLandingVerifier(t, f, "agt_verifier")
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		m.SharedLocks = map[string]string{"thr_one.txt": "thr_other"}
		for i := range m.Threads {
			if m.Threads[i].ID == f.threadID {
				m.Threads[i].Status = chief.ThreadStatusAuthoring
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	eventsBefore, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
	p := callChiefRPC(t, f.srv, "chief.thread.submit.request", map[string]any{
		"requestId": "lock-failure", "missionId": f.missionID, "threadId": f.threadID,
		"callerAgentId": "agt_author", "summary": "must not advance",
	})
	if landingAccepted(p) || !strings.Contains(landingError(p), "is locked by") {
		t.Fatalf("lock failure response = %+v", p)
	}
	assertChiefSubmitDidNotAdvance(t, f, session, len(eventsBefore), 0)
}

func TestChiefThreadSubmitStateFailureDoesNotClaimLocks(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	session := installChiefLandingVerifier(t, f, "agt_verifier")
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		m.Status = chief.MissionStatusCanceled
		for i := range m.Threads {
			if m.Threads[i].ID == f.threadID {
				m.Threads[i].Status = chief.ThreadStatusAuthoring
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	eventsBefore, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
	p := callChiefRPC(t, f.srv, "chief.thread.submit.request", map[string]any{
		"requestId": "terminal-submit", "missionId": f.missionID, "threadId": f.threadID,
		"callerAgentId": "agt_author", "summary": "must not claim locks",
	})
	if landingAccepted(p) {
		t.Fatalf("terminal mission submit accepted: %+v", p)
	}
	assertChiefSubmitDidNotAdvance(t, f, session, len(eventsBefore), 0)
	if got := f.mission(t).SharedLocks; len(got) != 0 {
		t.Fatalf("terminal mission submit claimed locks: %+v", got)
	}
}

func TestChiefRoleRPCsRejectUnboundCallerAgentID(t *testing.T) {
	t.Run("submit", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		session := installChiefLandingVerifier(t, f, "agt_verifier")
		eventsBefore, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
		_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
			for i := range m.Threads {
				if m.Threads[i].ID == f.threadID {
					m.Threads[i].Status = chief.ThreadStatusAuthoring
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		p := callChiefRPCUnbound(t, f.srv, "chief.thread.submit.request", map[string]any{
			"requestId": "unbound-submit", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_spoofed_author", "summary": "spoof",
		})
		if landingAccepted(p) || !strings.Contains(landingError(p), "authenticated agent") {
			t.Fatalf("unbound submit was not rejected: %+v", p)
		}
		assertChiefSubmitDidNotAdvance(t, f, session, len(eventsBefore), 0)
		if got := f.mission(t).SharedLocks; len(got) != 0 {
			t.Fatalf("unbound submit claimed locks: %+v", got)
		}
	})
	t.Run("verdict", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		f.makeVerifying(t, f.threadID)
		eventsBefore, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
		p := callChiefRPCUnbound(t, f.srv, "chief.thread.verdict.request", map[string]any{
			"requestId": "unbound-verdict", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_spoofed_verifier", "outcome": "pass", "summary": "spoof",
		})
		if landingAccepted(p) || !strings.Contains(landingError(p), "authenticated agent") {
			t.Fatalf("unbound verdict was not rejected: %+v", p)
		}
		if got := f.thread(t, f.threadID).Status; got != chief.ThreadStatusVerifying {
			t.Fatalf("unbound verdict advanced status to %s", got)
		}
		eventsAfter, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
		if len(eventsAfter) != len(eventsBefore) {
			t.Fatalf("unbound verdict appended events: before=%d after=%d", len(eventsBefore), len(eventsAfter))
		}
	})
}

func TestChiefRoleRPCsRejectMismatchedBoundCallerAgentID(t *testing.T) {
	t.Run("submit", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		session := installChiefLandingVerifier(t, f, "agt_verifier")
		_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
			for i := range m.Threads {
				if m.Threads[i].ID == f.threadID {
					m.Threads[i].Status = chief.ThreadStatusAuthoring
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		eventsBefore, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
		p := callChiefRPCAs(t, f.srv, "agt_attacker", "chief.thread.submit.request", map[string]any{
			"requestId": "mismatched-submit", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_author", "summary": "spoof",
		})
		if landingAccepted(p) || !strings.Contains(landingError(p), "does not match") {
			t.Fatalf("mismatched submit was not rejected: %+v", p)
		}
		assertChiefSubmitDidNotAdvance(t, f, session, len(eventsBefore), 0)
	})
	t.Run("verdict", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		f.makeVerifying(t, f.threadID)
		eventsBefore, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
		p := callChiefRPCAs(t, f.srv, "agt_attacker", "chief.thread.verdict.request", map[string]any{
			"requestId": "mismatched-verdict", "missionId": f.missionID, "threadId": f.threadID,
			"callerAgentId": "agt_verifier", "outcome": "pass", "summary": "spoof",
		})
		if landingAccepted(p) || !strings.Contains(landingError(p), "does not match") {
			t.Fatalf("mismatched verdict was not rejected: %+v", p)
		}
		if got := f.thread(t, f.threadID).Status; got != chief.ThreadStatusVerifying {
			t.Fatalf("mismatched verdict advanced status to %s", got)
		}
		eventsAfter, _ := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
		if len(eventsAfter) != len(eventsBefore) {
			t.Fatalf("mismatched verdict appended events: before=%d after=%d", len(eventsBefore), len(eventsAfter))
		}
	})
}

func TestChiefLandingOpenPRIsExplicitlyUnsupported(t *testing.T) {
	f := newChiefLandingFixture(t, false)
	_, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
		m.Landing.Mode = "open_pr"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	before := f.head(t)
	p := landingLand(t, f, f.threadID)
	if landingAccepted(p) || !strings.Contains(landingError(p), "open_pr") || f.head(t) != before {
		t.Fatalf("open_pr was not explicitly unsupported: %+v", p)
	}
	if f.thread(t, f.threadID).Status == chief.ThreadStatusLanded {
		t.Fatal("open_pr incorrectly marked thread landed")
	}
}
