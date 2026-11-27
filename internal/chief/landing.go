package chief

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

const (
	LandingDecisionKind  = "landing_approval"
	LandingOptionApprove = "approve"
	LandingOptionHold    = "hold"
)

// LandingHooks isolates repository mutation and time from mission state transitions.
type LandingHooks struct {
	DryRunMerge MergeChecker
	LandBranch  func(context.Context, workspace.LandOptions) (workspace.LandResult, error)
	Now         func() time.Time
}

// TrustedHumanApproval is constructed only by trusted server wiring after it
// establishes approval. RPC request booleans are intentionally not accepted.
type TrustedHumanApproval struct {
	approved bool
}

func NewTrustedHumanApproval() *TrustedHumanApproval {
	return &TrustedHumanApproval{approved: true}
}

type LandThreadInput struct {
	MissionID     string                `json:"missionId"`
	ThreadID      string                `json:"threadId"`
	ActorAgentID  string                `json:"actorAgentId,omitempty"`
	Strategy      string                `json:"strategy,omitempty"`
	CommitMessage string                `json:"commitMessage,omitempty"`
	Approval      *TrustedHumanApproval `json:"-"`
}

type LandThreadResult struct {
	Mission          *Mission
	ApprovalRequired bool
	Decision         *HumanDecision
	LandResult       *workspace.LandResult
}

// PostLandError means Git succeeded. Callers must reconcile the returned SHAs
// instead of blindly retrying the mutation.
type PostLandError struct {
	TargetSha string
	SourceSha string
	Err       error
}

func (e *PostLandError) Error() string {
	if e == nil {
		return "landing persisted incompletely"
	}
	return fmt.Sprintf("branch landed (target %s, source %s) but post-landing work failed: %v", e.TargetSha, e.SourceSha, e.Err)
}

func (e *PostLandError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *PostLandError) SafeToRetry() bool { return false }

// LandingService serializes landing and merge rechecks within each mission.
type LandingService struct {
	store  *Store
	router *Router
	hooks  LandingHooks

	mu           sync.Mutex
	missionLocks map[string]*sync.Mutex
}

func NewLandingService(store *Store, router *Router, hooks LandingHooks) *LandingService {
	if hooks.Now == nil {
		hooks.Now = func() time.Time { return time.Now().UTC() }
	}
	return &LandingService{store: store, router: router, hooks: hooks, missionLocks: make(map[string]*sync.Mutex)}
}

func (s *LandingService) lockMission(missionID string) func() {
	s.mu.Lock()
	lock := s.missionLocks[missionID]
	if lock == nil {
		lock = &sync.Mutex{}
		s.missionLocks[missionID] = lock
	}
	s.mu.Unlock()
	lock.Lock()
	return lock.Unlock
}

func (s *LandingService) nowString() string {
	return s.hooks.Now().UTC().Format(time.RFC3339Nano)
}

// MergeCheck refreshes a verified worktree thread against the moving mission base.
func (s *LandingService) MergeCheck(ctx context.Context, missionID, threadID, actorAgentID string) (*Mission, error) {
	unlock := s.lockMission(missionID)
	defer unlock()
	if s.hooks.DryRunMerge == nil {
		return nil, errors.New("merge checker is not configured")
	}
	m, err := s.store.GetMission(missionID)
	if err != nil {
		return nil, err
	}
	th, err := mergeCheckEligibleThread(m, threadID)
	if err != nil {
		return nil, err
	}
	check, err := s.hooks.DryRunMerge(ctx, *m, *th)
	if err != nil {
		return nil, err
	}
	if check.CheckedAt == "" {
		check.CheckedAt = s.nowString()
	}
	return s.recordMergeCheck(ctx, missionID, threadID, actorAgentID, check)
}

// LandThread verifies, optionally requests approval, atomically lands, and
// rechecks the remaining worktree threads.
func (s *LandingService) LandThread(ctx context.Context, in LandThreadInput) (*LandThreadResult, error) {
	unlock := s.lockMission(in.MissionID)
	defer unlock()

	m, err := s.store.GetMission(in.MissionID)
	if err != nil {
		return nil, err
	}
	th, err := landEligibleThread(m, in.ThreadID)
	if err != nil {
		return nil, err
	}
	strategy, err := landingStrategy(m, in.Strategy)
	if err != nil {
		return nil, err
	}
	commitMessage := strings.TrimSpace(in.CommitMessage)
	if m.Landing.RequireHumanApproval && (in.Approval == nil || !in.Approval.approved) {
		return s.requestLandingApproval(ctx, m, th, in.ActorAgentID, strategy, commitMessage)
	}
	if s.hooks.DryRunMerge == nil {
		return nil, errors.New("merge checker is not configured")
	}
	if s.hooks.LandBranch == nil {
		return nil, errors.New("branch lander is not configured")
	}

	verifiedSource := strings.TrimSpace(*th.MergeCheck.SourceSha)
	check, err := s.hooks.DryRunMerge(ctx, *m, *th)
	if err != nil {
		return nil, err
	}
	if check.SourceSha == nil || strings.TrimSpace(*check.SourceSha) == "" {
		return nil, errors.New("merge check returned no source SHA")
	}
	if strings.TrimSpace(*check.SourceSha) != verifiedSource {
		return nil, fmt.Errorf("source SHA changed after verification: verified %s, current %s", verifiedSource, *check.SourceSha)
	}
	if check.DirtyWorktree {
		return nil, errors.New("landing requires clean worktrees; target or source is dirty")
	}
	if check.CheckedAt == "" {
		check.CheckedAt = s.nowString()
	}
	if !check.Clean {
		updated, recordErr := s.recordMergeCheck(ctx, in.MissionID, in.ThreadID, in.ActorAgentID, check)
		result := &LandThreadResult{Mission: updated}
		if recordErr != nil {
			return result, recordErr
		}
		return result, fmt.Errorf("landing has merge conflicts: %s", strings.Join(check.ConflictingFiles, ", "))
	}

	landResult, err := s.hooks.LandBranch(ctx, workspace.LandOptions{
		TargetCwd:     m.BaseCwd,
		TargetBranch:  m.BaseBranch,
		SourceCwd:     th.Cwd,
		SourceBranch:  th.Branch,
		Strategy:      strategy,
		CommitMessage: commitMessage,
	})
	if err != nil {
		return nil, err
	}
	result := &LandThreadResult{LandResult: &landResult}
	postLand := func(err error) (*LandThreadResult, error) {
		latest, _ := s.store.GetMission(in.MissionID)
		result.Mission = latest
		return result, &PostLandError{TargetSha: landResult.TargetSha, SourceSha: landResult.SourceSha, Err: err}
	}
	if strings.TrimSpace(landResult.TargetSha) == "" || strings.TrimSpace(landResult.SourceSha) == "" {
		return postLand(errors.New("lander returned an empty target or source SHA"))
	}

	now := s.nowString()
	updated, _, err := s.store.UpdateMissionAndAppendEvent(in.MissionID, func(m *Mission) (Event, error) {
		th := findThread(m, in.ThreadID)
		if th == nil {
			return Event{}, ErrThreadNotFound
		}
		if th.Status != ThreadStatusReadyToLand {
			return Event{}, fmt.Errorf("thread status changed during landing: %s", th.Status)
		}
		persisted := check
		persisted.TargetRef = m.BaseBranch
		persisted.TargetSha = optStringPtr(landResult.TargetSha)
		persisted.SourceRef = th.Branch
		persisted.SourceSha = optStringPtr(landResult.SourceSha)
		persisted.CheckedAt = now
		persisted.Clean = true
		persisted.DirtyWorktree = false
		persisted.ConflictingFiles = nil
		th.MergeCheck = &persisted
		if th.LastSubmit != nil {
			th.LastSubmit.CommitSha = landResult.SourceSha
		}
		th.Status = ThreadStatusLanded
		th.UpdatedAt = now
		ReleaseSharedLocks(m, th.ID)
		reconcileMissionTerminal(m, now)
		return Event{
			ThreadID:      optStringPtr(in.ThreadID),
			Kind:          EventThreadLanded,
			ActorAgentID:  optStringPtr(in.ActorAgentID),
			TargetAgentID: optStringPtr(m.ChiefAgentID),
			Summary:       fmt.Sprintf("Thread %s landed into %s using %s.", in.ThreadID, m.BaseBranch, strategy),
			Payload: map[string]any{
				"targetRef": m.BaseBranch,
				"targetSha": landResult.TargetSha,
				"sourceRef": th.Branch,
				"sourceSha": landResult.SourceSha,
				"strategy":  strategy,
			},
			Ts: now,
		}, nil
	})
	if err != nil {
		return postLand(err)
	}
	result.Mission = updated
	if err := s.router.drainAgentBells(ctx, in.MissionID, m.ChiefAgentID); err != nil {
		return postLand(err)
	}
	if err := s.recheckLandingSiblings(ctx, in.MissionID, in.ThreadID); err != nil {
		return postLand(err)
	}
	latest, err := s.store.GetMission(in.MissionID)
	if err != nil {
		return postLand(err)
	}
	result.Mission = latest
	return result, nil
}

// CancelThread records cancellation only. The server adapter aborts active workers
// before calling this operation; worktrees and uncommitted work are left intact.
func (s *LandingService) CancelThread(ctx context.Context, missionID, threadID, actorAgentID string) (*Mission, error) {
	unlock := s.lockMission(missionID)
	defer unlock()
	m, err := s.store.GetMission(missionID)
	if err != nil {
		return nil, err
	}
	th := findThread(m, threadID)
	if th == nil {
		return nil, ErrThreadNotFound
	}
	if th.Status == ThreadStatusCanceled {
		return m, nil
	}
	if th.Status == ThreadStatusLanded || th.Status == ThreadStatusFailed {
		return nil, fmt.Errorf("cannot cancel thread in terminal state %s", th.Status)
	}
	now := s.nowString()
	_, err = s.store.UpdateMission(missionID, func(m *Mission) error {
		th := findThread(m, threadID)
		if th == nil {
			return ErrThreadNotFound
		}
		if th.Status == ThreadStatusCanceled {
			return nil
		}
		if th.Status == ThreadStatusLanded || th.Status == ThreadStatusFailed {
			return fmt.Errorf("cannot cancel thread in terminal state %s", th.Status)
		}
		th.Status = ThreadStatusCanceled
		th.UpdatedAt = now
		ReleaseSharedLocks(m, threadID)
		reconcileMissionTerminal(m, now)
		return nil
	})
	if err != nil {
		return nil, err
	}
	_, err = s.store.AppendEvent(missionID, Event{
		ThreadID:      optStringPtr(threadID),
		Kind:          EventThreadCanceled,
		ActorAgentID:  optStringPtr(actorAgentID),
		TargetAgentID: optStringPtr(m.ChiefAgentID),
		Summary:       fmt.Sprintf("Thread %s canceled; worktree and uncommitted work preserved.", threadID),
		Ts:            now,
	})
	if err != nil {
		return nil, err
	}
	if err := s.router.drainAgentBells(ctx, missionID, m.ChiefAgentID); err != nil {
		return nil, err
	}
	return s.store.GetMission(missionID)
}

func landEligibleThread(m *Mission, threadID string) (*Thread, error) {
	if m.Tier != TierL2 {
		return nil, errors.New("landing requires an L2 mission")
	}
	th := findThread(m, threadID)
	if th == nil {
		return nil, ErrThreadNotFound
	}
	if th.Isolation != IsolationWorktree {
		return nil, errors.New("landing requires a worktree thread")
	}
	if th.Status != ThreadStatusReadyToLand {
		return nil, fmt.Errorf("thread is %s, not ready_to_land", th.Status)
	}
	if th.LastVerdict == nil || th.LastVerdict.Outcome != "pass" || th.LastVerdict.Tainted {
		return nil, errors.New("landing requires an untainted passing verdict")
	}
	if th.MergeCheck == nil || !th.MergeCheck.Clean || th.MergeCheck.DirtyWorktree ||
		th.MergeCheck.SourceSha == nil || strings.TrimSpace(*th.MergeCheck.SourceSha) == "" {
		return nil, errors.New("landing requires a clean merge check with a verified source SHA")
	}
	return th, nil
}

func mergeCheckEligibleThread(m *Mission, threadID string) (*Thread, error) {
	if m.Tier != TierL2 {
		return nil, errors.New("merge check requires an L2 mission")
	}
	th := findThread(m, threadID)
	if th == nil {
		return nil, ErrThreadNotFound
	}
	if th.Isolation != IsolationWorktree || (th.Status != ThreadStatusReadyToLand && th.Status != ThreadStatusNeedsRebase && th.Status != ThreadStatusMergeChecking) {
		return nil, fmt.Errorf("%w: merge check requires a ready, conflicted, or merge-checking worktree thread", ErrInvalidThreadState)
	}
	if th.LastVerdict == nil || th.LastVerdict.Outcome != "pass" || th.LastVerdict.Tainted {
		return nil, errors.New("merge check requires an untainted passing verdict")
	}
	return th, nil
}

func landingStrategy(m *Mission, override string) (string, error) {
	policy := m.Landing
	if policy == nil {
		defaults := DefaultLandingPolicy()
		policy = &defaults
	}
	mode := strings.TrimSpace(policy.Mode)
	if mode == "" {
		mode = DefaultLandingMode
	}
	if mode == "open_pr" {
		return "", errors.New("open_pr landing is unsupported in this wave")
	}
	if mode != "merge_local" {
		return "", fmt.Errorf("unsupported landing mode %q", mode)
	}
	strategy := strings.TrimSpace(override)
	if strategy == "" {
		strategy = strings.TrimSpace(policy.Strategy)
	}
	if strategy == "" {
		strategy = DefaultLandingStrategy
	}
	if strategy == "open_pr" {
		return "", errors.New("open_pr landing is unsupported in this wave")
	}
	switch strategy {
	case "merge", "squash", "rebase":
		return strategy, nil
	default:
		return "", fmt.Errorf("unsupported landing strategy %q", strategy)
	}
}

func (s *LandingService) requestLandingApproval(ctx context.Context, m *Mission, th *Thread, actorAgentID, strategy, commitMessage string) (*LandThreadResult, error) {
	now := s.nowString()
	created := false
	updated, err := s.store.UpdateMission(m.ID, func(current *Mission) error {
		if current.PendingDecision != nil && current.PendingDecision.ResolvedAt == nil {
			return nil
		}
		threadID := th.ID
		current.PendingDecision = &HumanDecision{
			ID:       NewID("landing_approval"),
			Kind:     LandingDecisionKind,
			Title:    "Approve landing " + th.ID,
			Summary:  fmt.Sprintf("Approve landing thread %s into %s.", th.ID, current.BaseBranch),
			ThreadID: &threadID,
			Options: []HumanDecisionOption{
				{ID: LandingOptionApprove, Label: "Approve", Style: "primary"},
				{ID: LandingOptionHold, Label: "Hold", Style: "secondary"},
			},
			CreatedAt:            now,
			LandingStrategy:      strategy,
			LandingCommitMessage: commitMessage,
		}
		current.Status = MissionStatusWaitingHuman
		created = true
		return nil
	})
	if err != nil {
		return nil, err
	}
	result := &LandThreadResult{Mission: updated, ApprovalRequired: true, Decision: updated.PendingDecision}
	if !created {
		return result, nil
	}
	_, err = s.store.AppendEvent(m.ID, Event{
		ThreadID:      optStringPtr(th.ID),
		Kind:          EventDecisionRequested,
		ActorAgentID:  optStringPtr(actorAgentID),
		TargetAgentID: optStringPtr(m.ChiefAgentID),
		Summary:       fmt.Sprintf("Landing approval requested for thread %s.", th.ID),
		Payload:       map[string]any{"decisionId": updated.PendingDecision.ID, "kind": LandingDecisionKind},
		Ts:            now,
	})
	if err != nil {
		return result, err
	}
	if err := s.router.drainAgentBells(ctx, m.ID, m.ChiefAgentID); err != nil {
		return result, err
	}
	latest, err := s.store.GetMission(m.ID)
	if err != nil {
		return result, err
	}
	result.Mission = latest
	result.Decision = latest.PendingDecision
	return result, nil
}

func (s *LandingService) recordMergeCheck(ctx context.Context, missionID, threadID, actorAgentID string, check MergeDryRunResult) (*Mission, error) {
	now := s.nowString()
	var route mergeCheckRoute
	_, _, err := s.store.UpdateMissionAndAppendEvent(missionID, func(m *Mission) (Event, error) {
		if err := requireMissionNonTerminal(m); err != nil {
			return Event{}, err
		}
		th, err := mergeCheckEligibleThread(m, threadID)
		if err != nil {
			return Event{}, err
		}
		route = applyMergeCheckResult(m, th, check, now, fmt.Sprintf("Thread %s passed dry-run merge; ready to land.", threadID))
		eventActor := actorAgentID
		if strings.TrimSpace(eventActor) == "" {
			eventActor = th.VerifierAgentID
		}
		return Event{
			ThreadID:      optStringPtr(threadID),
			Kind:          route.kind,
			ActorAgentID:  optStringPtr(eventActor),
			TargetAgentID: optStringPtr(route.target),
			Summary:       route.summary,
			Payload: map[string]any{
				"conflictingFiles": check.ConflictingFiles,
				"targetSha":        check.TargetSha,
				"sourceSha":        check.SourceSha,
			},
			Ts: now,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if route.kind == EventMergeDryrunPassed && s.router.hooks.WakeCoalesceWindow > 0 {
		s.router.scheduleCoalescedBell(missionID, route.target)
	} else if err := s.router.drainAgentBells(ctx, missionID, route.target); err != nil {
		return nil, err
	}
	return s.store.GetMission(missionID)
}

func (s *LandingService) recheckLandingSiblings(ctx context.Context, missionID, landedThreadID string) error {
	m, err := s.store.GetMission(missionID)
	if err != nil {
		return err
	}
	for _, snapshot := range m.Threads {
		if snapshot.ID == landedThreadID || snapshot.Isolation != IsolationWorktree ||
			(snapshot.Status != ThreadStatusReadyToLand && snapshot.Status != ThreadStatusNeedsRebase) ||
			snapshot.LastVerdict == nil || snapshot.LastVerdict.Outcome != "pass" || snapshot.LastVerdict.Tainted {
			continue
		}
		current, err := s.store.GetMission(missionID)
		if err != nil {
			return err
		}
		th := findThread(current, snapshot.ID)
		if th == nil || (th.Status != ThreadStatusReadyToLand && th.Status != ThreadStatusNeedsRebase) {
			continue
		}
		check, err := s.hooks.DryRunMerge(ctx, *current, *th)
		if err != nil {
			return err
		}
		if check.CheckedAt == "" {
			check.CheckedAt = s.nowString()
		}
		if _, err := s.recordMergeCheck(ctx, missionID, snapshot.ID, "", check); err != nil {
			return err
		}
	}
	return nil
}

func reconcileMissionTerminal(m *Mission, now string) {
	if len(m.Threads) == 0 {
		return
	}
	for _, th := range m.Threads {
		switch th.Status {
		case ThreadStatusLanded, ThreadStatusCanceled, ThreadStatusFailed:
		default:
			return
		}
	}
	m.Status = MissionStatusCompleted
	if m.CompletedAt == nil {
		m.CompletedAt = optStringPtr(now)
	}
}
