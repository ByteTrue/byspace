package chief

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

var landingTestNow = time.Date(2026, 11, 26, 1, 2, 3, 0, time.UTC)

type landingFixture struct {
	store     *Store
	router    *Router
	messenger *fakeMessenger
	home      string
}

func landingVerifiedThread(id string) Thread {
	sourceSHA := "source-verified"
	targetSHA := "target-before"
	return Thread{
		ID:                id,
		MissionID:         "msn_land",
		OwnedPaths:        []string{"src/**"},
		Cwd:               "/repo/" + id,
		Branch:            "feature/" + id,
		BaseRef:           "old-base",
		Isolation:         IsolationWorktree,
		Status:            ThreadStatusReadyToLand,
		AuthorAgentID:     "author_" + id,
		VerifierAgentID:   "verifier_" + id,
		IntegratorAgentID: "integrator_" + id,
		LastSubmit:        &ThreadSubmission{CommitSha: sourceSHA},
		LastVerdict:       &VerifyVerdict{Outcome: "pass", CommitSha: &sourceSHA},
		MergeCheck: &MergeDryRunResult{
			Clean:     true,
			TargetRef: "main",
			TargetSha: &targetSHA,
			SourceRef: "feature/" + id,
			SourceSha: &sourceSHA,
			CheckedAt: "2026-11-26T00:00:00Z",
		},
	}
}

func newLandingFixture(t *testing.T, threads []Thread, policy LandingPolicy) *landingFixture {
	t.Helper()
	home := t.TempDir()
	st := NewStore(home)
	locks := make(map[string]string, len(threads))
	for _, th := range threads {
		locks["locks/"+th.ID+".go"] = th.ID
	}
	_, err := st.CreateMission(Mission{
		ID:           "msn_land",
		ChiefAgentID: "ag_chief",
		BaseCwd:      "/repo",
		BaseBranch:   "main",
		Tier:         TierL2,
		Status:       MissionStatusActive,
		SharedLocks:  locks,
		Landing:      &policy,
		Threads:      threads,
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}
	messenger := newFakeMessenger()
	router := NewRouter(st, RouterHooks{
		Messenger: messenger,
		Now:       func() time.Time { return landingTestNow },
	})
	t.Cleanup(router.Close)
	return &landingFixture{store: st, router: router, messenger: messenger, home: home}
}

func cleanLandingCheck(th Thread) MergeDryRunResult {
	sourceSHA := "source-verified"
	targetSHA := "target-current"
	return MergeDryRunResult{
		Clean:     true,
		TargetRef: "main",
		TargetSha: &targetSHA,
		SourceRef: th.Branch,
		SourceSha: &sourceSHA,
		CheckedAt: landingTestNow.Format(time.RFC3339Nano),
	}
}

func landingThread(t *testing.T, m *Mission, id string) Thread {
	t.Helper()
	for _, th := range m.Threads {
		if th.ID == id {
			return th
		}
	}
	t.Fatalf("thread %s not found", id)
	return Thread{}
}

func landingSoleEvent(t *testing.T, f *landingFixture, kind string) Event {
	t.Helper()
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Kind != kind {
		t.Fatalf("expected one %s event, got %+v", kind, events)
	}
	return events[0]
}

func requireLandingEventActor(t *testing.T, event Event, want string) {
	t.Helper()
	if want == "" {
		if event.ActorAgentID != nil {
			t.Fatalf("expected default/system actor, got %q", *event.ActorAgentID)
		}
		return
	}
	if event.ActorAgentID == nil || *event.ActorAgentID != want {
		t.Fatalf("expected actor %q, got %+v", want, event.ActorAgentID)
	}
}

func TestLandingExplicitActorAttribution(t *testing.T) {
	const actor = "agt_rpc_caller"
	newService := func(f *landingFixture) *LandingService {
		return NewLandingService(f.store, f.router, LandingHooks{
			DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
				return cleanLandingCheck(th), nil
			},
			LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
				return workspace.LandResult{TargetSha: "target_new", SourceSha: "source-verified"}, nil
			},
			Now: func() time.Time { return landingTestNow },
		})
	}

	t.Run("merge check", func(t *testing.T) {
		f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{RequireHumanApproval: true})
		if _, err := newService(f).MergeCheck(context.Background(), "msn_land", "thr_a", actor); err != nil {
			t.Fatalf("merge check: %v", err)
		}
		requireLandingEventActor(t, landingSoleEvent(t, f, EventMergeDryrunPassed), actor)
	})

	t.Run("approval request", func(t *testing.T) {
		f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{RequireHumanApproval: true})
		if _, err := newService(f).LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a", ActorAgentID: actor}); err != nil {
			t.Fatalf("request approval: %v", err)
		}
		requireLandingEventActor(t, landingSoleEvent(t, f, EventDecisionRequested), actor)
	})

	t.Run("landed", func(t *testing.T) {
		f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{RequireHumanApproval: false, Strategy: "squash"})
		if _, err := newService(f).LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a", ActorAgentID: actor, CommitMessage: "land"}); err != nil {
			t.Fatalf("land: %v", err)
		}
		requireLandingEventActor(t, landingSoleEvent(t, f, EventThreadLanded), actor)
	})

	t.Run("cancel", func(t *testing.T) {
		f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{RequireHumanApproval: true})
		if _, err := newService(f).CancelThread(context.Background(), "msn_land", "thr_a", actor); err != nil {
			t.Fatalf("cancel: %v", err)
		}
		requireLandingEventActor(t, landingSoleEvent(t, f, EventThreadCanceled), actor)
	})
}

func TestLandThreadApprovalDecisionIsSequential(t *testing.T) {
	f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a"), landingVerifiedThread("thr_b")}, LandingPolicy{
		RequireHumanApproval: true,
		Mode:                 "merge_local",
		Strategy:             "squash",
	})
	dryRuns := 0
	landCalls := 0
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			dryRuns++
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			landCalls++
			return workspace.LandResult{}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})

	first, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	if err != nil {
		t.Fatalf("first approval request: %v", err)
	}
	if !first.ApprovalRequired || first.Decision == nil || first.Decision.Kind != "landing_approval" {
		t.Fatalf("first result = %+v, want landing_approval required", first)
	}
	if first.Decision.ThreadID == nil || *first.Decision.ThreadID != "thr_a" {
		t.Fatalf("decision thread = %v, want thr_a", first.Decision.ThreadID)
	}
	if dryRuns != 0 || landCalls != 0 {
		t.Fatalf("approval request ran Git: dryRuns=%d landCalls=%d", dryRuns, landCalls)
	}
	decisionID := first.Decision.ID
	events, err := f.store.ReadEvents("msn_land", 0, 0)
	if err != nil || len(events) != 1 || events[0].Kind != EventDecisionRequested {
		t.Fatalf("decision events = %+v, err=%v", events, err)
	}
	requireLandingEventActor(t, events[0], "")

	again, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	if err != nil || !again.ApprovalRequired || again.Decision == nil || again.Decision.ID != decisionID {
		t.Fatalf("reuse result = %+v, err=%v", again, err)
	}
	second, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_b"})
	if err != nil || !second.ApprovalRequired || second.Decision == nil || second.Decision.ID != decisionID {
		t.Fatalf("second thread overwrote decision: %+v, err=%v", second, err)
	}
	if second.Decision.ThreadID == nil || *second.Decision.ThreadID != "thr_a" {
		t.Fatalf("pending decision moved to %v", second.Decision.ThreadID)
	}
	m, _ := f.store.GetMission("msn_land")
	if m.HeadSeq != 1 {
		t.Fatalf("reused/blocked decisions appended events: HeadSeq=%d", m.HeadSeq)
	}

	_, err = f.store.UpdateMission("msn_land", func(m *Mission) error {
		now := landingTestNow.Format(time.RFC3339Nano)
		hold := "hold"
		m.PendingDecision.ResolvedAt = &now
		m.PendingDecision.SelectedOptionID = &hold
		m.Status = MissionStatusActive
		return nil
	})
	if err != nil {
		t.Fatalf("resolve hold: %v", err)
	}
	m, _ = f.store.GetMission("msn_land")
	if landingThread(t, m, "thr_a").Status != ThreadStatusReadyToLand || landCalls != 0 {
		t.Fatalf("hold landed or changed thread: %+v", landingThread(t, m, "thr_a"))
	}

	next, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_b"})
	if err != nil || !next.ApprovalRequired || next.Decision == nil {
		t.Fatalf("next decision result = %+v, err=%v", next, err)
	}
	if next.Decision.ID == decisionID || next.Decision.ThreadID == nil || *next.Decision.ThreadID != "thr_b" {
		t.Fatalf("next decision = %+v, want new decision for thr_b", next.Decision)
	}
}

func TestLandThreadResolvedApprovalCanLand(t *testing.T) {
	f := newLandingFixture(t, []Thread{
		landingVerifiedThread("thr_a"),
		{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring},
	}, LandingPolicy{RequireHumanApproval: true, Mode: "merge_local", Strategy: "squash"})
	landCalls := 0
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			landCalls++
			return workspace.LandResult{TargetSha: "target-after", SourceSha: "source-verified"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	pending, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	if err != nil || !pending.ApprovalRequired {
		t.Fatalf("pending = %+v, err=%v", pending, err)
	}
	_, err = f.store.UpdateMission("msn_land", func(m *Mission) error {
		now := landingTestNow.Format(time.RFC3339Nano)
		approve := "approve"
		m.PendingDecision.ResolvedAt = &now
		m.PendingDecision.SelectedOptionID = &approve
		m.Status = MissionStatusActive
		return nil
	})
	if err != nil {
		t.Fatalf("resolve approval: %v", err)
	}
	landed, err := svc.LandThread(context.Background(), LandThreadInput{
		MissionID: "msn_land",
		ThreadID:  "thr_a",
		Approval:  NewTrustedHumanApproval(),
	})
	if err != nil || landed.ApprovalRequired || landed.LandResult == nil {
		t.Fatalf("approved landing = %+v, err=%v", landed, err)
	}
	if landCalls != 1 {
		t.Fatalf("land calls = %d, want 1", landCalls)
	}
}

func TestLandThreadRejectsIneligibleWithoutLander(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(*Mission)
		check    func(Thread) MergeDryRunResult
		strategy string
		wantErr  string
	}{
		{name: "wrong status", mutate: func(m *Mission) { m.Threads[0].Status = ThreadStatusAuthoring }},
		{name: "wrong tier", mutate: func(m *Mission) { m.Tier = TierL1 }},
		{name: "not worktree", mutate: func(m *Mission) { m.Threads[0].Isolation = IsolationNone }},
		{name: "missing pass", mutate: func(m *Mission) { m.Threads[0].LastVerdict = nil }},
		{name: "rejected verdict", mutate: func(m *Mission) { m.Threads[0].LastVerdict.Outcome = "reject" }},
		{name: "tainted pass", mutate: func(m *Mission) { m.Threads[0].LastVerdict.Tainted = true }},
		{name: "missing merge check", mutate: func(m *Mission) { m.Threads[0].MergeCheck = nil }},
		{name: "missing verified source SHA", mutate: func(m *Mission) { m.Threads[0].MergeCheck.SourceSha = nil }},
		{name: "unclean prior merge check", mutate: func(m *Mission) { m.Threads[0].MergeCheck.Clean = false }},
		{name: "stale source SHA", check: func(th Thread) MergeDryRunResult {
			mc := cleanLandingCheck(th)
			mc.SourceSha = optStringPtr("source-moved")
			return mc
		}, wantErr: "source"},
		{name: "dirty worktree", check: func(th Thread) MergeDryRunResult {
			mc := cleanLandingCheck(th)
			mc.DirtyWorktree = true
			return mc
		}, wantErr: "dirty"},
		{name: "open PR mode", mutate: func(m *Mission) { m.Landing.Mode = "open_pr" }, wantErr: "open_pr"},
		{name: "open PR strategy", strategy: "open_pr", wantErr: "open_pr"},
		{name: "unsupported strategy", strategy: "fast-forward", wantErr: "strategy"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newLandingFixture(t, []Thread{
				landingVerifiedThread("thr_a"),
				{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring},
			}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
			if tt.mutate != nil {
				_, err := f.store.UpdateMission("msn_land", func(m *Mission) error {
					tt.mutate(m)
					return nil
				})
				if err != nil {
					t.Fatalf("mutate: %v", err)
				}
			}
			before, _ := f.store.GetMission("msn_land")
			landCalls := 0
			svc := NewLandingService(f.store, f.router, LandingHooks{
				DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
					if tt.check != nil {
						return tt.check(th), nil
					}
					return cleanLandingCheck(th), nil
				},
				LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
					landCalls++
					return workspace.LandResult{}, nil
				},
				Now: func() time.Time { return landingTestNow },
			})
			_, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a", Strategy: tt.strategy})
			if err == nil {
				t.Fatal("expected rejection")
			}
			if tt.wantErr != "" && !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %q, want substring %q", err, tt.wantErr)
			}
			if landCalls != 0 {
				t.Fatalf("lander called %d times", landCalls)
			}
			after, _ := f.store.GetMission("msn_land")
			if !reflect.DeepEqual(after, before) {
				t.Fatalf("mission changed on safe rejection:\nbefore=%+v\nafter=%+v", before, after)
			}
		})
	}
}

func TestLandThreadSuccessPersistsStateEventLocksAndBell(t *testing.T) {
	f := newLandingFixture(t, []Thread{
		landingVerifiedThread("thr_a"),
		{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring},
	}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	var gotOptions workspace.LandOptions
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, m Mission, th Thread) (MergeDryRunResult, error) {
			if m.BaseBranch != "main" || th.BaseRef != "old-base" {
				t.Fatalf("dry run used wrong base: mission=%+v thread=%+v", m, th)
			}
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(_ context.Context, opts workspace.LandOptions) (workspace.LandResult, error) {
			gotOptions = opts
			return workspace.LandResult{TargetSha: "target-after", SourceSha: "source-verified"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	result, err := svc.LandThread(context.Background(), LandThreadInput{
		MissionID:     "msn_land",
		ThreadID:      "thr_a",
		CommitMessage: "land thread A",
	})
	if err != nil {
		t.Fatalf("LandThread: %v", err)
	}
	if result.LandResult == nil || result.LandResult.TargetSha != "target-after" {
		t.Fatalf("land result = %+v", result.LandResult)
	}
	wantOptions := workspace.LandOptions{
		TargetCwd:     "/repo",
		TargetBranch:  "main",
		SourceCwd:     "/repo/thr_a",
		SourceBranch:  "feature/thr_a",
		Strategy:      "squash",
		CommitMessage: "land thread A",
	}
	if gotOptions != wantOptions {
		t.Fatalf("land options = %+v, want %+v", gotOptions, wantOptions)
	}
	m, _ := f.store.GetMission("msn_land")
	th := landingThread(t, m, "thr_a")
	if th.Status != ThreadStatusLanded {
		t.Fatalf("target status = %s", th.Status)
	}
	if th.MergeCheck == nil || th.MergeCheck.TargetSha == nil || *th.MergeCheck.TargetSha != "target-after" ||
		th.MergeCheck.SourceSha == nil || *th.MergeCheck.SourceSha != "source-verified" {
		t.Fatalf("persisted merge SHAs = %+v", th.MergeCheck)
	}
	if th.LastSubmit.CommitSha != "source-verified" {
		t.Fatalf("submission SHA = %s", th.LastSubmit.CommitSha)
	}
	if _, ok := m.SharedLocks["locks/thr_a.go"]; ok {
		t.Fatalf("target lock retained: %#v", m.SharedLocks)
	}
	if m.SharedLocks["locks/thr_active.go"] != "thr_active" {
		t.Fatalf("sibling lock released: %#v", m.SharedLocks)
	}
	if landingThread(t, m, "thr_active").Status != ThreadStatusAuthoring {
		t.Fatalf("unrelated sibling changed: %+v", m.Threads[1])
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Kind != EventThreadLanded {
		t.Fatalf("events = %+v", events)
	}
	requireLandingEventActor(t, events[0], "")
	if events[0].Payload["targetSha"] != "target-after" || events[0].Payload["sourceSha"] != "source-verified" {
		t.Fatalf("landed payload = %+v", events[0].Payload)
	}
	if got := len(f.messenger.sentFor("ag_chief")); got != 1 {
		t.Fatalf("Chief bell count = %d, want 1", got)
	}
}

func TestLandThreadLanderFailureLeavesMissionUnchanged(t *testing.T) {
	f := newLandingFixture(t, []Thread{
		landingVerifiedThread("thr_a"),
		{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring},
	}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	before, _ := f.store.GetMission("msn_land")
	landErr := errors.New("merge command failed")
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			return workspace.LandResult{}, landErr
		},
		Now: func() time.Time { return landingTestNow },
	})
	_, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	if !errors.Is(err, landErr) {
		t.Fatalf("error = %v, want lander error", err)
	}
	after, _ := f.store.GetMission("msn_land")
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("mission changed after retryable failure:\nbefore=%+v\nafter=%+v", before, after)
	}
}

func TestLandThreadRebasePersistsRewrittenSourceSHA(t *testing.T) {
	f := newLandingFixture(t, []Thread{
		landingVerifiedThread("thr_a"),
		{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring},
	}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(_ context.Context, opts workspace.LandOptions) (workspace.LandResult, error) {
			if opts.Strategy != "rebase" {
				t.Fatalf("strategy = %s, want rebase", opts.Strategy)
			}
			return workspace.LandResult{TargetSha: "target-rebased", SourceSha: "source-rewritten"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	_, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a", Strategy: "rebase"})
	if err != nil {
		t.Fatalf("LandThread: %v", err)
	}
	m, _ := f.store.GetMission("msn_land")
	th := landingThread(t, m, "thr_a")
	if th.LastSubmit.CommitSha != "source-rewritten" || th.MergeCheck.SourceSha == nil || *th.MergeCheck.SourceSha != "source-rewritten" {
		t.Fatalf("rewritten source not persisted: submit=%+v merge=%+v", th.LastSubmit, th.MergeCheck)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Payload["sourceSha"] != "source-rewritten" {
		t.Fatalf("events = %+v", events)
	}
}

func TestLandThreadConflictRoutesWithoutLander(t *testing.T) {
	for _, tt := range []struct {
		name          string
		attempts      int
		wantAttempts  int
		wantEventKind string
		wantTarget    string
		noIntegrator  bool
	}{
		{name: "first conflict goes to author", attempts: 0, wantAttempts: 1, wantEventKind: EventRebaseRequested, wantTarget: "author_thr_a"},
		{name: "later conflict goes to integrator", attempts: 1, wantAttempts: 1, wantEventKind: EventMergeDryrunConflict, wantTarget: "integrator_thr_a"},
		{name: "later conflict without integrator goes to chief", attempts: 1, wantAttempts: 1, wantEventKind: EventMergeDryrunConflict, wantTarget: "ag_chief", noIntegrator: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			th := landingVerifiedThread("thr_a")
			th.RebaseAttempts = tt.attempts
			if tt.noIntegrator {
				th.IntegratorAgentID = ""
			}
			f := newLandingFixture(t, []Thread{th, {ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring}}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
			landCalls := 0
			svc := NewLandingService(f.store, f.router, LandingHooks{
				DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
					check := cleanLandingCheck(th)
					check.Clean = false
					check.ConflictingFiles = []string{"src/conflict.go"}
					return check, nil
				},
				LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
					landCalls++
					return workspace.LandResult{}, nil
				},
				Now: func() time.Time { return landingTestNow },
			})
			_, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
			if err == nil || !strings.Contains(err.Error(), "conflict") {
				t.Fatalf("error = %v, want conflict", err)
			}
			if landCalls != 0 {
				t.Fatalf("lander called %d times", landCalls)
			}
			m, _ := f.store.GetMission("msn_land")
			got := landingThread(t, m, "thr_a")
			if got.Status != ThreadStatusNeedsRebase || got.RebaseAttempts != tt.wantAttempts || got.VerifyRejectCount != 0 {
				t.Fatalf("conflict state = %+v", got)
			}
			events, _ := f.store.ReadEvents("msn_land", 0, 0)
			if len(events) != 1 || events[0].Kind != tt.wantEventKind || events[0].TargetAgentID == nil || *events[0].TargetAgentID != tt.wantTarget {
				t.Fatalf("events = %+v", events)
			}
			if got := len(f.messenger.sentFor(tt.wantTarget)); got != 1 {
				t.Fatalf("bell count for %s = %d", tt.wantTarget, got)
			}
		})
	}
}

func TestLandThreadRechecksEligibleSiblings(t *testing.T) {
	clean := landingVerifiedThread("thr_clean")
	first := landingVerifiedThread("thr_first")
	later := landingVerifiedThread("thr_later")
	later.Status = ThreadStatusNeedsRebase
	later.RebaseAttempts = 1
	active := landingVerifiedThread("thr_active")
	active.Status = ThreadStatusAuthoring
	landed := landingVerifiedThread("thr_done")
	landed.Status = ThreadStatusLanded
	failed := landingVerifiedThread("thr_failed")
	failed.Status = ThreadStatusFailed
	canceled := landingVerifiedThread("thr_canceled")
	canceled.Status = ThreadStatusCanceled
	verifying := landingVerifiedThread("thr_verifying")
	verifying.Status = ThreadStatusVerifying
	threads := []Thread{landingVerifiedThread("thr_a"), clean, first, later, active, landed, failed, canceled, verifying}
	f := newLandingFixture(t, threads, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	dryRuns := make(map[string]int)
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			dryRuns[th.ID]++
			check := cleanLandingCheck(th)
			if th.ID == "thr_first" || th.ID == "thr_later" {
				check.Clean = false
				check.ConflictingFiles = []string{"src/" + th.ID + ".go"}
			}
			return check, nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			return workspace.LandResult{TargetSha: "target-after", SourceSha: "source-verified"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	if _, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a", ActorAgentID: "agt_land_caller"}); err != nil {
		t.Fatalf("LandThread: %v", err)
	}
	m, _ := f.store.GetMission("msn_land")
	if got := landingThread(t, m, "thr_clean"); got.Status != ThreadStatusReadyToLand || got.MergeCheck.TargetSha == nil || *got.MergeCheck.TargetSha != "target-current" {
		t.Fatalf("clean sibling = %+v", got)
	}
	if got := landingThread(t, m, "thr_first"); got.Status != ThreadStatusNeedsRebase || got.RebaseAttempts != 1 || got.VerifyRejectCount != 0 {
		t.Fatalf("first conflict sibling = %+v", got)
	}
	if got := landingThread(t, m, "thr_later"); got.Status != ThreadStatusNeedsRebase || got.RebaseAttempts != 1 || got.VerifyRejectCount != 0 {
		t.Fatalf("later conflict sibling = %+v", got)
	}
	for _, id := range []string{"thr_active", "thr_done", "thr_failed", "thr_canceled", "thr_verifying"} {
		if dryRuns[id] != 0 {
			t.Fatalf("irrelevant sibling %s was rechecked %d times", id, dryRuns[id])
		}
	}
	if landingThread(t, m, "thr_active").Status != ThreadStatusAuthoring || landingThread(t, m, "thr_done").Status != ThreadStatusLanded ||
		landingThread(t, m, "thr_failed").Status != ThreadStatusFailed || landingThread(t, m, "thr_canceled").Status != ThreadStatusCanceled ||
		landingThread(t, m, "thr_verifying").Status != ThreadStatusVerifying {
		t.Fatalf("irrelevant sibling statuses changed: %+v", m.Threads)
	}
	if dryRuns["thr_a"] != 1 || dryRuns["thr_clean"] != 1 || dryRuns["thr_first"] != 1 || dryRuns["thr_later"] != 1 {
		t.Fatalf("dry run counts = %#v", dryRuns)
	}
	if _, ok := m.SharedLocks["locks/thr_a.go"]; ok || m.SharedLocks["locks/thr_clean.go"] != "thr_clean" || m.SharedLocks["locks/thr_first.go"] != "thr_first" {
		t.Fatalf("lock release was not isolated: %#v", m.SharedLocks)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 4 || events[0].Kind != EventThreadLanded || events[1].Kind != EventMergeDryrunPassed ||
		events[2].Kind != EventRebaseRequested || *events[2].TargetAgentID != "author_thr_first" ||
		events[3].Kind != EventMergeDryrunConflict || *events[3].TargetAgentID != "integrator_thr_later" {
		t.Fatalf("events = %+v", events)
	}
	wantActors := []string{"agt_land_caller", "verifier_thr_clean", "verifier_thr_first", "verifier_thr_later"}
	for i, want := range wantActors {
		requireLandingEventActor(t, events[i], want)
	}
	if len(f.messenger.sentFor("author_thr_first")) != 1 || len(f.messenger.sentFor("integrator_thr_later")) != 1 {
		t.Fatalf("conflict bells were not routed: author=%d integrator=%d", len(f.messenger.sentFor("author_thr_first")), len(f.messenger.sentFor("integrator_thr_later")))
	}
}

func TestLandThreadConcurrentCallsCannotDoubleLand(t *testing.T) {
	f := newLandingFixture(t, []Thread{
		landingVerifiedThread("thr_a"),
		{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring},
	}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	landCalls := 0
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			landCalls++
			return workspace.LandResult{TargetSha: "target-after", SourceSha: "source-verified"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	start := make(chan struct{})
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			_, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
			errs <- err
		}()
	}
	close(start)
	var success, rejected int
	for i := 0; i < 2; i++ {
		if err := <-errs; err == nil {
			success++
		} else {
			rejected++
		}
	}
	if success != 1 || rejected != 1 || landCalls != 1 {
		t.Fatalf("success=%d rejected=%d landCalls=%d", success, rejected, landCalls)
	}
	m, _ := f.store.GetMission("msn_land")
	if landingThread(t, m, "thr_a").Status != ThreadStatusLanded {
		t.Fatalf("thread was not landed exactly once: %+v", m.Threads)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Kind != EventThreadLanded {
		t.Fatalf("events = %+v", events)
	}
}

func TestLandThreadPostGitPersistenceFailureIsNotRetryable(t *testing.T) {
	f := newLandingFixture(t, []Thread{
		landingVerifiedThread("thr_a"),
		{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring},
	}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			_, err := f.store.UpdateMission("msn_land", func(m *Mission) error {
				th := findThread(m, "thr_a")
				th.Status = ThreadStatusAuthoring
				return nil
			})
			if err != nil {
				t.Fatalf("simulate post-Git state change: %v", err)
			}
			return workspace.LandResult{TargetSha: "target-after", SourceSha: "source-after"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	result, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	var postLand *PostLandError
	if !errors.As(err, &postLand) {
		t.Fatalf("error = %T %v, want PostLandError", err, err)
	}
	if postLand.SafeToRetry() || postLand.TargetSha != "target-after" || postLand.SourceSha != "source-after" {
		t.Fatalf("post-land error = %+v", postLand)
	}
	if result == nil || result.LandResult == nil || result.LandResult.TargetSha != "target-after" {
		t.Fatalf("result = %+v", result)
	}
	m, _ := f.store.GetMission("msn_land")
	if landingThread(t, m, "thr_a").Status != ThreadStatusAuthoring {
		t.Fatalf("failed persistence was misreported as landed: %+v", m.Threads)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 0 {
		t.Fatalf("unexpected events = %+v", events)
	}
}

func TestCancelThreadPreservesWorktreeReleasesLocksAndCompletesMission(t *testing.T) {
	target := landingVerifiedThread("thr_a")
	target.Status = ThreadStatusAuthoring
	other := landingVerifiedThread("thr_done")
	other.Status = ThreadStatusLanded
	f := newLandingFixture(t, []Thread{target, other}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(context.Context, Mission, Thread) (MergeDryRunResult, error) {
			t.Fatal("cancel ran a merge check")
			return MergeDryRunResult{}, nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			t.Fatal("cancel ran the lander")
			return workspace.LandResult{}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	m, err := svc.CancelThread(context.Background(), "msn_land", "thr_a", "")
	if err != nil {
		t.Fatalf("CancelThread: %v", err)
	}
	got := landingThread(t, m, "thr_a")
	if got.Status != ThreadStatusCanceled {
		t.Fatalf("status = %s, want canceled", got.Status)
	}
	if got.Cwd != target.Cwd || got.Branch != target.Branch || got.BaseRef != target.BaseRef ||
		!reflect.DeepEqual(got.OwnedPaths, target.OwnedPaths) || !reflect.DeepEqual(got.LastSubmit, target.LastSubmit) ||
		!reflect.DeepEqual(got.LastVerdict, target.LastVerdict) || !reflect.DeepEqual(got.MergeCheck, target.MergeCheck) {
		t.Fatalf("worktree or verification data was lost:\nbefore=%+v\nafter=%+v", target, got)
	}
	if _, ok := m.SharedLocks["locks/thr_a.go"]; ok || m.SharedLocks["locks/thr_done.go"] != "thr_done" {
		t.Fatalf("locks = %#v", m.SharedLocks)
	}
	if m.Status != MissionStatusCompleted || m.CompletedAt == nil {
		t.Fatalf("mission did not complete after all threads became terminal: %+v", m)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Kind != EventThreadCanceled || events[0].ThreadID == nil || *events[0].ThreadID != "thr_a" {
		t.Fatalf("events = %+v", events)
	}
	requireLandingEventActor(t, events[0], "")

	beforeRetry, _ := f.store.GetMission("msn_land")
	again, err := svc.CancelThread(context.Background(), "msn_land", "thr_a", "")
	if err != nil {
		t.Fatalf("idempotent CancelThread: %v", err)
	}
	if !reflect.DeepEqual(again, beforeRetry) {
		t.Fatalf("idempotent cancel changed mission:\nbefore=%+v\nafter=%+v", beforeRetry, again)
	}
	events, _ = f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 {
		t.Fatalf("idempotent cancel appended events: %+v", events)
	}
}

func TestCancelThreadRejectsOtherTerminalStates(t *testing.T) {
	for _, status := range []string{ThreadStatusLanded, ThreadStatusFailed} {
		t.Run(status, func(t *testing.T) {
			target := landingVerifiedThread("thr_a")
			target.Status = status
			f := newLandingFixture(t, []Thread{target}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
			svc := NewLandingService(f.store, f.router, LandingHooks{Now: func() time.Time { return landingTestNow }})
			before, _ := f.store.GetMission("msn_land")
			_, err := svc.CancelThread(context.Background(), "msn_land", "thr_a", "")
			if err == nil {
				t.Fatal("expected terminal-state rejection")
			}
			after, _ := f.store.GetMission("msn_land")
			if !reflect.DeepEqual(after, before) {
				t.Fatalf("rejected cancel changed mission: before=%+v after=%+v", before, after)
			}
		})
	}
}

func TestMergeCheckRefreshesReadyState(t *testing.T) {
	th := landingVerifiedThread("thr_a")
	th.Status = ThreadStatusNeedsRebase
	th.RebaseAttempts = 1
	f := newLandingFixture(t, []Thread{th}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, m Mission, th Thread) (MergeDryRunResult, error) {
			if m.BaseBranch != "main" {
				t.Fatalf("base branch = %s", m.BaseBranch)
			}
			return cleanLandingCheck(th), nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	m, err := svc.MergeCheck(context.Background(), "msn_land", "thr_a", "")
	if err != nil {
		t.Fatalf("MergeCheck: %v", err)
	}
	got := landingThread(t, m, "thr_a")
	if got.Status != ThreadStatusReadyToLand || got.RebaseAttempts != 1 || got.MergeCheck.TargetSha == nil || *got.MergeCheck.TargetSha != "target-current" {
		t.Fatalf("merge check state = %+v", got)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Kind != EventMergeDryrunPassed {
		t.Fatalf("events = %+v", events)
	}
	requireLandingEventActor(t, events[0], "verifier_thr_a")
	if got := len(f.messenger.sentFor("ag_chief")); got != 1 {
		t.Fatalf("Chief bell count = %d", got)
	}
}

func TestMergeCheckFailureLeavesMissionUnchanged(t *testing.T) {
	f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	before, _ := f.store.GetMission("msn_land")
	checkErr := errors.New("dry run failed")
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(context.Context, Mission, Thread) (MergeDryRunResult, error) {
			return MergeDryRunResult{}, checkErr
		},
		Now: func() time.Time { return landingTestNow },
	})
	_, err := svc.MergeCheck(context.Background(), "msn_land", "thr_a", "")
	if !errors.Is(err, checkErr) {
		t.Fatalf("error = %v, want dry-run error", err)
	}
	after, _ := f.store.GetMission("msn_land")
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("failed merge check changed mission: before=%+v after=%+v", before, after)
	}
}

func TestLandThreadLastTerminalThreadCompletesMission(t *testing.T) {
	f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			return workspace.LandResult{TargetSha: "target-after", SourceSha: "source-verified"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	result, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	if err != nil {
		t.Fatalf("LandThread: %v", err)
	}
	if result.Mission.Status != MissionStatusCompleted || result.Mission.CompletedAt == nil || *result.Mission.CompletedAt != landingTestNow.Format(time.RFC3339Nano) {
		t.Fatalf("mission terminal state = %+v", result.Mission)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Kind != EventThreadLanded {
		t.Fatalf("events = %+v", events)
	}
}

func TestRecordVerdictDryRunErrorDoesNotStartRebase(t *testing.T) {
	target := landingVerifiedThread("thr_a")
	target.Status = ThreadStatusVerifying
	target.LastVerdict = nil
	target.MergeCheck = nil
	active := Thread{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring}
	f := newLandingFixture(t, []Thread{target, active}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	checkErr := errors.New("temporary git timeout")
	f.router.hooks.DryRunMerge = func(context.Context, Mission, Thread) (MergeDryRunResult, error) {
		return MergeDryRunResult{}, checkErr
	}
	before, _ := f.store.GetMission("msn_land")

	_, err := f.router.RecordVerdict(context.Background(), VerdictInput{
		MissionID:    "msn_land",
		ThreadID:     "thr_a",
		ActorAgentID: "verifier_thr_a",
		Outcome:      "pass",
		Summary:      "verification passed",
		CommitSha:    "source-verified",
	})
	if !errors.Is(err, checkErr) {
		t.Fatalf("RecordVerdict error = %v, want transient dry-run error", err)
	}
	after, _ := f.store.GetMission("msn_land")
	got := landingThread(t, after, "thr_a")
	if got.Status != ThreadStatusMergeChecking || got.RebaseAttempts != 0 || got.VerifyRejectCount != 0 || got.MergeCheck != nil {
		t.Fatalf("dry-run error caused rebase state: %+v", got)
	}
	if got.LastVerdict == nil || got.LastVerdict.Outcome != "pass" {
		t.Fatalf("valid verdict was not recorded: %+v", got.LastVerdict)
	}
	if !reflect.DeepEqual(after.Threads[1], before.Threads[1]) || !reflect.DeepEqual(after.SharedLocks, before.SharedLocks) ||
		after.HeadSeq != before.HeadSeq || !reflect.DeepEqual(after.PendingBells, before.PendingBells) || !reflect.DeepEqual(after.Cursors, before.Cursors) {
		t.Fatalf("dry-run error mutated unrelated mission state: before=%+v after=%+v", before, after)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 0 {
		t.Fatalf("dry-run error appended events: %+v", events)
	}
	for _, agentID := range []string{"ag_chief", "author_thr_a", "integrator_thr_a"} {
		if got := len(f.messenger.sentFor(agentID)); got != 0 {
			t.Fatalf("dry-run error sent %d bells to %s", got, agentID)
		}
	}
}

func TestMergeCheckRetriesAfterRecordVerdictDryRunError(t *testing.T) {
	target := landingVerifiedThread("thr_a")
	target.Status = ThreadStatusVerifying
	target.LastVerdict = nil
	target.MergeCheck = nil
	active := Thread{ID: "thr_active", MissionID: "msn_land", Status: ThreadStatusAuthoring}
	f := newLandingFixture(t, []Thread{target, active}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
	checkErr := errors.New("temporary git timeout")
	failDryRun := true
	dryRun := func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
		if failDryRun {
			return MergeDryRunResult{}, checkErr
		}
		return cleanLandingCheck(th), nil
	}
	f.router.hooks.DryRunMerge = dryRun
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: dryRun,
		Now:         func() time.Time { return landingTestNow },
	})

	_, err := f.router.RecordVerdict(context.Background(), VerdictInput{
		MissionID:    "msn_land",
		ThreadID:     "thr_a",
		ActorAgentID: "verifier_thr_a",
		Outcome:      "pass",
		Summary:      "verification passed",
		CommitSha:    "source-verified",
	})
	if !errors.Is(err, checkErr) {
		t.Fatalf("RecordVerdict error = %v, want transient dry-run error", err)
	}
	interrupted, _ := f.store.GetMission("msn_land")
	if got := landingThread(t, interrupted, "thr_a"); got.Status != ThreadStatusMergeChecking || got.RebaseAttempts != 0 {
		t.Fatalf("interrupted merge state = %+v", got)
	}

	failDryRun = false
	m, err := svc.MergeCheck(context.Background(), "msn_land", "thr_a", "")
	if err != nil {
		t.Fatalf("MergeCheck retry: %v", err)
	}
	got := landingThread(t, m, "thr_a")
	if got.Status != ThreadStatusReadyToLand || got.RebaseAttempts != 0 || got.MergeCheck == nil || !got.MergeCheck.Clean {
		t.Fatalf("retried merge state = %+v", got)
	}
	events, _ := f.store.ReadEvents("msn_land", 0, 0)
	if len(events) != 1 || events[0].Kind != EventMergeDryrunPassed {
		t.Fatalf("events = %+v", events)
	}
}
