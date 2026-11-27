package chief

import (
	"strings"
	"unicode/utf8"
)

// Execution tiers for Chief orchestration.
const (
	TierL0 = "L0" // Direct solo execution without Mission/worktree/verifier overhead.
	TierL1 = "L1" // Single-workspace solo Author + shadow read-only Verifier.
	TierL2 = "L2" // Multi-worktree orchestrated threads with non-coding Chief secretary.
)

// Mission status values matching CHIEF_MISSION_STATUSES in packages/protocol/src/messages.ts.
const (
	MissionStatusActive       = "active"
	MissionStatusWaitingHuman = "waiting_human"
	MissionStatusCompleted    = "completed"
	MissionStatusFailed       = "failed"
	MissionStatusCanceled     = "canceled"
)

// Thread status values matching CHIEF_THREAD_STATUSES in packages/protocol/src/messages.ts.
const (
	ThreadStatusQueued        = "queued"
	ThreadStatusAuthoring     = "authoring"
	ThreadStatusVerifying     = "verifying"
	ThreadStatusNeedsRebase   = "needs_rebase"
	ThreadStatusMergeChecking = "merge_checking"
	ThreadStatusReadyToLand   = "ready_to_land"
	ThreadStatusLanded        = "landed"
	ThreadStatusBlocked       = "blocked"
	ThreadStatusFailed        = "failed"
	ThreadStatusCanceled      = "canceled"
)

// Thread isolation modes matching CHIEF_THREAD_ISOLATIONS.
const (
	IsolationNone     = "none"
	IsolationWorktree = "worktree"
)

// Orchestration roles matching CHIEF_ROLE_KEYS.
const (
	RoleChief      = "chief"
	RoleAuthor     = "author"
	RoleVerifier   = "verifier"
	RoleIntegrator = "integrator"
)

// Reserved daemon-owned orchestration agent labels matching packages/protocol/src/agent-labels.ts.
const (
	LabelPrefix        = "byspace.orchestration."
	LabelMissionID     = "byspace.orchestration.mission-id"
	LabelThreadID      = "byspace.orchestration.thread-id"
	LabelRole          = "byspace.orchestration.role"
	LabelChatterShield = "byspace.orchestration.chatter-shield"
)

// Landing policy defaults (confirmed user defaults).
const (
	DefaultLandingRequireHumanApproval = true
	DefaultLandingMode                 = "merge_local"
	DefaultLandingStrategy             = "squash"
)

// Stall threshold defaults in seconds (confirmed user defaults).
const (
	DefaultSoftStallSeconds = 600
	DefaultHardStallSeconds = 1200
)

// MaxEventSummaryChars bounds Event.Summary so every mission event remains compact.
const MaxEventSummaryChars = 600

// SystemAttention severity values matching ChiefSystemAttentionSeveritySchema.
const (
	SeverityWarning = "warning"
	SeverityFatal   = "fatal"
)

// SystemAttention kinds matching CHIEF_SYSTEM_ATTENTION_KINDS in packages/protocol/src/messages.ts.
const (
	AttentionKindQuotaExhausted      = "quota_exhausted"
	AttentionKindRateLimited         = "rate_limited"
	AttentionKindAuthError           = "auth_error"
	AttentionKindProcessCrash        = "process_crash"
	AttentionKindStall               = "stall"
	AttentionKindPermissionBlocked   = "permission_blocked"
	AttentionKindMergeConflict       = "merge_conflict"
	AttentionKindVerifyEscalated     = "verify_escalated"
	AttentionKindVerifierTierBlocked = "verifier_tier_blocked"
)

// Incident escalation kinds evaluated by IsHumanActionableIncident and incident deduplication.
const (
	IncidentDecisionRequested         = "decision_requested"
	IncidentPermissionBlocked         = "permission_blocked"
	IncidentAuthError                 = "auth_error"
	IncidentVerifierTierBlocked       = "verifier_tier_blocked"
	IncidentQuotaExhausted            = "quota_exhausted"
	IncidentHardStall                 = "hard_stall"
	IncidentSoftStall                 = "soft_stall"
	IncidentProcessCrash              = "process_crash"
	IncidentVerifierMutationViolation = "verifier_mutation_violation"
	IncidentFatalError                = "fatal_error"
)

// Event kinds matching CHIEF_EVENT_KINDS in packages/protocol/src/messages.ts.
const (
	EventMissionCreated            = "mission_created"
	EventTierUpgraded              = "tier_upgraded"
	EventMissionCompleted          = "mission_completed"
	EventMissionFailed             = "mission_failed"
	EventMissionCanceled           = "mission_canceled"
	EventThreadCreated             = "thread_created"
	EventAuthorSubmitted           = "author_submitted"
	EventUnreportedTurnReminded    = "unreported_turn_reminded"
	EventVerifyPassed              = "verify_passed"
	EventVerifyRejected            = "verify_rejected"
	EventOwnershipViolation        = "ownership_violation"
	EventVerifierMutationViolation = "verifier_mutation_violation"
	EventMergeDryrunPassed         = "merge_dryrun_passed"
	EventMergeDryrunConflict       = "merge_dryrun_conflict"
	EventRebaseRequested           = "rebase_requested"
	EventIntegratorSpawned         = "integrator_spawned"
	EventThreadLanded              = "thread_landed"
	EventThreadCanceled            = "thread_canceled"
	EventHotSwapApplied            = "hot_swap_applied"
	EventProviderError             = "provider_error"
	EventStallWarning              = "stall_warning"
	EventStallHard                 = "stall_hard"
	EventProcessCrashed            = "process_crashed"
	EventPermissionBlocked         = "permission_blocked"
	EventVerifierTierBlocked       = "verifier_tier_blocked"
	EventEscalatedToChief          = "escalated_to_chief"
	EventDecisionRequested         = "decision_requested"
	EventDecisionResolved          = "decision_resolved"
)

// LandingPolicy controls how verified L2 worktree threads are integrated.
type LandingPolicy struct {
	RequireHumanApproval bool   `json:"requireHumanApproval"`
	Mode                 string `json:"mode"`     // "merge_local" | "open_pr"
	Strategy             string `json:"strategy"` // "squash" | "merge" | "rebase"
}

// DefaultLandingPolicy returns the confirmed landing defaults.
func DefaultLandingPolicy() LandingPolicy {
	return LandingPolicy{
		RequireHumanApproval: DefaultLandingRequireHumanApproval,
		Mode:                 DefaultLandingMode,
		Strategy:             DefaultLandingStrategy,
	}
}

// HumanDecisionOption mirrors ChiefHumanDecisionOptionSchema.
type HumanDecisionOption struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	Description *string `json:"description,omitempty"`
	Style       string  `json:"style,omitempty"` // "primary" | "secondary" | "danger"
}

// HumanDecision mirrors ChiefHumanDecisionSchema.
type HumanDecision struct {
	ID                   string                `json:"id"`
	Kind                 string                `json:"kind"`
	Title                string                `json:"title"`
	Summary              string                `json:"summary"`
	ThreadID             *string               `json:"threadId,omitempty"`
	Options              []HumanDecisionOption `json:"options,omitempty"`
	CreatedAt            string                `json:"createdAt"`
	ResolvedAt           *string               `json:"resolvedAt,omitempty"`
	SelectedOptionID     *string               `json:"selectedOptionId,omitempty"`
	ResolutionNote       *string               `json:"resolutionNote,omitempty"`
	LandingStrategy      string                `json:"landingStrategy,omitempty"`
	LandingCommitMessage string                `json:"landingCommitMessage,omitempty"`
	LandingError         string                `json:"landingError,omitempty"`
}

// PendingBell tracks an undelivered notification target so daemon crashes do not drop wakes.
type PendingBell struct {
	AgentID   string `json:"agentId"`
	TargetSeq int64  `json:"targetSeq"`
	Reason    string `json:"reason,omitempty"`
	QueuedAt  string `json:"queuedAt"`
	Attempts  int    `json:"attempts,omitempty"`
	LastError string `json:"lastError,omitempty"`
}

// ThreadSubmission records the latest author handoff into verification.
type ThreadSubmission struct {
	ActorAgentID string   `json:"actorAgentId"`
	Summary      string   `json:"summary"`
	Tests        string   `json:"tests,omitempty"`
	CommitSha    string   `json:"commitSha,omitempty"`
	ChangedFiles []string `json:"changedFiles,omitempty"`
	SubmittedAt  string   `json:"submittedAt"`
}

// VerifyVerdict mirrors ChiefVerifyVerdictSchema.
type VerifyVerdict struct {
	Outcome         string   `json:"outcome"` // "pass" | "reject"
	Summary         string   `json:"summary"`
	Issues          []string `json:"issues,omitempty"`
	CheckedCommands []string `json:"checkedCommands,omitempty"`
	VerifiedAt      string   `json:"verifiedAt"`
	VerifierAgentID *string  `json:"verifierAgentId,omitempty"`
	CommitSha       *string  `json:"commitSha,omitempty"`
	Tainted         bool     `json:"tainted,omitempty"`
}

// MergeDryRunResult mirrors ChiefMergeDryRunResultSchema.
type MergeDryRunResult struct {
	Clean            bool     `json:"clean"`
	TargetRef        string   `json:"targetRef"`
	TargetSha        *string  `json:"targetSha,omitempty"`
	SourceRef        string   `json:"sourceRef"`
	SourceSha        *string  `json:"sourceSha,omitempty"`
	MergeTreeSha     *string  `json:"mergeTreeSha,omitempty"`
	ConflictingFiles []string `json:"conflictingFiles,omitempty"`
	DirtyWorktree    bool     `json:"dirtyWorktree,omitempty"`
	AheadCount       int      `json:"aheadCount,omitempty"`
	CheckedAt        string   `json:"checkedAt"`
}

// SystemAttention mirrors ChiefSystemAttentionSchema.
type SystemAttention struct {
	Kind             string  `json:"kind"`
	Severity         string  `json:"severity"` // "warning" | "fatal"
	Summary          string  `json:"summary"`
	AgentID          *string `json:"agentId,omitempty"`
	ThreadID         *string `json:"threadId,omitempty"`
	Since            string  `json:"since"`
	AutoActionTaken  *string `json:"autoActionTaken,omitempty"`
	IncidentNotified bool    `json:"incidentNotified,omitempty"`
	ResolvedAt       *string `json:"resolvedAt,omitempty"`
}

// Thread is one unit of work (author/verifier pair) persisted inside a Mission.
type Thread struct {
	ID                     string             `json:"id"`
	MissionID              string             `json:"missionId"`
	Title                  string             `json:"title"`
	Goal                   string             `json:"goal"`
	AcceptanceCriteria     []string           `json:"acceptanceCriteria"`
	OwnedPaths             []string           `json:"ownedPaths"`
	WorkspaceID            string             `json:"workspaceId,omitempty"`
	Cwd                    string             `json:"cwd"`
	Branch                 string             `json:"branch,omitempty"`
	BaseRef                string             `json:"baseRef,omitempty"`
	Isolation              string             `json:"isolation"` // "none" | "worktree"
	Status                 string             `json:"status"`
	AuthorAgentID          string             `json:"authorAgentId,omitempty"`
	VerifierAgentID        string             `json:"verifierAgentId,omitempty"`
	IntegratorAgentID      string             `json:"integratorAgentId,omitempty"`
	AuthorProfileID        string             `json:"authorProfileId,omitempty"`
	VerifierProfileID      string             `json:"verifierProfileId,omitempty"`
	AuthorTier             string             `json:"authorTier,omitempty"`
	VerifierTier           string             `json:"verifierTier,omitempty"`
	VerifyRejectCount      int                `json:"verifyRejectCount"`
	RebaseAttempts         int                `json:"rebaseAttempts"`
	LastSubmit             *ThreadSubmission  `json:"lastSubmit,omitempty"`
	LastVerdict            *VerifyVerdict     `json:"lastVerdict,omitempty"`
	MergeCheck             *MergeDryRunResult `json:"mergeCheck,omitempty"`
	SystemAttention        *SystemAttention   `json:"systemAttention,omitempty"`
	UnreportedReminderSent bool               `json:"unreportedReminderSent,omitempty"`
	LastProgressAt         string             `json:"lastProgressAt,omitempty"`
	SoftStallWarnedAt      string             `json:"softStallWarnedAt,omitempty"`
	HardStallTriggeredAt   string             `json:"hardStallTriggeredAt,omitempty"`
	CreatedAt              string             `json:"createdAt"`
	UpdatedAt              string             `json:"updatedAt"`
}

// Mission is the top-level persisted orchestration state stored under
// $BYSPACE_HOME/orchestration/missions/<missionId>/mission.json.
type Mission struct {
	ID                string                  `json:"id"`
	Title             string                  `json:"title,omitempty"`
	Goal              string                  `json:"goal,omitempty"`
	ChiefAgentID      string                  `json:"chiefAgentId"`
	ProjectID         string                  `json:"projectId,omitempty"`
	BaseWorkspaceID   string                  `json:"baseWorkspaceId,omitempty"`
	BaseCwd           string                  `json:"baseCwd"`
	BaseBranch        string                  `json:"baseBranch,omitempty"`
	Tier              string                  `json:"tier"` // "L0" | "L1" | "L2"
	Status            string                  `json:"status"`
	SharedLocks       map[string]string       `json:"sharedLocks,omitempty"`
	Cursors           map[string]int64        `json:"cursors"`
	RetiredAgents     map[string]int64        `json:"retiredAgents,omitempty"`
	HeadSeq           int64                   `json:"headSeq"`
	PendingBells      map[string]*PendingBell `json:"pendingBells,omitempty"`
	NotifiedIncidents map[string]string       `json:"notifiedIncidents,omitempty"`
	PendingDecision   *HumanDecision          `json:"pendingDecision,omitempty"`
	SystemAttention   *SystemAttention        `json:"systemAttention,omitempty"`
	Landing           *LandingPolicy          `json:"landing,omitempty"`
	Threads           []Thread                `json:"threads"`
	CreatedAt         string                  `json:"createdAt"`
	UpdatedAt         string                  `json:"updatedAt"`
	CompletedAt       *string                 `json:"completedAt,omitempty"`
}

// Event mirrors ChiefEventSchema in packages/protocol/src/messages.ts.
type Event struct {
	Seq           int64          `json:"seq"`
	Ts            string         `json:"ts"`
	MissionID     string         `json:"missionId"`
	ThreadID      *string        `json:"threadId,omitempty"`
	Kind          string         `json:"kind"`
	ActorAgentID  *string        `json:"actorAgentId,omitempty"`
	TargetAgentID *string        `json:"targetAgentId,omitempty"`
	Summary       string         `json:"summary"`
	Payload       map[string]any `json:"payload,omitempty"`
}

// AgentRuntimeState holds live agent state supplied by Server for deterministic snapshots.
type AgentRuntimeState struct {
	AgentID              string `json:"agentId"`
	Status               string `json:"status"` // "initializing" | "idle" | "running" | "error" | "closed"
	Loaded               bool   `json:"loaded"`
	Provider             string `json:"provider,omitempty"`
	Model                string `json:"model,omitempty"`
	HasPendingPermission bool   `json:"hasPendingPermission,omitempty"`
	LastError            string `json:"lastError,omitempty"`
	LastActivityAt       string `json:"lastActivityAt,omitempty"`
}

// ThreadSnapshot mirrors ChiefThreadSnapshotSchema in packages/protocol/src/messages.ts.
type ThreadSnapshot struct {
	ID                    string             `json:"id"`
	MissionID             string             `json:"missionId"`
	Title                 string             `json:"title"`
	Goal                  string             `json:"goal"`
	AcceptanceCriteria    []string           `json:"acceptanceCriteria"`
	OwnedPaths            []string           `json:"ownedPaths"`
	WorkspaceID           *string            `json:"workspaceId,omitempty"`
	Cwd                   string             `json:"cwd"`
	Branch                *string            `json:"branch,omitempty"`
	BaseRef               *string            `json:"baseRef,omitempty"`
	Isolation             string             `json:"isolation"`
	Status                string             `json:"status"`
	AuthorAgentID         *string            `json:"authorAgentId,omitempty"`
	VerifierAgentID       *string            `json:"verifierAgentId,omitempty"`
	IntegratorAgentID     *string            `json:"integratorAgentId,omitempty"`
	AuthorProfileID       *string            `json:"authorProfileId,omitempty"`
	VerifierProfileID     *string            `json:"verifierProfileId,omitempty"`
	AuthorTier            string             `json:"authorTier,omitempty"`
	VerifierTier          string             `json:"verifierTier,omitempty"`
	AuthorAgentStatus     *string            `json:"authorAgentStatus,omitempty"`
	VerifierAgentStatus   *string            `json:"verifierAgentStatus,omitempty"`
	IntegratorAgentStatus *string            `json:"integratorAgentStatus,omitempty"`
	VerifyRejectCount     int                `json:"verifyRejectCount"`
	RebaseAttempts        int                `json:"rebaseAttempts"`
	LastVerdict           *VerifyVerdict     `json:"lastVerdict,omitempty"`
	MergeCheck            *MergeDryRunResult `json:"mergeCheck,omitempty"`
	SystemAttention       *SystemAttention   `json:"systemAttention,omitempty"`
	LastProgressAt        *string            `json:"lastProgressAt,omitempty"`
	CreatedAt             string             `json:"createdAt"`
	UpdatedAt             string             `json:"updatedAt"`
}

// MissionSnapshot mirrors ChiefMissionSnapshotSchema in packages/protocol/src/messages.ts.
type MissionSnapshot struct {
	ID               string            `json:"id"`
	Title            string            `json:"title,omitempty"`
	Goal             string            `json:"goal,omitempty"`
	ChiefAgentID     string            `json:"chiefAgentId"`
	ChiefAgentStatus *string           `json:"chiefAgentStatus,omitempty"`
	ProjectID        *string           `json:"projectId,omitempty"`
	BaseWorkspaceID  *string           `json:"baseWorkspaceId,omitempty"`
	BaseCwd          string            `json:"baseCwd"`
	BaseBranch       *string           `json:"baseBranch,omitempty"`
	Tier             string            `json:"tier"`
	Status           string            `json:"status"`
	SharedLocks      map[string]string `json:"sharedLocks,omitempty"`
	Cursors          map[string]int64  `json:"cursors,omitempty"`
	PendingDecision  *HumanDecision    `json:"pendingDecision,omitempty"`
	SystemAttention  *SystemAttention  `json:"systemAttention,omitempty"`
	Threads          []ThreadSnapshot  `json:"threads"`
	HeadSeq          int64             `json:"headSeq,omitempty"`
	CreatedAt        string            `json:"createdAt"`
	UpdatedAt        string            `json:"updatedAt"`
}

// BuildMissionSnapshot deterministically projects a Mission plus live agent runtime states
// into the wire MissionSnapshot shape without invoking any LLM.
func BuildMissionSnapshot(m Mission, liveStates map[string]AgentRuntimeState) MissionSnapshot {
	cp := cloneMission(m)

	statusOf := func(agentID string) *string {
		trimmed := strings.TrimSpace(agentID)
		if trimmed == "" {
			return nil
		}
		if st, ok := liveStates[trimmed]; ok && isValidAgentStatus(st.Status) {
			s := st.Status
			return &s
		}
		closed := "closed"
		return &closed
	}

	threads := make([]ThreadSnapshot, 0, len(cp.Threads))
	for _, th := range cp.Threads {
		threads = append(threads, ThreadSnapshot{
			ID:                    th.ID,
			MissionID:             th.MissionID,
			Title:                 th.Title,
			Goal:                  th.Goal,
			AcceptanceCriteria:    th.AcceptanceCriteria,
			OwnedPaths:            th.OwnedPaths,
			WorkspaceID:           optStringPtr(th.WorkspaceID),
			Cwd:                   th.Cwd,
			Branch:                optStringPtr(th.Branch),
			BaseRef:               optStringPtr(th.BaseRef),
			Isolation:             th.Isolation,
			Status:                th.Status,
			AuthorAgentID:         optStringPtr(th.AuthorAgentID),
			VerifierAgentID:       optStringPtr(th.VerifierAgentID),
			IntegratorAgentID:     optStringPtr(th.IntegratorAgentID),
			AuthorProfileID:       optStringPtr(th.AuthorProfileID),
			VerifierProfileID:     optStringPtr(th.VerifierProfileID),
			AuthorTier:            th.AuthorTier,
			VerifierTier:          th.VerifierTier,
			AuthorAgentStatus:     statusOf(th.AuthorAgentID),
			VerifierAgentStatus:   statusOf(th.VerifierAgentID),
			IntegratorAgentStatus: statusOf(th.IntegratorAgentID),
			VerifyRejectCount:     th.VerifyRejectCount,
			RebaseAttempts:        th.RebaseAttempts,
			LastVerdict:           th.LastVerdict,
			MergeCheck:            th.MergeCheck,
			SystemAttention:       th.SystemAttention,
			LastProgressAt:        optStringPtr(th.LastProgressAt),
			CreatedAt:             th.CreatedAt,
			UpdatedAt:             th.UpdatedAt,
		})
	}

	return MissionSnapshot{
		ID:               cp.ID,
		Title:            cp.Title,
		Goal:             cp.Goal,
		ChiefAgentID:     cp.ChiefAgentID,
		ChiefAgentStatus: statusOf(cp.ChiefAgentID),
		ProjectID:        optStringPtr(cp.ProjectID),
		BaseWorkspaceID:  optStringPtr(cp.BaseWorkspaceID),
		BaseCwd:          cp.BaseCwd,
		BaseBranch:       optStringPtr(cp.BaseBranch),
		Tier:             cp.Tier,
		Status:           cp.Status,
		SharedLocks:      cp.SharedLocks,
		Cursors:          cp.Cursors,
		PendingDecision:  cp.PendingDecision,
		SystemAttention:  cp.SystemAttention,
		Threads:          threads,
		HeadSeq:          cp.HeadSeq,
		CreatedAt:        cp.CreatedAt,
		UpdatedAt:        cp.UpdatedAt,
	}
}

// MissionUpdatePayload mirrors ChiefMissionUpdateMessageSchema payload in packages/protocol/src/messages.ts.
type MissionUpdatePayload struct {
	Kind        string           `json:"kind"` // "upsert" | "remove"
	Mission     *MissionSnapshot `json:"mission,omitempty"`
	LatestEvent *Event           `json:"latestEvent,omitempty"`
	MissionID   string           `json:"missionId,omitempty"`
}

type MissionListRequest struct {
	RequestID        string   `json:"requestId"`
	ChiefAgentID     string   `json:"chiefAgentId,omitempty"`
	ProjectID        string   `json:"projectId,omitempty"`
	BaseWorkspaceID  string   `json:"baseWorkspaceId,omitempty"`
	Statuses         []string `json:"statuses,omitempty"`
	IncludeCompleted bool     `json:"includeCompleted,omitempty"`
}

type MissionListResponse struct {
	RequestID string            `json:"requestId"`
	Missions  []MissionSnapshot `json:"missions"`
	Error     *string           `json:"error,omitempty"`
}

type MissionGetRequest struct {
	RequestID     string `json:"requestId"`
	MissionID     string `json:"missionId"`
	IncludeEvents bool   `json:"includeEvents,omitempty"`
	EventsLimit   int    `json:"eventsLimit,omitempty"`
	AfterSeq      int64  `json:"afterSeq,omitempty"`
}

type MissionGetResponse struct {
	RequestID string           `json:"requestId"`
	Mission   *MissionSnapshot `json:"mission"`
	Events    []Event          `json:"events,omitempty"`
	Error     *string          `json:"error,omitempty"`
}

type MissionCreateRequest struct {
	RequestID       string `json:"requestId"`
	Goal            string `json:"goal"`
	Title           string `json:"title,omitempty"`
	Tier            string `json:"tier,omitempty"`
	ChiefAgentID    string `json:"chiefAgentId,omitempty"`
	CallerAgentID   string `json:"callerAgentId,omitempty"`
	ProjectID       string `json:"projectId,omitempty"`
	BaseWorkspaceID string `json:"baseWorkspaceId,omitempty"`
	BaseCwd         string `json:"baseCwd,omitempty"`
	BaseBranch      string `json:"baseBranch,omitempty"`
}

type MissionCreateResponse struct {
	RequestID string           `json:"requestId"`
	Mission   *MissionSnapshot `json:"mission"`
	Error     *string          `json:"error,omitempty"`
}

type MissionUpgradeRequest struct {
	RequestID          string   `json:"requestId"`
	MissionID          string   `json:"missionId,omitempty"`
	SoloAgentID        string   `json:"soloAgentId,omitempty"`
	CallerAgentID      string   `json:"callerAgentId,omitempty"`
	TargetTier         string   `json:"targetTier"`
	DirtyPolicy        string   `json:"dirtyPolicy,omitempty"` // "fail_if_dirty" | "carry_into_thread_1"
	Title              string   `json:"title,omitempty"`
	Goal               string   `json:"goal,omitempty"`
	AcceptanceCriteria []string `json:"acceptanceCriteria,omitempty"`
	OwnedPaths         []string `json:"ownedPaths,omitempty"`
	AuthorProfileID    string   `json:"authorProfileId,omitempty"`
	VerifierProfileID  string   `json:"verifierProfileId,omitempty"`
}

type MissionUpgradeResponse struct {
	RequestID       string           `json:"requestId"`
	Mission         *MissionSnapshot `json:"mission"`
	CreatedThreadID *string          `json:"createdThreadId,omitempty"`
	Error           *string          `json:"error,omitempty"`
}

type MissionResolveDecisionRequest struct {
	RequestID  string `json:"requestId"`
	MissionID  string `json:"missionId"`
	DecisionID string `json:"decisionId,omitempty"`
	OptionID   string `json:"optionId"`
	Note       string `json:"note,omitempty"`
}

type MissionResolveDecisionResponse struct {
	RequestID string           `json:"requestId"`
	Mission   *MissionSnapshot `json:"mission"`
	Error     *string          `json:"error,omitempty"`
}

type ThreadCreateRequest struct {
	RequestID          string   `json:"requestId"`
	MissionID          string   `json:"missionId"`
	CallerAgentID      string   `json:"callerAgentId,omitempty"`
	Title              string   `json:"title"`
	Goal               string   `json:"goal"`
	AcceptanceCriteria []string `json:"acceptanceCriteria,omitempty"`
	OwnedPaths         []string `json:"ownedPaths,omitempty"`
	Isolation          string   `json:"isolation,omitempty"`
	BaseRef            string   `json:"baseRef,omitempty"`
	Branch             string   `json:"branch,omitempty"`
	AuthorProfileID    string   `json:"authorProfileId,omitempty"`
	VerifierProfileID  string   `json:"verifierProfileId,omitempty"`
	AuthorAgentID      string   `json:"authorAgentId,omitempty"`
	InitialPrompt      string   `json:"initialPrompt,omitempty"`
}

type ThreadCreateResponse struct {
	RequestID string           `json:"requestId"`
	Mission   *MissionSnapshot `json:"mission"`
	Thread    *ThreadSnapshot  `json:"thread"`
	Error     *string          `json:"error,omitempty"`
}

type ThreadSubmitRequest struct {
	RequestID     string   `json:"requestId"`
	ThreadID      string   `json:"threadId"`
	MissionID     string   `json:"missionId,omitempty"`
	CallerAgentID string   `json:"callerAgentId,omitempty"`
	Summary       string   `json:"summary"`
	Tests         string   `json:"tests,omitempty"`
	ChangedFiles  []string `json:"changedFiles,omitempty"`
	CommitSha     string   `json:"commitSha,omitempty"`
}

type ThreadSubmitResponse struct {
	RequestID           string          `json:"requestId"`
	Accepted            bool            `json:"accepted"`
	Thread              *ThreadSnapshot `json:"thread"`
	OwnershipViolations []string        `json:"ownershipViolations,omitempty"`
	Error               *string         `json:"error,omitempty"`
}

type ThreadVerdictRequest struct {
	RequestID       string   `json:"requestId"`
	ThreadID        string   `json:"threadId"`
	MissionID       string   `json:"missionId,omitempty"`
	CallerAgentID   string   `json:"callerAgentId,omitempty"`
	Outcome         string   `json:"outcome"` // "pass" | "reject"
	Summary         string   `json:"summary"`
	Issues          []string `json:"issues,omitempty"`
	CheckedCommands []string `json:"checkedCommands,omitempty"`
}

type ThreadVerdictResponse struct {
	RequestID        string          `json:"requestId"`
	Accepted         bool            `json:"accepted"`
	EscalatedToChief bool            `json:"escalatedToChief,omitempty"`
	Thread           *ThreadSnapshot `json:"thread"`
	Error            *string         `json:"error,omitempty"`
}

// MissionNeedsHumanAttention reports whether a Mission currently requires human intervention.
func MissionNeedsHumanAttention(m Mission) bool {
	if m.Status == MissionStatusWaitingHuman {
		return true
	}
	if m.PendingDecision != nil && m.PendingDecision.ResolvedAt == nil {
		return true
	}
	if m.SystemAttention != nil && m.SystemAttention.ResolvedAt == nil {
		if m.SystemAttention.Severity == SeverityFatal || IsHumanActionableIncident(m.SystemAttention.Kind, m.SystemAttention.IncidentNotified) {
			return true
		}
	}
	for _, th := range m.Threads {
		if th.SystemAttention != nil && th.SystemAttention.ResolvedAt == nil {
			if th.SystemAttention.Severity == SeverityFatal || IsHumanActionableIncident(th.SystemAttention.Kind, th.SystemAttention.IncidentNotified) {
				return true
			}
		}
	}
	return false
}

// ClampSummary ensures an Event summary is at most MaxEventSummaryChars runes.
func ClampSummary(summary string) string {
	trimmed := strings.TrimSpace(summary)
	if trimmed == "" {
		return ""
	}
	if utf8.RuneCountInString(trimmed) <= MaxEventSummaryChars {
		return trimmed
	}
	runes := []rune(trimmed)
	return string(runes[:MaxEventSummaryChars-3]) + "..."
}

// BuildOrchestrationLabels builds the reserved label set applied to orchestrated agents.
func BuildOrchestrationLabels(missionID, threadID, role string, chatterShield bool) map[string]string {
	labels := map[string]string{
		LabelMissionID: strings.TrimSpace(missionID),
		LabelRole:      strings.TrimSpace(role),
	}
	if strings.TrimSpace(threadID) != "" {
		labels[LabelThreadID] = strings.TrimSpace(threadID)
	}
	if chatterShield {
		labels[LabelChatterShield] = "true"
	}
	return labels
}

// IsChatterShielded reports whether an agent carries active chatter suppression.
func IsChatterShielded(labels map[string]string) bool {
	if len(labels) == 0 {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(labels[LabelChatterShield]), "true")
}

// OrchestrationMetaFromLabels extracts mission, thread, and role labels from an agent record.
func OrchestrationMetaFromLabels(labels map[string]string) (missionID, threadID, role string, ok bool) {
	if len(labels) == 0 {
		return "", "", "", false
	}
	missionID = strings.TrimSpace(labels[LabelMissionID])
	threadID = strings.TrimSpace(labels[LabelThreadID])
	role = strings.TrimSpace(labels[LabelRole])
	if missionID == "" && threadID == "" && role == "" {
		return "", "", "", false
	}
	return missionID, threadID, role, true
}

// ShouldSuppressWorkerAttention reports whether an agent attention mark/notification
// should be suppressed by the Chatter Shield for routine worker turn completions/errors.
// Chief itself is never suppressed, and human permission prompts still route through
// deduplicated incident escalation.
func ShouldSuppressWorkerAttention(labels map[string]string, reason string) bool {
	if !IsChatterShielded(labels) {
		return false
	}
	role := strings.ToLower(strings.TrimSpace(labels[LabelRole]))
	if role == RoleChief {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "finished", "error":
		return true
	default:
		return false
	}
}

func isValidAgentStatus(status string) bool {
	switch status {
	case "initializing", "idle", "running", "error", "closed":
		return true
	default:
		return false
	}
}

func optStringPtr(v string) *string {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func cloneMission(m Mission) Mission {
	cp := m
	if m.SharedLocks != nil {
		cp.SharedLocks = make(map[string]string, len(m.SharedLocks))
		for k, v := range m.SharedLocks {
			cp.SharedLocks[k] = v
		}
	} else {
		cp.SharedLocks = map[string]string{}
	}
	if m.Cursors != nil {
		cp.Cursors = make(map[string]int64, len(m.Cursors))
		for k, v := range m.Cursors {
			cp.Cursors[k] = v
		}
	} else {
		cp.Cursors = map[string]int64{}
	}
	if m.RetiredAgents != nil {
		cp.RetiredAgents = make(map[string]int64, len(m.RetiredAgents))
		for k, v := range m.RetiredAgents {
			cp.RetiredAgents[k] = v
		}
	}
	if m.PendingBells != nil {
		cp.PendingBells = make(map[string]*PendingBell, len(m.PendingBells))
		for k, v := range m.PendingBells {
			if v != nil {
				bell := *v
				cp.PendingBells[k] = &bell
			}
		}
	}
	if m.NotifiedIncidents != nil {
		cp.NotifiedIncidents = make(map[string]string, len(m.NotifiedIncidents))
		for k, v := range m.NotifiedIncidents {
			cp.NotifiedIncidents[k] = v
		}
	}
	if m.PendingDecision != nil {
		pd := *m.PendingDecision
		pd.Options = append([]HumanDecisionOption(nil), m.PendingDecision.Options...)
		cp.PendingDecision = &pd
	}
	if m.SystemAttention != nil {
		sa := *m.SystemAttention
		cp.SystemAttention = &sa
	}
	if m.Landing != nil {
		lp := *m.Landing
		cp.Landing = &lp
	}
	if m.Threads != nil {
		cp.Threads = make([]Thread, len(m.Threads))
		for i, th := range m.Threads {
			cp.Threads[i] = cloneThread(th)
		}
	} else {
		cp.Threads = []Thread{}
	}
	return cp
}

func cloneThread(th Thread) Thread {
	cp := th
	cp.AcceptanceCriteria = append([]string(nil), th.AcceptanceCriteria...)
	cp.OwnedPaths = append([]string(nil), th.OwnedPaths...)
	if cp.AcceptanceCriteria == nil {
		cp.AcceptanceCriteria = []string{}
	}
	if cp.OwnedPaths == nil {
		cp.OwnedPaths = []string{}
	}
	if th.LastSubmit != nil {
		ls := *th.LastSubmit
		ls.ChangedFiles = append([]string(nil), th.LastSubmit.ChangedFiles...)
		cp.LastSubmit = &ls
	}
	if th.LastVerdict != nil {
		lv := *th.LastVerdict
		lv.Issues = append([]string(nil), th.LastVerdict.Issues...)
		lv.CheckedCommands = append([]string(nil), th.LastVerdict.CheckedCommands...)
		cp.LastVerdict = &lv
	}
	if th.MergeCheck != nil {
		mc := *th.MergeCheck
		mc.ConflictingFiles = append([]string(nil), th.MergeCheck.ConflictingFiles...)
		cp.MergeCheck = &mc
	}
	if th.SystemAttention != nil {
		sa := *th.SystemAttention
		cp.SystemAttention = &sa
	}
	return cp
}
