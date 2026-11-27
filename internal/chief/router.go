package chief

import (
	"context"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

var (
	// ErrOwnedPathViolation is returned when an author submits edits outside its ownedPaths/sharedLocks.
	ErrOwnedPathViolation = errors.New("owned path violation")
	// ErrActorMismatch is returned when an actor attempts to submit or judge another agent's thread.
	ErrActorMismatch = errors.New("actor agent mismatch")
	// ErrInvalidThreadState is returned when a lifecycle operation is invalid for the current thread or mission state.
	ErrInvalidThreadState = errors.New("invalid thread state")
)

// OwnershipError carries the exact files that violated a thread's ownedPaths boundary.
type OwnershipError struct {
	ThreadID   string
	Violations []string
}

func (e *OwnershipError) Error() string {
	if e == nil {
		return ErrOwnedPathViolation.Error()
	}
	return fmt.Sprintf("%s on thread %s: %s", ErrOwnedPathViolation.Error(), e.ThreadID, strings.Join(e.Violations, ", "))
}

func (e *OwnershipError) Is(target error) bool {
	return target == ErrOwnedPathViolation
}

// AgentMessenger bridges Chief Router to BySpace agent session loading and prompting.
type AgentMessenger interface {
	GetAgentState(agentID string) AgentRuntimeState
	EnsureLoaded(ctx context.Context, agentID string) error
	SendPrompt(ctx context.Context, agentID string, wrappedPrompt string) error
}

// MergeChecker runs a dry-run merge check on a verified L2 worktree thread.
type MergeChecker func(ctx context.Context, mission Mission, thread Thread) (MergeDryRunResult, error)

// HumanNotifier dispatches a single deduplicated human-actionable escalation (e.g. via Chief permission attention).
type HumanNotifier func(ctx context.Context, missionID, chiefAgentID string, att SystemAttention)

// RouterHooks inject external runtime dependencies into Router.
type RouterHooks struct {
	Messenger             AgentMessenger
	DryRunMerge           MergeChecker
	NotifyHuman           HumanNotifier
	Now                   func() time.Time
	WakeCoalesceWindow    time.Duration
	ScheduleCoalesceTimer func(d time.Duration, fn func()) (stop func())
}

// SubmitThreadInput carries an author's completion handoff into verification.
type SubmitThreadInput struct {
	MissionID    string   `json:"missionId"`
	ThreadID     string   `json:"threadId"`
	ActorAgentID string   `json:"actorAgentId,omitempty"`
	Summary      string   `json:"summary"`
	Tests        string   `json:"tests,omitempty"`
	CommitSha    string   `json:"commitSha,omitempty"`
	ChangedFiles []string `json:"changedFiles,omitempty"`
}

// VerdictInput carries a read-only verifier's pass/reject result.
type VerdictInput struct {
	MissionID       string   `json:"missionId"`
	ThreadID        string   `json:"threadId"`
	ActorAgentID    string   `json:"actorAgentId,omitempty"`
	Outcome         string   `json:"outcome"` // "pass" | "reject"
	Summary         string   `json:"summary"`
	Issues          []string `json:"issues,omitempty"`
	CheckedCommands []string `json:"checkedCommands,omitempty"`
	CommitSha       string   `json:"commitSha,omitempty"`
	VerifierMutated bool     `json:"verifierMutated,omitempty"`
	MutationDetails string   `json:"mutationDetails,omitempty"`
}

// TurnCompletionContext provides post-turn signals for unreported-turn detection.
type TurnCompletionContext struct {
	HasUnreportedChanges bool
	ChangedFiles         []string
}

type agentBellWorker struct {
	mu       sync.Mutex
	running  bool
	rerun    bool
	missions map[string]bool
}

// Router manages Resume-on-Bell delivery, peer handoffs, unreported-turn reminders,
// and deduplicated human-actionable incident escalations.
type Router struct {
	store *Store
	hooks RouterHooks

	bellMu      sync.Mutex
	bellWorkers map[string]*agentBellWorker

	coalesceMu     sync.Mutex
	coalesceTimers map[string]func()
	closed         bool
}

// NewRouter creates a Chief event/bell router backed by store and runtime hooks.
func NewRouter(store *Store, hooks RouterHooks) *Router {
	if hooks.Now == nil {
		hooks.Now = func() time.Time { return time.Now().UTC() }
	}
	return &Router{
		store:          store,
		hooks:          hooks,
		bellWorkers:    make(map[string]*agentBellWorker),
		coalesceTimers: make(map[string]func()),
	}
}

// Close cancels pending wake-coalesce timers cleanly during Server.Close.
func (r *Router) Close() {
	r.coalesceMu.Lock()
	r.closed = true
	for key, stop := range r.coalesceTimers {
		if stop != nil {
			stop()
		}
		delete(r.coalesceTimers, key)
	}
	r.coalesceMu.Unlock()
}

func (r *Router) nowString() string {
	return r.hooks.Now().UTC().Format(time.RFC3339Nano)
}

// RecordProgress stamps LastProgressAt and clears prior stall markers for the agent's thread.
func (r *Router) RecordProgress(missionID, agentID string) error {
	if strings.TrimSpace(missionID) == "" || strings.TrimSpace(agentID) == "" {
		return nil
	}
	now := r.nowString()
	_, err := r.store.UpdateMission(missionID, func(m *Mission) error {
		for i := range m.Threads {
			th := &m.Threads[i]
			if th.AuthorAgentID == agentID || th.VerifierAgentID == agentID || th.IntegratorAgentID == agentID {
				th.LastProgressAt = now
				th.SoftStallWarnedAt = ""
				th.HardStallTriggeredAt = ""
				th.UpdatedAt = now
			}
		}
		return nil
	})
	return err
}

// RingBell queues a durable bell for agentID and delivers unread delta events when idle/closed.
func (r *Router) RingBell(ctx context.Context, missionID, agentID, reason string) error {
	if strings.TrimSpace(missionID) == "" || strings.TrimSpace(agentID) == "" {
		return nil
	}
	m, err := r.store.GetMission(missionID)
	if err != nil {
		return err
	}
	if err := r.store.EnqueueBell(missionID, agentID, m.HeadSeq, reason); err != nil {
		return err
	}
	return r.drainAgentBells(ctx, missionID, agentID)
}

// ReplayPendingBells replays all durable pending bells recovered from disk on daemon boot.
func (r *Router) ReplayPendingBells(ctx context.Context) error {
	entries, err := r.store.RecoverPendingBells()
	if err != nil {
		return err
	}
	var firstErr error
	for _, entry := range entries {
		if err := r.drainAgentBells(ctx, entry.MissionID, entry.AgentID); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// OnAgentTurnCompleted drains deferred bells for agentID and checks the unreported-turn safety net.
func (r *Router) OnAgentTurnCompleted(ctx context.Context, agentID string, turn TurnCompletionContext) error {
	if strings.TrimSpace(agentID) == "" {
		return nil
	}
	missions, err := r.store.ListMissions()
	if err != nil {
		return err
	}

	var firstErr error
	for _, m := range missions {
		if m.Status == MissionStatusCompleted || m.Status == MissionStatusCanceled || m.Status == MissionStatusFailed {
			continue
		}
		for _, th := range m.Threads {
			if th.AuthorAgentID == agentID || th.VerifierAgentID == agentID || th.IntegratorAgentID == agentID {
				_ = r.RecordProgress(m.ID, agentID)
			}
			if turn.HasUnreportedChanges &&
				th.AuthorAgentID == agentID &&
				(th.Status == ThreadStatusAuthoring || th.Status == ThreadStatusQueued || th.Status == ThreadStatusNeedsRebase) &&
				!th.UnreportedReminderSent {
				if remErr := r.sendUnreportedTurnReminder(ctx, m.ID, th.ID, agentID, turn.ChangedFiles); remErr != nil && firstErr == nil {
					firstErr = remErr
				}
			}
		}
		if pb := m.PendingBells[agentID]; pb != nil && m.Cursors[agentID] < pb.TargetSeq {
			if drainErr := r.drainAgentBells(ctx, m.ID, agentID); drainErr != nil && firstErr == nil {
				firstErr = drainErr
			}
		}
	}
	return firstErr
}

// OnAgentTurnInterrupted drains deferred bells when an agent turn ends via cancel or failure.
func (r *Router) OnAgentTurnInterrupted(ctx context.Context, agentID string) error {
	if strings.TrimSpace(agentID) == "" {
		return nil
	}
	missions, err := r.store.ListMissions()
	if err != nil {
		return err
	}
	var firstErr error
	for _, m := range missions {
		if m.Status == MissionStatusCompleted || m.Status == MissionStatusCanceled || m.Status == MissionStatusFailed {
			continue
		}
		if pb := m.PendingBells[agentID]; pb != nil && m.Cursors[agentID] < pb.TargetSeq {
			if drainErr := r.drainAgentBells(ctx, m.ID, agentID); drainErr != nil && firstErr == nil {
				firstErr = drainErr
			}
		}
	}
	return firstErr
}

var errUnreportedReminderAlreadySent = errors.New("unreported reminder already sent")

func (r *Router) sendUnreportedTurnReminder(ctx context.Context, missionID, threadID, authorAgentID string, changedFiles []string) error {
	now := r.nowString()
	summary := fmt.Sprintf("Unreported changes detected on thread %s. Run `byspace chief thread submit --mission %s --thread %s --summary \"...\"` when ready for verification, or explain blockers.", threadID, missionID, threadID)
	if len(changedFiles) > 0 {
		summary += " Changed: " + strings.Join(changedFiles, ", ")
	}
	_, _, err := r.store.UpdateMissionAndAppendEvent(missionID, func(m *Mission) (Event, error) {
		if err := requireMissionNonTerminal(m); err != nil {
			return Event{}, err
		}
		th := findThread(m, threadID)
		if th == nil {
			return Event{}, ErrThreadNotFound
		}
		if th.AuthorAgentID != authorAgentID {
			return Event{}, fmt.Errorf("%w: expected %s, got %s", ErrActorMismatch, th.AuthorAgentID, authorAgentID)
		}
		if err := requireThreadState(m, th, ThreadStatusQueued, ThreadStatusAuthoring, ThreadStatusNeedsRebase); err != nil {
			return Event{}, err
		}
		if th.UnreportedReminderSent {
			return Event{}, errUnreportedReminderAlreadySent
		}
		th.UnreportedReminderSent = true
		th.UpdatedAt = now
		return Event{
			ThreadID:      optStringPtr(threadID),
			Kind:          EventUnreportedTurnReminded,
			TargetAgentID: optStringPtr(authorAgentID),
			Summary:       summary,
			Payload: map[string]any{
				"changedFiles": changedFiles,
			},
			Ts: now,
		}, nil
	})
	if errors.Is(err, errUnreportedReminderAlreadySent) {
		return nil
	}
	if err != nil {
		return err
	}
	return r.drainAgentBells(ctx, missionID, authorAgentID)
}

// SubmitThread validates ownership/actor, transitions thread to verifying, and rings Verifier directly.
func (r *Router) SubmitThread(ctx context.Context, in SubmitThreadInput) (*Mission, error) {
	missionID, err := r.resolveMissionID(in.MissionID, in.ThreadID)
	if err != nil {
		return nil, err
	}

	now := r.nowString()
	var targetAgentID string
	updated, _, err := r.store.UpdateMissionAndAppendEvent(missionID, func(m *Mission) (Event, error) {
		th := findThread(m, in.ThreadID)
		if th == nil {
			return Event{}, ErrThreadNotFound
		}
		if strings.TrimSpace(in.ActorAgentID) != "" && th.AuthorAgentID != "" && strings.TrimSpace(in.ActorAgentID) != th.AuthorAgentID {
			return Event{}, fmt.Errorf("%w: expected %s, got %s", ErrActorMismatch, th.AuthorAgentID, in.ActorAgentID)
		}
		if err := requireThreadState(m, th, ThreadStatusQueued, ThreadStatusAuthoring, ThreadStatusNeedsRebase); err != nil {
			return Event{}, err
		}
		if err := ClaimSharedLocks(m, th.ID, in.ChangedFiles); err != nil {
			return Event{}, err
		}

		th.Status = ThreadStatusVerifying
		th.UnreportedReminderSent = false
		th.LastProgressAt = now
		th.SoftStallWarnedAt = ""
		th.HardStallTriggeredAt = ""
		th.LastSubmit = &ThreadSubmission{
			ActorAgentID: in.ActorAgentID,
			Summary:      strings.TrimSpace(in.Summary),
			Tests:        strings.TrimSpace(in.Tests),
			CommitSha:    strings.TrimSpace(in.CommitSha),
			ChangedFiles: append([]string(nil), in.ChangedFiles...),
			SubmittedAt:  now,
		}
		th.UpdatedAt = now
		if th.VerifierAgentID != "" {
			targetAgentID = th.VerifierAgentID
		} else {
			targetAgentID = m.ChiefAgentID
		}
		evSummary := fmt.Sprintf("Thread %s submitted for verification. Goal: %s", in.ThreadID, th.Goal)
		if len(in.ChangedFiles) > 0 {
			evSummary += " | Files: " + strings.Join(in.ChangedFiles, ", ")
		}
		if strings.TrimSpace(in.CommitSha) != "" {
			evSummary += " | Ref: " + strings.TrimSpace(in.CommitSha)
		}
		return Event{
			ThreadID:      optStringPtr(in.ThreadID),
			Kind:          EventAuthorSubmitted,
			ActorAgentID:  optStringPtr(in.ActorAgentID),
			TargetAgentID: optStringPtr(targetAgentID),
			Summary:       evSummary,
			Payload: map[string]any{
				"goal":               th.Goal,
				"acceptanceCriteria": append([]string(nil), th.AcceptanceCriteria...),
				"changedFiles":       append([]string(nil), in.ChangedFiles...),
				"commitSha":          in.CommitSha,
				"tests":              in.Tests,
			},
			Ts: now,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if err := r.drainAgentBells(ctx, missionID, targetAgentID); err != nil {
		return updated, err
	}
	return r.store.GetMission(missionID)
}

type mergeCheckRoute struct {
	target  string
	kind    string
	summary string
}

func applyMergeCheckResult(m *Mission, th *Thread, check MergeDryRunResult, now, cleanSummary string) mergeCheckRoute {
	th.MergeCheck = &check
	th.UpdatedAt = now
	if check.Clean && !check.DirtyWorktree {
		th.Status = ThreadStatusReadyToLand
		return mergeCheckRoute{target: m.ChiefAgentID, kind: EventMergeDryrunPassed, summary: cleanSummary}
	}

	th.Status = ThreadStatusNeedsRebase
	if th.RebaseAttempts == 0 && th.AuthorAgentID != "" {
		th.RebaseAttempts++
		return mergeCheckRoute{
			target:  th.AuthorAgentID,
			kind:    EventRebaseRequested,
			summary: fmt.Sprintf("Thread %s conflicts with base (%s); auto-rebase #1 routed to Author.", th.ID, strings.Join(check.ConflictingFiles, ", ")),
		}
	}
	if th.IntegratorAgentID != "" {
		return mergeCheckRoute{
			target:  th.IntegratorAgentID,
			kind:    EventMergeDryrunConflict,
			summary: fmt.Sprintf("Thread %s conflict persists after rebase; routed to Integrator.", th.ID),
		}
	}
	return mergeCheckRoute{
		target:  m.ChiefAgentID,
		kind:    EventMergeDryrunConflict,
		summary: fmt.Sprintf("Thread %s conflict requires Chief intervention.", th.ID),
	}
}

// RecordVerdict applies a Verifier's verdict, enforcing universal mutation audit and
// peer loop routing (reject #1 -> Author, reject >= 2 -> Chief escalation).
func (r *Router) RecordVerdict(ctx context.Context, in VerdictInput) (*Mission, error) {
	missionID, err := r.resolveMissionID(in.MissionID, in.ThreadID)
	if err != nil {
		return nil, err
	}
	outcome := strings.ToLower(strings.TrimSpace(in.Outcome))
	if outcome != "pass" && outcome != "reject" {
		return nil, fmt.Errorf("invalid verdict outcome %q (want pass or reject)", in.Outcome)
	}
	if in.VerifierMutated {
		return r.recordVerifierMutation(ctx, missionID, in, false)
	}
	if outcome == "pass" && r.hooks.DryRunMerge != nil {
		m, err := r.store.GetMission(missionID)
		if err != nil {
			return nil, err
		}
		th := findThread(m, in.ThreadID)
		if th == nil {
			return nil, ErrThreadNotFound
		}
		if m.Tier == TierL2 && th.Isolation == IsolationWorktree {
			return r.recordMergeVerdict(ctx, missionID, in)
		}
	}
	return r.recordStandardVerdict(ctx, missionID, in, outcome)
}

func (r *Router) recordStandardVerdict(ctx context.Context, missionID string, in VerdictInput, outcome string) (*Mission, error) {
	now := r.nowString()
	pass := outcome == "pass"
	var targetAgentID string
	var readyToLand bool
	_, _, err := r.store.UpdateMissionAndAppendEvent(missionID, func(m *Mission) (Event, error) {
		th := findThread(m, in.ThreadID)
		if th == nil {
			return Event{}, ErrThreadNotFound
		}
		if err := validateVerdictActor(th, in.ActorAgentID); err != nil {
			return Event{}, err
		}
		if err := requireThreadState(m, th, ThreadStatusVerifying); err != nil {
			return Event{}, err
		}
		resetVerdictProgress(th, now)
		th.LastVerdict = &VerifyVerdict{
			Outcome:         outcome,
			Summary:         strings.TrimSpace(in.Summary),
			Issues:          append([]string(nil), in.Issues...),
			CheckedCommands: append([]string(nil), in.CheckedCommands...),
			VerifiedAt:      now,
			VerifierAgentID: optStringPtr(in.ActorAgentID),
			CommitSha:       optStringPtr(in.CommitSha),
		}
		if !pass {
			th.VerifyRejectCount++
			summary := fmt.Sprintf("Thread %s escalated to Chief after %d verifier rejections: %s", in.ThreadID, th.VerifyRejectCount, in.Summary)
			kind := EventEscalatedToChief
			targetAgentID = m.ChiefAgentID
			if th.VerifyRejectCount == 1 {
				th.Status = ThreadStatusAuthoring
				targetAgentID = th.AuthorAgentID
				kind = EventVerifyRejected
				summary = fmt.Sprintf("Verifier rejected thread %s (attempt #1): %s", in.ThreadID, in.Summary)
				if len(in.Issues) > 0 {
					summary += " | Issues: " + strings.Join(in.Issues, "; ")
				}
			} else {
				th.Status = ThreadStatusBlocked
			}
			th.UpdatedAt = now
			return Event{
				ThreadID: optStringPtr(in.ThreadID), Kind: kind,
				ActorAgentID: optStringPtr(in.ActorAgentID), TargetAgentID: optStringPtr(targetAgentID),
				Summary: summary,
				Payload: map[string]any{"rejectCount": th.VerifyRejectCount, "issues": in.Issues, "checkedCommands": in.CheckedCommands},
				Ts:      now,
			}, nil
		}

		targetAgentID = m.ChiefAgentID
		readyToLand = m.Tier == TierL2 && th.Isolation == IsolationWorktree
		if readyToLand {
			th.Status = ThreadStatusReadyToLand
		} else {
			th.Status = ThreadStatusLanded
			ReleaseSharedLocks(m, th.ID)
			reconcileMissionTerminal(m, now)
		}
		th.UpdatedAt = now
		summary := fmt.Sprintf("Thread %s passed verification.", in.ThreadID)
		if readyToLand {
			summary = fmt.Sprintf("Thread %s passed verification; ready to land.", in.ThreadID)
		}
		return Event{
			ThreadID: optStringPtr(in.ThreadID), Kind: EventVerifyPassed,
			ActorAgentID: optStringPtr(in.ActorAgentID), TargetAgentID: optStringPtr(targetAgentID),
			Summary: summary, Ts: now,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if pass && readyToLand && r.hooks.WakeCoalesceWindow > 0 {
		r.scheduleCoalescedBell(missionID, targetAgentID)
	} else if err := r.drainAgentBells(ctx, missionID, targetAgentID); err != nil {
		return nil, err
	}
	return r.store.GetMission(missionID)
}

func (r *Router) recordMergeVerdict(ctx context.Context, missionID string, in VerdictInput) (*Mission, error) {
	now := r.nowString()
	_, err := r.store.UpdateMission(missionID, func(m *Mission) error {
		th := findThread(m, in.ThreadID)
		if th == nil {
			return ErrThreadNotFound
		}
		if err := validateVerdictActor(th, in.ActorAgentID); err != nil {
			return err
		}
		if err := requireMissionNonTerminal(m); err != nil {
			return err
		}
		switch th.Status {
		case ThreadStatusVerifying:
			resetVerdictProgress(th, now)
			th.LastVerdict = &VerifyVerdict{
				Outcome: "pass", Summary: strings.TrimSpace(in.Summary),
				Issues: append([]string(nil), in.Issues...), CheckedCommands: append([]string(nil), in.CheckedCommands...),
				VerifiedAt: now, VerifierAgentID: optStringPtr(in.ActorAgentID), CommitSha: optStringPtr(in.CommitSha),
			}
			th.Status = ThreadStatusMergeChecking
			th.UpdatedAt = now
		case ThreadStatusMergeChecking:
			if th.LastVerdict == nil || th.LastVerdict.Outcome != "pass" || th.LastVerdict.Tainted {
				return fmt.Errorf("%w: thread %s has no retryable passing verdict", ErrInvalidThreadState, th.ID)
			}
		default:
			return fmt.Errorf("%w: thread %s is %s, want verifying", ErrInvalidThreadState, th.ID, th.Status)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	mNow, err := r.store.GetMission(missionID)
	if err != nil {
		return nil, err
	}
	thNow := findThread(mNow, in.ThreadID)
	if thNow == nil {
		return nil, ErrThreadNotFound
	}
	mc, err := r.hooks.DryRunMerge(ctx, *mNow, *thNow)
	if err != nil {
		return nil, err
	}
	if mc.CheckedAt == "" {
		mc.CheckedAt = now
	}

	var route mergeCheckRoute
	_, _, err = r.store.UpdateMissionAndAppendEvent(missionID, func(m *Mission) (Event, error) {
		th := findThread(m, in.ThreadID)
		if th == nil {
			return Event{}, ErrThreadNotFound
		}
		if err := validateVerdictActor(th, in.ActorAgentID); err != nil {
			return Event{}, err
		}
		if err := requireThreadState(m, th, ThreadStatusMergeChecking); err != nil {
			return Event{}, err
		}
		if th.LastVerdict == nil || th.LastVerdict.Outcome != "pass" || th.LastVerdict.Tainted {
			return Event{}, fmt.Errorf("%w: thread %s has no retryable passing verdict", ErrInvalidThreadState, th.ID)
		}
		route = applyMergeCheckResult(m, th, mc, now, fmt.Sprintf("Thread %s passed verification and dry-run merge; ready to land.", in.ThreadID))
		return Event{
			ThreadID: optStringPtr(in.ThreadID), Kind: route.kind,
			ActorAgentID: optStringPtr(in.ActorAgentID), TargetAgentID: optStringPtr(route.target),
			Summary: route.summary, Ts: now,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if route.kind == EventMergeDryrunPassed && r.hooks.WakeCoalesceWindow > 0 {
		r.scheduleCoalescedBell(missionID, route.target)
	} else if err := r.drainAgentBells(ctx, missionID, route.target); err != nil {
		return nil, err
	}
	return r.store.GetMission(missionID)
}

func (r *Router) AuditVerifierMutation(ctx context.Context, in VerdictInput) (*Mission, error) {
	missionID, err := r.resolveMissionID(in.MissionID, in.ThreadID)
	if err != nil {
		return nil, err
	}
	in.VerifierMutated = true
	return r.recordVerifierMutation(ctx, missionID, in, true)
}

func (r *Router) recordVerifierMutation(ctx context.Context, missionID string, in VerdictInput, postTurnAudit bool) (*Mission, error) {
	now := r.nowString()
	terminal := false
	chiefAgentID := ""
	mutationSummary := ClampSummary("Verifier violated read-only contract: " + in.MutationDetails)
	updated, _, err := r.store.UpdateMissionAndAppendEvent(missionID, func(m *Mission) (Event, error) {
		th := findThread(m, in.ThreadID)
		if th == nil {
			return Event{}, ErrThreadNotFound
		}
		if err := validateVerdictActor(th, in.ActorAgentID); err != nil {
			return Event{}, err
		}
		if !postTurnAudit {
			if err := requireThreadState(m, th, ThreadStatusVerifying); err != nil {
				return Event{}, err
			}
		} else {
			terminal = isTerminalMissionStatus(m.Status) || th.Status == ThreadStatusLanded || th.Status == ThreadStatusCanceled || th.Status == ThreadStatusFailed
		}
		chiefAgentID = m.ChiefAgentID
		if terminal {
			return Event{
				ThreadID: optStringPtr(in.ThreadID), Kind: EventVerifierMutationViolation,
				ActorAgentID: optStringPtr(in.ActorAgentID), Summary: mutationSummary,
				Payload: map[string]any{
					"postTurnAudit": true, "mutationDetails": in.MutationDetails,
					"threadStatus": th.Status, "missionStatus": m.Status,
				},
				Ts: now,
			}, nil
		}

		resetVerdictProgress(th, now)
		th.Status = ThreadStatusBlocked
		th.LastVerdict = &VerifyVerdict{
			Outcome: "reject", Summary: "tainted verdict: verifier modified checkout",
			Issues: []string{in.MutationDetails}, VerifiedAt: now,
			VerifierAgentID: optStringPtr(in.ActorAgentID), Tainted: true,
		}
		th.UpdatedAt = now
		return Event{
			ThreadID: optStringPtr(in.ThreadID), Kind: EventVerifierMutationViolation,
			ActorAgentID: optStringPtr(in.ActorAgentID), TargetAgentID: optStringPtr(chiefAgentID),
			Summary: mutationSummary, Ts: now,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if terminal {
		return updated, nil
	}
	att := SystemAttention{
		Kind: AttentionKindVerifyEscalated, Severity: SeverityFatal, Summary: mutationSummary,
		AgentID: optStringPtr(in.ActorAgentID), ThreadID: optStringPtr(in.ThreadID), Since: now,
	}
	if _, err := r.RaiseIncident(ctx, missionID, in.ThreadID, att, true); err != nil {
		return updated, err
	}
	if err := r.drainAgentBells(ctx, missionID, chiefAgentID); err != nil {
		return updated, err
	}
	return r.store.GetMission(missionID)
}

func (r *Router) resolveMissionID(missionID, threadID string) (string, error) {
	missionID = strings.TrimSpace(missionID)
	if missionID != "" {
		return missionID, nil
	}
	found, err := r.store.FindMissionByThread(threadID)
	if err != nil {
		return "", err
	}
	return found.ID, nil
}

func validateVerdictActor(th *Thread, actorAgentID string) error {
	if strings.TrimSpace(actorAgentID) != "" && th.VerifierAgentID != "" && strings.TrimSpace(actorAgentID) != th.VerifierAgentID {
		return fmt.Errorf("%w: expected %s, got %s", ErrActorMismatch, th.VerifierAgentID, actorAgentID)
	}
	return nil
}

func requireThreadState(m *Mission, th *Thread, allowed ...string) error {
	if err := requireMissionNonTerminal(m); err != nil {
		return err
	}
	for _, status := range allowed {
		if th.Status == status {
			return nil
		}
	}
	return fmt.Errorf("%w: thread %s is %s, want %s", ErrInvalidThreadState, th.ID, th.Status, strings.Join(allowed, " or "))
}

func requireMissionNonTerminal(m *Mission) error {
	if isTerminalMissionStatus(m.Status) {
		return fmt.Errorf("%w: mission %s is %s", ErrInvalidThreadState, m.ID, m.Status)
	}
	return nil
}

func isTerminalMissionStatus(status string) bool {
	return status == MissionStatusCompleted || status == MissionStatusFailed || status == MissionStatusCanceled
}

func resetVerdictProgress(th *Thread, now string) {
	th.LastProgressAt = now
	th.SoftStallWarnedAt = ""
	th.HardStallTriggeredAt = ""
}

// IsHumanActionableIncident reports whether an incident kind requires human intervention
// (always for decision/permission/auth/verifier_tier_blocked; or after fallback exhaustion
// for quota_exhausted/hard_stall/process_crash/fatal/verifier_mutation_violation).
func IsHumanActionableIncident(kind string, fallbackExhausted bool) bool {
	switch strings.TrimSpace(kind) {
	case IncidentDecisionRequested,
		IncidentPermissionBlocked,
		IncidentAuthError,
		IncidentVerifierTierBlocked:
		return true
	case IncidentQuotaExhausted,
		IncidentHardStall,
		AttentionKindStall,
		IncidentProcessCrash,
		IncidentFatalError,
		IncidentVerifierMutationViolation,
		AttentionKindVerifyEscalated:
		return fallbackExhausted
	default:
		return false
	}
}

// RaiseIncident records SystemAttention on the thread (or mission) and triggers a
// deduplicated human escalation at most once per (missionId, threadId, kind).
func (r *Router) RaiseIncident(ctx context.Context, missionID, threadID string, att SystemAttention, fallbackExhausted bool) (bool, error) {
	now := r.nowString()
	if att.Since == "" {
		att.Since = now
	}
	if att.ThreadID == nil && strings.TrimSpace(threadID) != "" {
		att.ThreadID = optStringPtr(threadID)
	}

	actionable := IsHumanActionableIncident(att.Kind, fallbackExhausted)
	dedupKey := incidentKey(threadID, att.Kind)
	var chiefAgentID string
	notifyNow := false

	_, err := r.store.UpdateMission(missionID, func(m *Mission) error {
		chiefAgentID = m.ChiefAgentID
		if m.NotifiedIncidents == nil {
			m.NotifiedIncidents = make(map[string]string)
		}
		if actionable {
			if _, already := m.NotifiedIncidents[dedupKey]; !already {
				m.NotifiedIncidents[dedupKey] = now
				att.IncidentNotified = true
				notifyNow = true
			} else {
				att.IncidentNotified = true
			}
		}

		if threadID != "" {
			if th := findThread(m, threadID); th != nil {
				cp := att
				th.SystemAttention = &cp
				th.UpdatedAt = now
				return nil
			}
		}
		cp := att
		m.SystemAttention = &cp
		return nil
	})
	if err != nil {
		return false, err
	}

	if notifyNow && r.hooks.NotifyHuman != nil && chiefAgentID != "" {
		r.hooks.NotifyHuman(ctx, missionID, chiefAgentID, att)
	}
	return notifyNow, nil
}

// ResolveIncident clears active SystemAttention and allows future occurrences of the same
// incident key to notify again.
func (r *Router) ResolveIncident(missionID, threadID, kind string) error {
	now := r.nowString()
	dedupKey := incidentKey(threadID, kind)
	_, err := r.store.UpdateMission(missionID, func(m *Mission) error {
		if m.NotifiedIncidents != nil {
			delete(m.NotifiedIncidents, dedupKey)
		}
		if threadID != "" {
			if th := findThread(m, threadID); th != nil && th.SystemAttention != nil && (kind == "" || th.SystemAttention.Kind == kind) {
				th.SystemAttention.ResolvedAt = &now
				th.UpdatedAt = now
			}
		}
		if m.SystemAttention != nil && (threadID == "" || derefStr(m.SystemAttention.ThreadID) == threadID) && (kind == "" || m.SystemAttention.Kind == kind) {
			m.SystemAttention.ResolvedAt = &now
		}
		return nil
	})
	return err
}

func (r *Router) scheduleCoalescedBell(missionID, agentID string) {
	key := missionID + "\x00" + agentID
	r.coalesceMu.Lock()
	if r.closed {
		r.coalesceMu.Unlock()
		return
	}
	if _, exists := r.coalesceTimers[key]; exists {
		r.coalesceMu.Unlock()
		return
	}
	fire := func() {
		r.coalesceMu.Lock()
		delete(r.coalesceTimers, key)
		closed := r.closed
		r.coalesceMu.Unlock()
		if closed {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = r.drainAgentBells(ctx, missionID, agentID)
	}
	if r.hooks.ScheduleCoalesceTimer != nil {
		r.coalesceTimers[key] = r.hooks.ScheduleCoalesceTimer(r.hooks.WakeCoalesceWindow, fire)
	} else {
		timer := time.AfterFunc(r.hooks.WakeCoalesceWindow, fire)
		r.coalesceTimers[key] = func() { timer.Stop() }
	}
	r.coalesceMu.Unlock()
}

func (r *Router) getAgentWorker(agentID string) *agentBellWorker {
	r.bellMu.Lock()
	defer r.bellMu.Unlock()
	w := r.bellWorkers[agentID]
	if w == nil {
		w = &agentBellWorker{missions: make(map[string]bool)}
		r.bellWorkers[agentID] = w
	}
	return w
}

func (r *Router) drainAgentBells(ctx context.Context, missionID, agentID string) error {
	if r.hooks.Messenger == nil || strings.TrimSpace(agentID) == "" {
		return nil
	}
	w := r.getAgentWorker(agentID)
	w.mu.Lock()
	if w.missions == nil {
		w.missions = make(map[string]bool)
	}
	w.missions[missionID] = true
	if w.running {
		w.rerun = true
		w.mu.Unlock()
		return nil
	}
	w.running = true
	w.mu.Unlock()

	var firstErr error
	for {
		w.mu.Lock()
		w.rerun = false
		ids := make([]string, 0, len(w.missions))
		for id := range w.missions {
			ids = append(ids, id)
		}
		w.missions = make(map[string]bool)
		w.mu.Unlock()

		sort.Strings(ids)
		for _, id := range ids {
			if err := r.deliverOneMissionBell(ctx, id, agentID); err != nil && firstErr == nil {
				firstErr = err
			}
		}

		w.mu.Lock()
		if !w.rerun && len(w.missions) == 0 {
			w.running = false
			w.mu.Unlock()
			return firstErr
		}
		w.mu.Unlock()
	}
}

func (r *Router) deliverOneMissionBell(ctx context.Context, missionID, agentID string) error {
	m, err := r.store.GetMission(missionID)
	if err != nil {
		return err
	}
	if m.Status == MissionStatusCanceled || m.Status == MissionStatusFailed {
		return nil
	}

	cursorSeq := m.Cursors[agentID]
	delta, err := r.store.ReadEventsForAgent(missionID, agentID, cursorSeq)
	if err != nil {
		return err
	}
	if len(delta) == 0 {
		return r.store.MarkBellDelivered(missionID, agentID, cursorSeq)
	}
	if m.Status == MissionStatusCompleted && (len(delta) != 1 || delta[0].Kind != EventVerifyPassed) {
		return nil
	}

	state := r.hooks.Messenger.GetAgentState(agentID)
	if state.Status == "running" {
		return nil
	}
	if !state.Loaded || state.Status == "closed" {
		if loadErr := r.hooks.Messenger.EnsureLoaded(ctx, agentID); loadErr != nil {
			_ = r.store.RecordBellAttempt(missionID, agentID, loadErr.Error())
			return loadErr
		}
	}

	maxSeq := delta[len(delta)-1].Seq
	wrapped := FormatBellEnvelope(m, agentID, delta)
	if sendErr := r.hooks.Messenger.SendPrompt(ctx, agentID, wrapped); sendErr != nil {
		_ = r.store.RecordBellAttempt(missionID, agentID, sendErr.Error())
		return sendErr
	}
	return r.store.MarkBellDelivered(missionID, agentID, maxSeq)
}

// FormatBellEnvelope formats unread delta events inside `<byspace-system>` via sdk.FormatSystemNotificationPrompt.
func FormatBellEnvelope(m *Mission, agentID string, delta []Event) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Chief orchestration update for mission %s (tier %s, agent %s):\n", m.ID, m.Tier, agentID)
	for _, ev := range delta {
		if tid := derefStr(ev.ThreadID); tid != "" {
			fmt.Fprintf(&b, "- #%d [%s] (thread %s): %s\n", ev.Seq, ev.Kind, tid, ev.Summary)
		} else {
			fmt.Fprintf(&b, "- #%d [%s]: %s\n", ev.Seq, ev.Kind, ev.Summary)
		}
	}
	return sdk.FormatSystemNotificationPrompt(strings.TrimSpace(b.String()))
}

// IsPathOwned checks whether filePath matches any ownedPaths entry or active shared lock held by threadID.
func IsPathOwned(filePath string, ownedPaths []string, sharedLocks map[string]string, threadID string) bool {
	if len(ownedPaths) == 0 {
		return true
	}
	normFile := normalizeRelPath(filePath)
	if normFile == "" {
		return true
	}
	for _, pat := range ownedPaths {
		if matchOwnedPattern(normFile, pat) {
			return true
		}
	}
	for lockPath, holderThreadID := range sharedLocks {
		if holderThreadID == threadID && matchOwnedPattern(normFile, lockPath) {
			return true
		}
	}
	return false
}

func normalizeRelPath(p string) string {
	slash := filepath.ToSlash(p)
	slash = strings.TrimPrefix(slash, "./")
	slash = strings.TrimPrefix(slash, "/")
	cleaned := path.Clean(slash)
	if cleaned == "." {
		return ""
	}
	return cleaned
}

func matchOwnedPattern(normFile, rawPattern string) bool {
	trimmed := filepath.ToSlash(rawPattern)
	trimmed = strings.TrimPrefix(trimmed, "./")
	trimmed = strings.TrimPrefix(trimmed, "/")
	if trimmed == "" {
		return false
	}
	if strings.HasSuffix(trimmed, "/") {
		dir := strings.TrimSuffix(path.Clean(trimmed), "/")
		return normFile == dir || strings.HasPrefix(normFile, dir+"/")
	}
	if strings.HasSuffix(trimmed, "/**") {
		dir := strings.TrimSuffix(trimmed, "/**")
		dir = path.Clean(dir)
		return normFile == dir || strings.HasPrefix(normFile, dir+"/")
	}
	if strings.ContainsAny(trimmed, "*?[") {
		matched, err := path.Match(trimmed, normFile)
		return err == nil && matched
	}
	cleanPat := path.Clean(trimmed)
	return normFile == cleanPat || strings.HasPrefix(normFile, cleanPat+"/")
}

func findThread(m *Mission, threadID string) *Thread {
	for i := range m.Threads {
		if m.Threads[i].ID == threadID {
			return &m.Threads[i]
		}
	}
	return nil
}

func incidentKey(threadID, kind string) string {
	return strings.TrimSpace(threadID) + "\x00" + strings.TrimSpace(kind)
}
