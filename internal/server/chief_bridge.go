package server

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	agentroles "github.com/ByteTrue/byspace/internal/agent/roles"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

const maxChiefColdResumeAttempts = 2

type gitCheckoutBaseline struct {
	cwd          string
	status       string
	headSha      string
	captured     time.Time
	reported     bool
	verdictClean bool
	superseded   bool
}

type chiefBridge struct {
	srv      *Server
	store    *chief.Store
	router   *chief.Router
	landing  *chief.LandingService
	watchdog *chief.Watchdog

	mu                sync.Mutex
	verifierBaselines map[string]*gitCheckoutBaseline
	authorBaselines   map[string]*gitCheckoutBaseline
	usageTokens       map[string]int64
	recoveryAttempts  map[string]int
}

func newChiefBridge(srv *Server) *chiefBridge {
	st := chief.NewStore(srv.homeDir)
	b := &chiefBridge{
		srv:               srv,
		store:             st,
		verifierBaselines: make(map[string]*gitCheckoutBaseline),
		authorBaselines:   make(map[string]*gitCheckoutBaseline),
		usageTokens:       make(map[string]int64),
		recoveryAttempts:  make(map[string]int),
	}
	b.router = chief.NewRouter(st, chief.RouterHooks{
		Messenger:          &serverAgentMessenger{bridge: b},
		DryRunMerge:        b.dryRunMerge,
		NotifyHuman:        b.notifyHuman,
		Now:                func() time.Time { return time.Now().UTC() },
		WakeCoalesceWindow: 250 * time.Millisecond,
	})
	b.landing = chief.NewLandingService(st, b.router, chief.LandingHooks{
		DryRunMerge: b.dryRunMerge,
		LandBranch:  workspace.LandBranch,
	})
	b.watchdog = chief.NewWatchdog(chief.WatchdogHooks{
		Store:         st,
		Router:        b.router,
		ProbeAgent:    b.probeAgent,
		Thresholds:    b.stallThresholds,
		Now:           func() time.Time { return time.Now().UTC() },
		Interval:      chief.DefaultWatchdogInterval,
		OnDeadSession: b.onDeadSession,
		OnSoftStall:   b.onSoftStall,
		OnHardStall:   b.onHardStall,
	})
	return b
}

func (b *chiefBridge) Start() {
	if b == nil {
		return
	}
	if b.watchdog != nil {
		b.watchdog.Start()
	}
	if b.router != nil && b.srv != nil && b.srv.bgCtx != nil {
		go func() {
			ctx, cancel := context.WithTimeout(b.srv.bgCtx, 30*time.Second)
			defer cancel()
			if err := b.router.ReplayPendingBells(ctx); err != nil {
				slog.Error("replay pending Chief bells", "err", err)
			}
		}()
	}
}

func (b *chiefBridge) Close() {
	if b == nil {
		return
	}
	if b.watchdog != nil {
		b.watchdog.Stop()
	}
	if b.router != nil {
		b.router.Close()
	}
}

type serverAgentMessenger struct {
	bridge *chiefBridge
}

func (m *serverAgentMessenger) GetAgentState(agentID string) chief.AgentRuntimeState {
	b := m.bridge
	if b == nil || b.srv == nil {
		return chief.AgentRuntimeState{}
	}
	return b.agentRuntimeState(agentID)
}

func (m *serverAgentMessenger) EnsureLoaded(ctx context.Context, agentID string) error {
	b := m.bridge
	if b == nil || b.srv == nil {
		return errors.New("server unavailable")
	}
	rec, err := b.srv.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}
	if rec.ArchivedAt != nil {
		if _, unarchErr := b.srv.unarchiveAgent(ctx, agentID); unarchErr != nil {
			return unarchErr
		}
	}
	_, err = b.srv.ensureAgentLoaded(agentID)
	return err
}

func (m *serverAgentMessenger) SendPrompt(ctx context.Context, agentID, wrappedPrompt string) error {
	b := m.bridge
	if b == nil || b.srv == nil {
		return errors.New("server unavailable")
	}
	mp, err := b.srv.ensureAgentLoaded(agentID)
	if err != nil {
		return err
	}
	rec := b.currentAgentRecord(agentID, mp.record)
	b.capturePreTurnBaseline(rec)

	clientMsgID := newMessageID()
	mp.session.SetNextClientMessageID(clientMsgID)
	if err := mp.session.Prompt(ctx, wrappedPrompt, nil); err != nil {
		return err
	}
	b.srv.appendSubmittedPromptRow(rec, mp.session, clientMsgID, wrappedPrompt)

	stampedAt := time.Now().UTC().Format(time.RFC3339Nano)
	b.srv.mu.Lock()
	if cur := b.srv.agents[agentID]; cur != nil {
		cur.record.UpdatedAt = stampedAt
		cur.record.LastUserMessageAt = &stampedAt
		cur.record.LastStatus = resolveAgentStatus(cur.record.LastStatus, mp.session.Status())
		rec = cur.record
	}
	b.srv.mu.Unlock()
	_ = b.srv.store.UpsertAgent(rec)
	b.srv.broadcastAgentUpdate(rec)
	return nil
}

func applyReadOnlyVerifierPosture(rec *store.AgentRecord) {
	applyReadOnlyVerifierPostureWithConfig(rec, nil)
}

func applyReadOnlyVerifierPostureWithConfig(rec *store.AgentRecord, daemonConfig map[string]any) {
	if rec == nil {
		return
	}
	role := strings.ToLower(strings.TrimSpace(rec.Labels[chief.LabelRole]))
	if role != chief.RoleVerifier {
		return
	}
	if rec.Config == nil {
		rec.Config = &store.AgentConfig{}
	}
	spec := providers.ResolveProviderSpecWithConfig(rec.Provider, daemonConfig)
	switch spec.Protocol {
	case "claude-stream", "opencode-http":
		modeID := "plan"
		rec.Config.ModeID = &modeID
		rec.LastModeID = &modeID
	case "codex-rpc":
		if rec.Config.ProviderOptions == nil {
			rec.Config.ProviderOptions = make(map[string]any)
		}
		rec.Config.ProviderOptions["sandbox_mode"] = "read-only"
		rec.Config.ProviderOptions["approval_policy"] = "never"
		if rec.Config.FeatureValues == nil {
			rec.Config.FeatureValues = make(map[string]any)
		}
		rec.Config.FeatureValues["plan_mode"] = true
	}
}

func (b *chiefBridge) agentRuntimeState(agentID string) chief.AgentRuntimeState {
	if b == nil || b.srv == nil || strings.TrimSpace(agentID) == "" {
		return chief.AgentRuntimeState{}
	}
	b.srv.mu.Lock()
	mp := b.srv.agents[agentID]
	b.srv.mu.Unlock()
	if mp != nil && mp.session != nil {
		st := mp.session.Status()
		return chief.AgentRuntimeState{Loaded: true, Status: st}
	}
	rec, err := b.srv.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return chief.AgentRuntimeState{Loaded: false, Status: "closed"}
	}
	status := rec.LastStatus
	if status == "" {
		status = "idle"
	}
	return chief.AgentRuntimeState{Loaded: false, Status: status}
}

func (b *chiefBridge) liveStatesForMission(m chief.Mission) map[string]chief.AgentRuntimeState {
	states := make(map[string]chief.AgentRuntimeState, 1+len(m.Threads)*3)
	add := func(agentID string) {
		if strings.TrimSpace(agentID) == "" {
			return
		}
		if _, seen := states[agentID]; seen {
			return
		}
		states[agentID] = b.agentRuntimeState(agentID)
	}
	add(m.ChiefAgentID)
	for _, th := range m.Threads {
		add(th.AuthorAgentID)
		add(th.VerifierAgentID)
		add(th.IntegratorAgentID)
	}
	return states
}

func (b *chiefBridge) missionSnapshot(m chief.Mission) chief.MissionSnapshot {
	return chief.BuildMissionSnapshot(m, b.liveStatesForMission(m))
}

func (b *chiefBridge) broadcastMissionUpdate(m *chief.Mission, latestEvent *chief.Event) {
	if b == nil || b.srv == nil || m == nil {
		return
	}
	snap := b.missionSnapshot(*m)
	payload := map[string]any{
		"kind":    "upsert",
		"mission": snap,
	}
	if latestEvent != nil {
		payload["latestEvent"] = latestEvent
	}
	b.srv.broadcastSessionMsg("chief.mission.update", payload)
	b.srv.publishWorkspaceStatusChanges()
}

func (b *chiefBridge) currentAgentRecord(agentID string, fallback store.AgentRecord) store.AgentRecord {
	b.srv.mu.Lock()
	mp := b.srv.agents[agentID]
	b.srv.mu.Unlock()
	if mp != nil {
		return mp.record
	}
	if rec, err := b.srv.store.GetAgent(agentID); err == nil && rec != nil {
		return *rec
	}
	return fallback
}

func (b *chiefBridge) probeAgent(agentID string) chief.AgentWatchSnapshot {
	var snap chief.AgentWatchSnapshot
	if b == nil || b.srv == nil || strings.TrimSpace(agentID) == "" {
		return snap
	}
	b.srv.mu.Lock()
	mp := b.srv.agents[agentID]
	if mp != nil {
		snap.Loaded = true
		snap.RecordStatus = mp.record.LastStatus
		if mp.record.LastError != nil {
			snap.LastError = *mp.record.LastError
		}
		if mp.session != nil {
			snap.SessionStatus = mp.session.Status()
			snap.HasPendingPermission = len(mp.session.PendingPermissions()) > 0
			if snap.LastError == "" {
				snap.LastError = mp.session.LastError()
			}
		}
	}
	b.srv.mu.Unlock()
	if !snap.Loaded {
		if rec, err := b.srv.store.GetAgent(agentID); err == nil && rec != nil {
			snap.RecordStatus = rec.LastStatus
			if snap.SessionStatus == "" {
				snap.SessionStatus = rec.LastStatus
			}
			if rec.LastError != nil {
				snap.LastError = *rec.LastError
			}
		}
	}
	return snap
}

func (b *chiefBridge) stallThresholds() (time.Duration, time.Duration) {
	soft := time.Duration(chief.DefaultSoftStallSeconds) * time.Second
	hard := time.Duration(chief.DefaultHardStallSeconds) * time.Second
	if b == nil || b.srv == nil || b.srv.store == nil {
		return soft, hard
	}
	cfg, _, err := chief.ParseRoutingConfig(b.srv.store.LoadDaemonConfig())
	if err != nil {
		return soft, hard
	}
	if cfg.Stall.SoftWarningSec > 0 {
		soft = time.Duration(cfg.Stall.SoftWarningSec) * time.Second
	}
	if cfg.Stall.HardRecoverySec > 0 {
		hard = time.Duration(cfg.Stall.HardRecoverySec) * time.Second
	}
	return soft, hard
}

func (b *chiefBridge) notifyHuman(ctx context.Context, missionID, chiefAgentID string, att chief.SystemAttention) {
	if b == nil || b.srv == nil || strings.TrimSpace(chiefAgentID) == "" {
		return
	}
	ts := att.Since
	if ts == "" {
		ts = time.Now().UTC().Format(time.RFC3339Nano)
	}
	b.srv.markAgentAttention(chiefAgentID, AttentionReasonPermission, ts)
	b.srv.publishWorkspaceStatusChanges()
}

func (b *chiefBridge) reconcileChiefPermissionAttention(missionID string) {
	if b == nil || b.srv == nil || b.store == nil {
		return
	}
	m, err := b.store.GetMission(missionID)
	if err != nil || m == nil || m.ChiefAgentID == "" {
		return
	}
	chiefID := m.ChiefAgentID
	missions, listErr := b.store.ListMissions()
	if listErr != nil {
		return
	}
	for _, item := range missions {
		if item.ChiefAgentID != chiefID {
			continue
		}
		if item.Status == chief.MissionStatusCompleted || item.Status == chief.MissionStatusCanceled {
			continue
		}
		if chief.MissionNeedsHumanAttention(item) {
			return
		}
	}
	rec := b.currentAgentRecord(chiefID, store.AgentRecord{})
	if rec.ID != "" && rec.RequiresAttention && rec.AttentionReason != nil && *rec.AttentionReason == AttentionReasonPermission {
		b.srv.clearAgentAttention(chiefID)
	}
}

func (b *chiefBridge) onDeadSession(ctx context.Context, m chief.Mission, th chief.Thread, role, agentID string, snap chief.AgentWatchSnapshot) {
	b.recoverOrEscalateAgent(ctx, m.ID, th.ID, role, agentID, "process_crash", snap.LastError)
}

func (b *chiefBridge) onSoftStall(ctx context.Context, m chief.Mission, th chief.Thread, role, agentID string, stalledFor time.Duration) {
	_, _ = b.store.AppendEvent(m.ID, chief.Event{
		ThreadID:      chiefStrPtr(th.ID),
		Kind:          chief.EventStallWarning,
		TargetAgentID: chiefStrPtr(m.ChiefAgentID),
		Summary:       fmt.Sprintf("%s agent %s stalled for %ds with zero progress", role, agentID, int(stalledFor.Seconds())),
		Ts:            time.Now().UTC().Format(time.RFC3339Nano),
	})
	if updated, err := b.store.GetMission(m.ID); err == nil && updated != nil {
		b.broadcastMissionUpdate(updated, nil)
	}
}

func (b *chiefBridge) onHardStall(ctx context.Context, m chief.Mission, th chief.Thread, role, agentID string, stalledFor time.Duration) {
	summary := fmt.Sprintf("%s agent %s reached hard stall (%ds) with zero progress", role, agentID, int(stalledFor.Seconds()))
	_, _ = b.store.AppendEvent(m.ID, chief.Event{
		ThreadID:      chiefStrPtr(th.ID),
		Kind:          chief.EventStallHard,
		TargetAgentID: chiefStrPtr(m.ChiefAgentID),
		Summary:       summary,
		Ts:            time.Now().UTC().Format(time.RFC3339Nano),
	})
	b.recoverOrEscalateAgent(ctx, m.ID, th.ID, role, agentID, chief.AttentionKindStall, summary)
}

func (b *chiefBridge) recoverOrEscalateAgent(ctx context.Context, missionID, threadID, role, agentID, incidentKind, reason string) {
	if b == nil || b.srv == nil || strings.TrimSpace(agentID) == "" {
		return
	}
	key := missionID + "\x00" + agentID
	b.mu.Lock()
	b.recoveryAttempts[key]++
	attempt := b.recoveryAttempts[key]
	b.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if attempt <= maxChiefColdResumeAttempts {
		b.srv.mu.Lock()
		if mp := b.srv.agents[agentID]; mp != nil && mp.session != nil && mp.session.Status() == "closed" {
			delete(b.srv.agents, agentID)
		}
		b.srv.mu.Unlock()

		if mp, err := b.srv.ensureAgentLoaded(agentID); err == nil && mp != nil {
			b.mu.Lock()
			delete(b.recoveryAttempts, key)
			b.mu.Unlock()
			action := "cold_resume"
			att := chief.SystemAttention{
				Kind:            incidentKind,
				Severity:        chief.SeverityWarning,
				Summary:         chief.ClampSummary(fmt.Sprintf("%s agent %s recovered via cold resume (attempt %d): %s", role, agentID, attempt, reason)),
				AgentID:         chiefStrPtr(agentID),
				ThreadID:        chiefStrPtr(threadID),
				Since:           now,
				AutoActionTaken: &action,
			}
			_, _ = b.router.RaiseIncident(ctx, missionID, threadID, att, false)
			_ = b.router.RecordProgress(missionID, agentID)
			_ = b.router.RingBell(ctx, missionID, agentID, "cold_resume")
			if m, err := b.store.GetMission(missionID); err == nil && m != nil {
				b.broadcastMissionUpdate(m, nil)
			}
			return
		}
	}

	ev, _ := b.store.AppendEvent(missionID, chief.Event{
		ThreadID:     chiefStrPtr(threadID),
		Kind:         chief.EventProcessCrashed,
		ActorAgentID: chiefStrPtr(agentID),
		Summary:      chief.ClampSummary(fmt.Sprintf("%s agent %s recovery exhausted after %d attempt(s): %s", role, agentID, attempt, reason)),
		Ts:           now,
	})
	_, _ = b.router.RaiseIncident(ctx, missionID, threadID, chief.SystemAttention{
		Kind:     incidentKind,
		Severity: chief.SeverityFatal,
		Summary:  chief.ClampSummary(fmt.Sprintf("%s agent %s failed (%s); cold-resume exhausted", role, agentID, reason)),
		AgentID:  chiefStrPtr(agentID),
		ThreadID: chiefStrPtr(threadID),
		Since:    now,
	}, true)
	if m, err := b.store.GetMission(missionID); err == nil && m != nil {
		b.broadcastMissionUpdate(m, &ev)
	}
}

func (b *chiefBridge) RecordAgentProgress(agentID string) {
	if b == nil || b.router == nil || b.store == nil || strings.TrimSpace(agentID) == "" {
		return
	}
	missions, err := b.store.ListMissions()
	if err != nil {
		return
	}
	for _, m := range missions {
		if m.Status != chief.MissionStatusActive {
			continue
		}
		for _, th := range m.Threads {
			if th.AuthorAgentID == agentID || th.VerifierAgentID == agentID || th.IntegratorAgentID == agentID {
				_ = b.router.RecordProgress(m.ID, agentID)
				break
			}
		}
	}
}

func (b *chiefBridge) RecordUsageProgress(agentID string, usage any) {
	if b == nil || strings.TrimSpace(agentID) == "" || usage == nil {
		return
	}
	total := extractUsageTotalTokens(usage)
	if total <= 0 {
		return
	}
	b.mu.Lock()
	prev := b.usageTokens[agentID]
	grew := total > prev
	if grew {
		b.usageTokens[agentID] = total
	}
	b.mu.Unlock()
	if grew {
		b.RecordAgentProgress(agentID)
	}
}

func extractUsageTotalTokens(usage any) int64 {
	switch u := usage.(type) {
	case *sdk.AgentUsage:
		if u == nil {
			return 0
		}
		total := int64(u.InputTokens + u.CachedInputTokens + u.OutputTokens)
		if u.ContextWindowUsedTokens != nil && int64(*u.ContextWindowUsedTokens) > total {
			total = int64(*u.ContextWindowUsedTokens)
		}
		return total
	case sdk.AgentUsage:
		total := int64(u.InputTokens + u.CachedInputTokens + u.OutputTokens)
		if u.ContextWindowUsedTokens != nil && int64(*u.ContextWindowUsedTokens) > total {
			total = int64(*u.ContextWindowUsedTokens)
		}
		return total
	case map[string]any:
		var sum int64
		for _, key := range []string{"inputTokens", "cachedInputTokens", "outputTokens", "contextWindowUsedTokens", "input", "output", "cacheRead", "cacheWrite", "totalTokens", "total"} {
			switch v := u[key].(type) {
			case float64:
				sum += int64(v)
			case int64:
				sum += v
			case int:
				sum += int64(v)
			}
		}
		return sum
	default:
		return 0
	}
}

func (b *chiefBridge) capturePreTurnBaseline(rec store.AgentRecord) {
	if b == nil || rec.ID == "" {
		return
	}
	_, _, orchRole, ok := chief.OrchestrationMetaFromLabels(rec.Labels)
	if !ok {
		return
	}
	role := strings.ToLower(strings.TrimSpace(orchRole))
	if role != chief.RoleVerifier && role != chief.RoleAuthor {
		return
	}

	b.mu.Lock()
	if role == chief.RoleAuthor && rec.Cwd != "" {
		for vID, vb := range b.verifierBaselines {
			if vb != nil && vb.cwd == rec.Cwd && vb.verdictClean {
				vb.superseded = true
				delete(b.verifierBaselines, vID)
			}
		}
	}
	b.mu.Unlock()

	snap := snapshotGitCheckout(context.Background(), rec.Cwd)
	if snap == nil {
		return
	}
	b.mu.Lock()
	switch role {
	case chief.RoleVerifier:
		b.verifierBaselines[rec.ID] = snap
	case chief.RoleAuthor:
		b.authorBaselines[rec.ID] = snap
	}
	b.mu.Unlock()
}

func (b *chiefBridge) EnsureTurnBaseline(rec store.AgentRecord) {
	if b == nil || rec.ID == "" {
		return
	}
	_, _, orchRole, ok := chief.OrchestrationMetaFromLabels(rec.Labels)
	if !ok {
		return
	}
	role := strings.ToLower(strings.TrimSpace(orchRole))
	b.mu.Lock()
	var exists bool
	switch role {
	case chief.RoleVerifier:
		exists = b.verifierBaselines[rec.ID] != nil
	case chief.RoleAuthor:
		exists = b.authorBaselines[rec.ID] != nil
	default:
		exists = true
	}
	b.mu.Unlock()
	if !exists {
		b.capturePreTurnBaseline(rec)
	}
}

func snapshotGitCheckout(ctx context.Context, cwd string) *gitCheckoutBaseline {
	if strings.TrimSpace(cwd) == "" {
		return nil
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	status, err := workspace.GitRawOutput(cctx, cwd, "status", "--porcelain=v1", "-z")
	if err != nil {
		return nil
	}
	head, headErr := workspace.Git(cctx, cwd, "rev-parse", "HEAD")
	if headErr != nil {
		head = ""
	}
	return &gitCheckoutBaseline{
		cwd:      cwd,
		status:   status,
		headSha:  strings.TrimSpace(head),
		captured: time.Now().UTC(),
	}
}

func (b *chiefBridge) evaluateVerifierMutation(ctx context.Context, verifierAgentID, cwd string) (bool, string) {
	if b == nil || strings.TrimSpace(cwd) == "" {
		return false, ""
	}
	b.mu.Lock()
	base := b.verifierBaselines[verifierAgentID]
	b.mu.Unlock()
	if base == nil || base.superseded {
		return false, ""
	}
	after := snapshotGitCheckout(ctx, cwd)
	if after == nil {
		return false, ""
	}
	var reasons []string
	if after.headSha != base.headSha {
		reasons = append(reasons, fmt.Sprintf("HEAD changed (%s -> %s)", shortSha(base.headSha), shortSha(after.headSha)))
	}
	if after.status != base.status {
		reasons = append(reasons, fmt.Sprintf("git status changed (%s)", strings.Join(parsePorcelainFiles(after.status), ", ")))
	}
	if len(reasons) == 0 {
		return false, ""
	}
	return true, strings.Join(reasons, "; ")
}

func shortSha(sha string) string {
	if len(sha) <= 8 {
		return sha
	}
	return sha[:8]
}

func parsePorcelainFiles(porcelain string) []string {
	seen := make(map[string]bool)
	var files []string
	entries := strings.Split(porcelain, "\x00")
	for i := 0; i < len(entries); i++ {
		entry := entries[i]
		if len(entry) < 4 {
			continue
		}
		status := entry[:2]
		pathPart := entry[3:]
		if strings.ContainsAny(status, "RC") && i+1 < len(entries) {
			i++
		}
		pathPart = filepath.ToSlash(pathPart)
		if pathPart != "" && !seen[pathPart] {
			seen[pathPart] = true
			files = append(files, pathPart)
		}
	}
	return files
}

func (b *chiefBridge) collectGitChangedFiles(ctx context.Context, cwd string, base *gitCheckoutBaseline) []string {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	seen := make(map[string]bool)
	var files []string
	add := func(p string) {
		p = filepath.ToSlash(p)
		if p != "" && !seen[p] {
			seen[p] = true
			files = append(files, p)
		}
	}
	if status, err := workspace.GitRawOutput(cctx, cwd, "status", "--porcelain=v1", "-z"); err == nil {
		for _, f := range parsePorcelainFiles(status) {
			add(f)
		}
	}
	if base != nil && base.headSha != "" {
		if afterHead, err := workspace.Git(cctx, cwd, "rev-parse", "HEAD"); err == nil {
			afterHead = strings.TrimSpace(afterHead)
			if afterHead != "" && afterHead != base.headSha {
				if diffOut, diffErr := workspace.GitRawOutput(cctx, cwd, "diff", "--name-only", "-z", base.headSha, afterHead); diffErr == nil {
					for _, path := range strings.Split(diffOut, "\x00") {
						add(path)
					}
				}
			}
		}
	}
	sort.Strings(files)
	return files
}

func (b *chiefBridge) OnAgentTurnCompleted(ctx context.Context, rec store.AgentRecord, _ string) {
	if b == nil || b.router == nil || rec.ID == "" {
		return
	}
	missionID, threadID, orchRole, isOrch := chief.OrchestrationMetaFromLabels(rec.Labels)

	var turnCtx chief.TurnCompletionContext
	if isOrch {
		switch strings.ToLower(strings.TrimSpace(orchRole)) {
		case chief.RoleVerifier:
			b.mu.Lock()
			base := b.verifierBaselines[rec.ID]
			b.mu.Unlock()
			if base != nil && !base.reported && !base.superseded {
				if mutated, details := b.evaluateVerifierMutation(ctx, rec.ID, rec.Cwd); mutated && missionID != "" && threadID != "" {
					if m, getErr := b.store.GetMission(missionID); getErr == nil && m != nil {
						alreadyTainted := false
						for _, th := range m.Threads {
							if th.ID == threadID && th.LastVerdict != nil && th.LastVerdict.Tainted {
								alreadyTainted = true
								break
							}
						}
						if !alreadyTainted {
							updated, auditErr := b.router.AuditVerifierMutation(ctx, chief.VerdictInput{
								MissionID:       missionID,
								ThreadID:        threadID,
								ActorAgentID:    rec.ID,
								Outcome:         "reject",
								Summary:         "tainted: verifier modified checkout",
								VerifierMutated: true,
								MutationDetails: details,
							})
							if auditErr != nil {
								slog.Error("audit verifier mutation", "missionId", missionID, "threadId", threadID, "err", auditErr)
							}
							if updated != nil {
								b.broadcastMissionUpdate(updated, nil)
							}
							attentionMission := updated
							if attentionMission == nil && auditErr != nil {
								attentionMission, _ = b.store.GetMission(missionID)
							}
							terminal := false
							if attentionMission != nil {
								terminal = attentionMission.Status == chief.MissionStatusCompleted || attentionMission.Status == chief.MissionStatusFailed || attentionMission.Status == chief.MissionStatusCanceled
								for _, th := range attentionMission.Threads {
									if th.ID == threadID && (th.Status == chief.ThreadStatusLanded || th.Status == chief.ThreadStatusFailed || th.Status == chief.ThreadStatusCanceled) {
										terminal = true
									}
								}
							}
							if attentionMission != nil && (terminal || auditErr != nil) {
								b.notifyHuman(ctx, missionID, attentionMission.ChiefAgentID, chief.SystemAttention{
									Kind: chief.AttentionKindVerifyEscalated, Severity: chief.SeverityFatal,
									Summary: "verifier modified checkout after terminal state",
								})
							}
						}
					}
				}
			}
			b.mu.Lock()
			delete(b.verifierBaselines, rec.ID)
			b.mu.Unlock()

		case chief.RoleAuthor:
			b.mu.Lock()
			base := b.authorBaselines[rec.ID]
			delete(b.authorBaselines, rec.ID)
			b.mu.Unlock()
			turnCtx = b.buildAuthorTurnCompletionContext(ctx, missionID, threadID, rec.Cwd, base)
		}
	}

	_ = b.router.OnAgentTurnCompleted(ctx, rec.ID, turnCtx)
	if missionID != "" {
		if m, err := b.store.GetMission(missionID); err == nil && m != nil {
			b.broadcastMissionUpdate(m, nil)
		}
	}
}

func (b *chiefBridge) buildAuthorTurnCompletionContext(ctx context.Context, missionID, threadID, cwd string, base *gitCheckoutBaseline) chief.TurnCompletionContext {
	if missionID == "" || threadID == "" || strings.TrimSpace(cwd) == "" {
		return chief.TurnCompletionContext{}
	}
	m, err := b.store.GetMission(missionID)
	if err != nil || m == nil {
		return chief.TurnCompletionContext{}
	}
	var th *chief.Thread
	for i := range m.Threads {
		if m.Threads[i].ID == threadID {
			th = &m.Threads[i]
			break
		}
	}
	if th == nil {
		return chief.TurnCompletionContext{}
	}
	if th.LastSubmit != nil && base != nil {
		if subTime, err := time.Parse(time.RFC3339Nano, th.LastSubmit.SubmittedAt); err == nil && !subTime.Before(base.captured) {
			return chief.TurnCompletionContext{HasUnreportedChanges: false}
		}
	}
	changed := b.collectGitChangedFiles(ctx, cwd, base)
	if len(changed) == 0 {
		return chief.TurnCompletionContext{}
	}
	return chief.TurnCompletionContext{
		HasUnreportedChanges: true,
		ChangedFiles:         changed,
	}
}

func (b *chiefBridge) OnAgentTurnInterrupted(ctx context.Context, agentID string) {
	if b == nil || b.router == nil || strings.TrimSpace(agentID) == "" {
		return
	}
	b.mu.Lock()
	delete(b.verifierBaselines, agentID)
	delete(b.authorBaselines, agentID)
	b.mu.Unlock()
	_ = b.router.OnAgentTurnInterrupted(ctx, agentID)
}

func (b *chiefBridge) OnAgentTurnFailed(ctx context.Context, rec store.AgentRecord, errMsg string) {
	if b == nil || b.router == nil {
		return
	}
	b.OnAgentTurnInterrupted(ctx, rec.ID)

	missionID, threadID, orchRole, isOrch := chief.OrchestrationMetaFromLabels(rec.Labels)
	if !isOrch || missionID == "" {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	cls := chief.ClassifyProviderError(rec.Provider, errMsg)
	attKind := attentionKindForErrorClass(cls.Class)
	sev := chief.SeverityFatal
	if cls.Class == chief.ErrorRateLimited || cls.Class == chief.ErrorTransient {
		sev = chief.SeverityWarning
	}

	ev, _ := b.store.AppendEvent(missionID, chief.Event{
		ThreadID:     chiefStrPtr(threadID),
		Kind:         chief.EventProviderError,
		ActorAgentID: chiefStrPtr(rec.ID),
		Summary:      chief.ClampSummary(fmt.Sprintf("%s agent %s error (%s): %s", orchRole, rec.ID, cls.Class, errMsg)),
		Payload:      map[string]any{"class": cls.Class, "provider": rec.Provider},
		Ts:           now,
	})

	fallbackExhausted := cls.NeedsHumanAction
	var autoAction *string
	if cls.NeedsHotSwap && threadID != "" {
		if swapped, actionDesc := b.tryHotSwapProfile(ctx, missionID, threadID, orchRole, rec.ID); swapped {
			autoAction = &actionDesc
			fallbackExhausted = false
		} else {
			fallbackExhausted = true
			sev = chief.SeverityFatal
		}
	} else if !cls.Retryable && !cls.NeedsHotSwap {
		fallbackExhausted = true
	}

	_, _ = b.router.RaiseIncident(ctx, missionID, threadID, chief.SystemAttention{
		Kind:            attKind,
		Severity:        sev,
		Summary:         chief.ClampSummary(fmt.Sprintf("%s agent %s: %s", orchRole, rec.ID, errMsg)),
		AgentID:         chiefStrPtr(rec.ID),
		ThreadID:        chiefStrPtr(threadID),
		Since:           now,
		AutoActionTaken: autoAction,
	}, fallbackExhausted)

	if m, err := b.store.GetMission(missionID); err == nil && m != nil {
		b.broadcastMissionUpdate(m, &ev)
	}
}

func attentionKindForErrorClass(cls chief.ErrorClass) string {
	switch cls {
	case chief.ErrorQuotaExhausted:
		return chief.AttentionKindQuotaExhausted
	case chief.ErrorRateLimited:
		return chief.AttentionKindRateLimited
	case chief.ErrorAuthError:
		return chief.AttentionKindAuthError
	default:
		return chief.AttentionKindProcessCrash
	}
}

func (b *chiefBridge) tryHotSwapProfile(ctx context.Context, missionID, threadID, role, agentID string) (bool, string) {
	result, err := NewAgentHotSwapService(b).HotSwap(ctx, AgentHotSwapRequest{
		AgentID: agentID, ThreadID: threadID, MissionID: missionID,
		Reason: "automatic fallback for " + role,
	})
	if err != nil || !result.Accepted {
		return false, ""
	}
	return true, "hot_swap:" + result.ProfileID
}

func (b *chiefBridge) OnAgentProcessExit(ctx context.Context, rec store.AgentRecord, reason string) {
	if b == nil || b.router == nil {
		return
	}
	b.OnAgentTurnInterrupted(ctx, rec.ID)

	missionID, threadID, orchRole, isOrch := chief.OrchestrationMetaFromLabels(rec.Labels)
	if !isOrch || missionID == "" || threadID == "" {
		return
	}
	m, err := b.store.GetMission(missionID)
	if err != nil || m == nil || m.Status != chief.MissionStatusActive {
		return
	}
	var activeThread *chief.Thread
	for i := range m.Threads {
		if m.Threads[i].ID == threadID {
			activeThread = &m.Threads[i]
			break
		}
	}
	if activeThread == nil {
		return
	}
	expectedActive := (orchRole == chief.RoleAuthor && activeThread.Status == chief.ThreadStatusAuthoring) ||
		(orchRole == chief.RoleVerifier && activeThread.Status == chief.ThreadStatusVerifying) ||
		(activeThread.Status == chief.ThreadStatusNeedsRebase)
	if !expectedActive {
		return
	}
	b.recoverOrEscalateAgent(ctx, missionID, threadID, orchRole, rec.ID, chief.AttentionKindProcessCrash, reason)
}

func (b *chiefBridge) OnAgentPermissionRequested(ctx context.Context, rec store.AgentRecord, req map[string]any) {
	if b == nil || b.router == nil {
		return
	}
	missionID, threadID, orchRole, isOrch := chief.OrchestrationMetaFromLabels(rec.Labels)
	if !isOrch || missionID == "" {
		return
	}
	toolName, _ := req["toolName"].(string)
	if toolName == "" {
		toolName, _ = req["title"].(string)
	}
	summary := fmt.Sprintf("%s agent %s requires permission", orchRole, rec.ID)
	if toolName != "" {
		summary += " for " + toolName
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	ev, _ := b.store.AppendEvent(missionID, chief.Event{
		ThreadID:     chiefStrPtr(threadID),
		Kind:         chief.EventPermissionBlocked,
		ActorAgentID: chiefStrPtr(rec.ID),
		Summary:      chief.ClampSummary(summary),
		Ts:           now,
	})
	_, _ = b.router.RaiseIncident(ctx, missionID, threadID, chief.SystemAttention{
		Kind:     chief.AttentionKindPermissionBlocked,
		Severity: chief.SeverityFatal,
		Summary:  chief.ClampSummary(summary),
		AgentID:  chiefStrPtr(rec.ID),
		ThreadID: chiefStrPtr(threadID),
		Since:    now,
	}, true)
	if m, err := b.store.GetMission(missionID); err == nil && m != nil {
		b.broadcastMissionUpdate(m, &ev)
	}
}

func (b *chiefBridge) OnAgentPermissionResolved(ctx context.Context, agentID string) {
	if b == nil || b.router == nil || strings.TrimSpace(agentID) == "" {
		return
	}
	rec, err := b.srv.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return
	}
	missionID, threadID, _, isOrch := chief.OrchestrationMetaFromLabels(rec.Labels)
	if !isOrch || missionID == "" {
		return
	}
	_ = b.router.ResolveIncident(missionID, threadID, chief.AttentionKindPermissionBlocked)
	b.RecordAgentProgress(agentID)
	b.reconcileChiefPermissionAttention(missionID)
	if m, getErr := b.store.GetMission(missionID); getErr == nil && m != nil {
		b.broadcastMissionUpdate(m, nil)
	}
}

func (b *chiefBridge) HandleWorkerNotification(ctx context.Context, rec store.AgentRecord, reason string) {
	if b == nil {
		return
	}
	missionID, _, _, isOrch := chief.OrchestrationMetaFromLabels(rec.Labels)
	if !isOrch || missionID == "" {
		return
	}
	switch reason {
	case finishReasonNeedsPerm:
		b.OnAgentPermissionRequested(ctx, rec, map[string]any{"title": "pending permission"})
	case finishReasonErrored:
		msg := "worker session exited"
		if rec.LastError != nil && *rec.LastError != "" {
			msg = *rec.LastError
		}
		b.OnAgentProcessExit(ctx, rec, msg)
	default:
	}
}

func (b *chiefBridge) isProviderReady(provider string) bool {
	p := strings.ToLower(strings.TrimSpace(provider))
	if p == "" {
		return false
	}
	if providers.IsKnownProvider(p) || providers.IsConfiguredProvider(b.srv.store.LoadDaemonConfig(), p) {
		return true
	}
	return false
}

func (b *chiefBridge) defaultProvider() string {
	cfg := b.srv.store.LoadDaemonConfig()
	if raw, ok := cfg["defaultProvider"].(string); ok && strings.TrimSpace(raw) != "" {
		return strings.ToLower(strings.TrimSpace(raw))
	}
	if raw, ok := cfg["provider"].(string); ok && strings.TrimSpace(raw) != "" {
		return strings.ToLower(strings.TrimSpace(raw))
	}
	for _, candidate := range []string{"pi", "claude", "codex", "opencode", "acp", "mock"} {
		if b.isProviderReady(candidate) {
			return candidate
		}
	}
	return "mock"
}

func (b *chiefBridge) findOrEnsureChiefAgent(explicitChiefID, callerAgentID string) (store.AgentRecord, bool, error) {
	if id := strings.TrimSpace(explicitChiefID); id != "" {
		rec, err := b.srv.store.GetAgent(id)
		if err != nil || rec == nil {
			return store.AgentRecord{}, false, fmt.Errorf("chief agent not found: %s", id)
		}
		if rec.ArchivedAt != nil {
			return store.AgentRecord{}, false, fmt.Errorf("chief agent is archived: %s", id)
		}
		return *rec, false, nil
	}
	if id := strings.TrimSpace(callerAgentID); id != "" {
		if rec, err := b.srv.store.GetAgent(id); err == nil && rec != nil && rec.ArchivedAt == nil {
			if rec.Labels[agentroles.RoleLabel] == "chief" || rec.Labels[chief.LabelRole] == chief.RoleChief {
				return *rec, false, nil
			}
		}
	}
	agents, _ := b.srv.store.ListAgents()
	var best *store.AgentRecord
	for i := range agents {
		rec := &agents[i]
		if rec.ArchivedAt != nil {
			continue
		}
		if rec.Labels[agentroles.RoleLabel] == "chief" || rec.Labels[chief.LabelRole] == chief.RoleChief {
			if best == nil || rec.UpdatedAt > best.UpdatedAt {
				cp := *rec
				best = &cp
			}
		}
	}
	if best != nil {
		return *best, false, nil
	}

	_ = b.srv.store.EnsureHomeWorkspace(b.srv.serverID)
	chiefCwd := filepath.Join(b.srv.homeDir, "chief")
	_ = os.MkdirAll(chiefCwd, 0o755)
	_, ws, err := b.srv.ensureWorkspaceForCwd(chiefCwd)
	if err != nil {
		return store.AgentRecord{}, false, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	title := "Chief"
	rec := store.AgentRecord{
		ID:          newAgentID(),
		Provider:    b.defaultProvider(),
		Cwd:         chiefCwd,
		WorkspaceID: ws.WorkspaceID,
		CreatedAt:   now,
		UpdatedAt:   now,
		Title:       &title,
		Labels: map[string]string{
			agentroles.RoleLabel: "chief",
			chief.LabelRole:      chief.RoleChief,
		},
		LastStatus: "idle",
		Config:     &store.AgentConfig{},
	}
	if err := b.srv.store.UpsertAgent(rec); err != nil {
		return store.AgentRecord{}, false, err
	}
	b.srv.broadcastAgentUpdate(rec)
	return rec, true, nil
}

func (b *chiefBridge) findWorkspace(wsID string) (*store.WorkspaceRecord, error) {
	items, err := b.srv.store.ListWorkspaces()
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].WorkspaceID == wsID {
			cp := items[i]
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("workspace not found: %s", wsID)
}

func (b *chiefBridge) findProject(projectID string) (*store.ProjectRecord, error) {
	items, err := b.srv.store.ListProjects()
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ProjectID == projectID {
			cp := items[i]
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("project not found: %s", projectID)
}

func (b *chiefBridge) resolveBaseTarget(ctx context.Context, projectID, workspaceID, baseCwd, baseBranch string, chiefRec store.AgentRecord) (resProjectID, resWsID, resCwd, resBranch string, err error) {
	if wsID := strings.TrimSpace(workspaceID); wsID != "" {
		ws, wsErr := b.findWorkspace(wsID)
		if wsErr != nil || ws == nil {
			return "", "", "", "", fmt.Errorf("workspace not found: %s", wsID)
		}
		resWsID = ws.WorkspaceID
		resProjectID = ws.ProjectID
		resCwd = ws.Cwd
		if ws.Branch != nil {
			resBranch = *ws.Branch
		}
	} else if cwd := strings.TrimSpace(baseCwd); cwd != "" {
		prj, ws, ensErr := b.srv.ensureWorkspaceForCwd(cwd)
		if ensErr != nil {
			return "", "", "", "", ensErr
		}
		resProjectID = prj.ProjectID
		resWsID = ws.WorkspaceID
		resCwd = ws.Cwd
		if ws.Branch != nil {
			resBranch = *ws.Branch
		}
	} else if pid := strings.TrimSpace(projectID); pid != "" {
		prj, pErr := b.findProject(pid)
		if pErr != nil || prj == nil {
			return "", "", "", "", fmt.Errorf("project not found: %s", pid)
		}
		resProjectID = prj.ProjectID
		resCwd = prj.RootPath
		_, ws, ensErr := b.srv.ensureWorkspaceForCwd(prj.RootPath)
		if ensErr == nil {
			resWsID = ws.WorkspaceID
			if ws.Branch != nil {
				resBranch = *ws.Branch
			}
		}
	} else {
		resWsID = chiefRec.WorkspaceID
		resCwd = chiefRec.Cwd
		if ws, wsErr := b.findWorkspace(chiefRec.WorkspaceID); wsErr == nil && ws != nil {
			resProjectID = ws.ProjectID
			if ws.Branch != nil {
				resBranch = *ws.Branch
			}
		}
	}
	if strings.TrimSpace(baseBranch) != "" {
		resBranch = strings.TrimSpace(baseBranch)
	}
	if resBranch == "" && resCwd != "" {
		if bName, bErr := workspace.Git(ctx, resCwd, "rev-parse", "--abbrev-ref", "HEAD"); bErr == nil && bName != "" && bName != "HEAD" {
			resBranch = bName
		} else if def, dErr := workspace.ResolveDefaultBranch(ctx, resCwd); dErr == nil {
			resBranch = def
		}
	}
	return resProjectID, resWsID, resCwd, resBranch, nil
}

func (b *chiefBridge) resolveThreadProfiles(authorOverrideID, verifierOverrideID, authorProviderHint string) (chief.ChiefConfig, chief.Profile, chief.Profile, error) {
	cfg, profiles, err := chief.ParseRoutingConfig(b.srv.store.LoadDaemonConfig())
	if err != nil {
		return cfg, chief.Profile{}, chief.Profile{}, err
	}
	if len(profiles) == 0 && strings.TrimSpace(authorOverrideID) == "" && strings.TrimSpace(verifierOverrideID) == "" {
		defaultTier := cfg.DefaultTier
		if defaultTier == "" {
			defaultTier = chief.TierStandard
		}
		provider := firstNonEmptyStr(authorProviderHint, b.defaultProvider())
		author := chief.Profile{ID: "default-author", Name: "Default Author", Provider: provider, Tier: defaultTier}
		verifier := chief.Profile{ID: "default-verifier", Name: "Default Verifier", Provider: provider, Tier: defaultTier}
		if vErr := chief.ValidateVerifierTier(author.Tier, verifier.Tier); vErr != nil {
			return cfg, chief.Profile{}, chief.Profile{}, vErr
		}
		return cfg, author, verifier, nil
	}
	author, verifier, err := chief.ResolveRolePairForThread(cfg, profiles, authorOverrideID, verifierOverrideID, nil, b.isProviderReady)
	return cfg, author, verifier, err
}

func (b *chiefBridge) createWorkerRecord(missionID, threadID, role, chiefID, wsID, cwd, title string, prof chief.Profile) (store.AgentRecord, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	labels := chief.BuildOrchestrationLabels(missionID, threadID, role, true)
	if strings.TrimSpace(chiefID) != "" {
		labels[ParentAgentIDLabel] = chiefID
	}
	provider := firstNonEmptyStr(prof.Provider, b.defaultProvider())
	var featureVals map[string]any
	if len(prof.FeatureValues) > 0 {
		featureVals = make(map[string]any, len(prof.FeatureValues))
		for k, v := range prof.FeatureValues {
			featureVals[k] = v
		}
	}
	var parentPtr *string
	if strings.TrimSpace(chiefID) != "" {
		p := strings.TrimSpace(chiefID)
		parentPtr = &p
	}
	rec := store.AgentRecord{
		ID:            newAgentID(),
		Provider:      provider,
		Cwd:           cwd,
		WorkspaceID:   wsID,
		CreatedAt:     now,
		UpdatedAt:     now,
		Title:         chiefStrPtr(title),
		Labels:        labels,
		LastStatus:    "idle",
		LastModeID:    chiefStrPtr(prof.ModeID),
		ParentAgentID: parentPtr,
		Config: &store.AgentConfig{
			Model:            chiefStrPtr(prof.Model),
			ModeID:           chiefStrPtr(prof.ModeID),
			ThinkingOptionID: chiefStrPtr(prof.ThinkingOptionID),
			FeatureValues:    featureVals,
		},
	}
	applyReadOnlyVerifierPostureWithConfig(&rec, b.srv.providerConfigFor(rec.Provider))
	if err := b.srv.store.UpsertAgent(rec); err != nil {
		return store.AgentRecord{}, err
	}
	b.srv.broadcastAgentUpdate(rec)
	return rec, nil
}

func (b *chiefBridge) adoptExistingAuthor(agentID, missionID, threadID, chiefID string) (store.AgentRecord, error) {
	rec, err := b.srv.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return store.AgentRecord{}, fmt.Errorf("author agent not found: %s", agentID)
	}
	if rec.ArchivedAt != nil {
		return store.AgentRecord{}, fmt.Errorf("author agent is archived: %s", agentID)
	}
	if rec.Labels == nil {
		rec.Labels = make(map[string]string)
	}
	for k, v := range chief.BuildOrchestrationLabels(missionID, threadID, chief.RoleAuthor, true) {
		rec.Labels[k] = v
	}
	if strings.TrimSpace(chiefID) != "" {
		rec.Labels[ParentAgentIDLabel] = chiefID
		if rec.ParentAgentID == nil || strings.TrimSpace(*rec.ParentAgentID) == "" {
			c := strings.TrimSpace(chiefID)
			rec.ParentAgentID = &c
		}
	}
	rec.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)

	b.srv.mu.Lock()
	if mp := b.srv.agents[rec.ID]; mp != nil {
		mp.record = *rec
	}
	b.srv.mu.Unlock()
	if err := b.srv.store.UpsertAgent(*rec); err != nil {
		return store.AgentRecord{}, err
	}
	b.srv.broadcastAgentUpdate(*rec)
	return *rec, nil
}

func (b *chiefBridge) promptAgentWithText(ctx context.Context, agentID, promptText string, attachments []map[string]any) error {
	if strings.TrimSpace(promptText) == "" && len(attachments) == 0 {
		return nil
	}
	mp, err := b.srv.ensureAgentLoaded(agentID)
	if err != nil {
		return err
	}
	rec := b.currentAgentRecord(agentID, mp.record)
	b.capturePreTurnBaseline(rec)

	finalPrompt := promptText
	for _, att := range attachments {
		if txt, _ := att["text"].(string); strings.TrimSpace(txt) != "" {
			if finalPrompt != "" {
				finalPrompt += "\n\n"
			}
			finalPrompt += txt
		}
	}
	clientMsgID := newMessageID()
	mp.session.SetNextClientMessageID(clientMsgID)
	if err := mp.session.Prompt(ctx, finalPrompt, nil); err != nil {
		return err
	}
	b.srv.appendSubmittedPromptRow(rec, mp.session, clientMsgID, finalPrompt)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	b.srv.mu.Lock()
	if cur := b.srv.agents[agentID]; cur != nil {
		cur.record.LastStatus = resolveAgentStatus(cur.record.LastStatus, mp.session.Status())
		cur.record.UpdatedAt = now
		cur.record.LastUserMessageAt = &now
		rec = cur.record
	}
	b.srv.mu.Unlock()
	_ = b.srv.store.UpsertAgent(rec)
	b.srv.broadcastAgentUpdate(rec)
	return nil
}

func (b *chiefBridge) seedContextFromAgent(rec store.AgentRecord) map[string]any {
	var rows []pi.TimelineEntry
	b.srv.mu.Lock()
	mp := b.srv.agents[rec.ID]
	b.srv.mu.Unlock()
	if mp != nil && mp.session != nil {
		rows = mp.session.Timeline()
	} else if handle := nativeSessionHandle(rec); handle != "" && (rec.Provider == "pi" || rec.Provider == "") {
		if loaded, err := pi.LoadTimelineFromJSONL(handle); err == nil {
			rows = loaded
		}
	}
	title := rec.ID
	if rec.Title != nil && strings.TrimSpace(*rec.Title) != "" {
		title = strings.TrimSpace(*rec.Title)
	}
	res, err := buildForkContextAttachment(rows, nil, "", b.srv.epoch, title, rec.Cwd)
	if err != nil {
		return nil
	}
	return res.Attachment
}

type carriedFileState struct {
	kind   string
	mode   os.FileMode
	digest string
}

type l2WorktreePreparation struct {
	srv          *Server
	baseCwd      string
	workspace    store.WorkspaceRecord
	stashSha     string
	stashDropped bool
	carried      map[string]carriedFileState
	workerIDs    []string
	committed    bool
}

func fingerprintCarriedPath(root, path string) (carriedFileState, error) {
	fullPath := filepath.Join(root, filepath.FromSlash(path))
	rel, err := filepath.Rel(root, fullPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return carriedFileState{}, fmt.Errorf("unsafe carried path %q", path)
	}
	info, err := os.Lstat(fullPath)
	if os.IsNotExist(err) {
		return carriedFileState{kind: "missing"}, nil
	}
	if err != nil {
		return carriedFileState{}, err
	}
	state := carriedFileState{mode: info.Mode()}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, readErr := os.Readlink(fullPath)
		if readErr != nil {
			return carriedFileState{}, readErr
		}
		state.kind = "symlink"
		state.digest = fmt.Sprintf("%x", sha256.Sum256([]byte(target)))
	case info.Mode().IsRegular():
		f, openErr := os.Open(fullPath)
		if openErr != nil {
			return carriedFileState{}, openErr
		}
		h := sha256.New()
		_, copyErr := io.Copy(h, f)
		closeErr := f.Close()
		if copyErr != nil {
			return carriedFileState{}, copyErr
		}
		if closeErr != nil {
			return carriedFileState{}, closeErr
		}
		state.kind = "file"
		state.digest = fmt.Sprintf("%x", h.Sum(nil))
	case info.IsDir():
		return carriedFileState{}, fmt.Errorf("cannot safely fingerprint dirty directory %q", path)
	default:
		return carriedFileState{}, fmt.Errorf("cannot safely fingerprint special file %q", path)
	}
	return state, nil
}

func captureCarriedFiles(ctx context.Context, cwd string) (map[string]carriedFileState, error) {
	status, err := workspace.GitRawOutput(ctx, cwd, "status", "--porcelain", "-z", "--untracked-files=all", "--no-renames")
	if err != nil {
		return nil, fmt.Errorf("read base Git status: %w", err)
	}
	carried := make(map[string]carriedFileState)
	for _, record := range strings.Split(status, "\x00") {
		if record == "" {
			continue
		}
		if len(record) < 4 || record[2] != ' ' {
			return nil, fmt.Errorf("parse base Git status record %q", record)
		}
		path := record[3:]
		if path == "" {
			return nil, errors.New("base Git status returned an empty path")
		}
		state, fingerprintErr := fingerprintCarriedPath(cwd, path)
		if fingerprintErr != nil {
			return nil, fmt.Errorf("fingerprint carried path %q: %w", path, fingerprintErr)
		}
		carried[path] = state
	}
	return carried, nil
}

func verifyCarriedFiles(root string, expected map[string]carriedFileState) error {
	paths := make([]string, 0, len(expected))
	for path := range expected {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		actual, err := fingerprintCarriedPath(root, path)
		if err != nil {
			return fmt.Errorf("verify carried path %q: %w", path, err)
		}
		if actual != expected[path] {
			return fmt.Errorf("carried path %q differs in %s", path, root)
		}
	}
	return nil
}

func applyCarriedStash(ctx context.Context, cwd, stashSha string) error {
	if _, err := workspace.Git(ctx, cwd, "stash", "apply", "--index", stashSha); err == nil {
		return nil
	}
	_, err := workspace.Git(ctx, cwd, "stash", "apply", stashSha)
	return err
}

func (p *l2WorktreePreparation) recoveryLocations() string {
	stash := p.stashSha
	if stash == "" {
		stash = "<none>"
	} else if p.stashDropped {
		stash += " (dropped after verified base restore)"
	}
	worktree := p.workspace.Cwd
	if worktree == "" {
		worktree = "<not created>"
	}
	return fmt.Sprintf("base %s; worktree %s; stash %s", p.baseCwd, worktree, stash)
}

func (p *l2WorktreePreparation) abortWith(ctx context.Context, cause error) error {
	if p == nil {
		return cause
	}
	return errors.Join(cause, p.abort(ctx))
}

func (p *l2WorktreePreparation) trackWorker(agentID string) {
	if agentID != "" {
		p.workerIDs = append(p.workerIDs, agentID)
	}
}

func (p *l2WorktreePreparation) stopWorker(agentID string) error {
	p.srv.mu.Lock()
	mp := p.srv.agents[agentID]
	delete(p.srv.agents, agentID)
	p.srv.mu.Unlock()
	if mp != nil && mp.session != nil {
		if err := mp.session.Close(); err != nil {
			return fmt.Errorf("close new worker %s: %w", agentID, err)
		}
	}
	return nil
}

func (p *l2WorktreePreparation) deleteWorkerRecord(agentID string) error {
	var errs []error
	if err := p.srv.store.DeleteAgent(agentID); err != nil {
		errs = append(errs, fmt.Errorf("delete new worker record %s: %w", agentID, err))
	} else if rec, err := p.srv.store.GetAgent(agentID); err != nil {
		errs = append(errs, fmt.Errorf("verify new worker record removal %s: %w", agentID, err))
	} else if rec != nil {
		errs = append(errs, fmt.Errorf("new worker record remains after rollback: %s", agentID))
	}
	return errors.Join(errs...)
}

func (p *l2WorktreePreparation) dropStash(ctx context.Context) error {
	out, err := workspace.Git(ctx, p.baseCwd, "stash", "list", "--format=%H%x00%gd")
	if err != nil {
		return err
	}
	ref := ""
	for _, entry := range strings.Split(out, "\n") {
		parts := strings.SplitN(strings.TrimSuffix(entry, "\r"), "\x00", 2)
		if len(parts) == 2 && parts[0] == p.stashSha {
			ref = parts[1]
			break
		}
	}
	if ref == "" {
		return fmt.Errorf("temporary stash %s not found", p.stashSha)
	}
	_, err = workspace.Git(ctx, p.baseCwd, "stash", "drop", ref)
	return err
}

func (p *l2WorktreePreparation) commit(ctx context.Context) error {
	p.committed = true
	if p.stashSha == "" {
		return nil
	}
	if p.workspace.Cwd == "" {
		return fmt.Errorf("mission committed without a worktree for carried work; recovery: %s", p.recoveryLocations())
	}
	if err := verifyCarriedFiles(p.workspace.Cwd, p.carried); err != nil {
		return fmt.Errorf("mission committed but carried work could not be verified; stash retained: %w; recovery: %s", err, p.recoveryLocations())
	}
	if err := p.dropStash(ctx); err != nil {
		return fmt.Errorf("mission committed but temporary stash could not be dropped; stash retained: %w; recovery: %s", err, p.recoveryLocations())
	}
	p.stashDropped = true
	return nil
}

func (p *l2WorktreePreparation) startSetup() {
	if p.workspace.WorkspaceID != "" {
		p.srv.startWorkspaceSetup(p.workspace)
	}
}

func (p *l2WorktreePreparation) abort(ctx context.Context) error {
	if p.committed {
		return nil
	}
	var errs []error
	for _, agentID := range p.workerIDs {
		if err := p.stopWorker(agentID); err != nil {
			errs = append(errs, err)
		}
	}
	if p.workspace.WorkspaceID != "" {
		p.srv.stopWorkspaceTerminals(p.workspace.WorkspaceID)
		p.srv.stopWorkspaceSetup(p.workspace.WorkspaceID)
	}
	if p.stashSha != "" {
		if err := applyCarriedStash(ctx, p.baseCwd, p.stashSha); err != nil {
			errs = append(errs, fmt.Errorf("restore carried work to base: %w", err))
			errs = append(errs, fmt.Errorf("rollback incomplete; stash and worktree retained; recovery: %s", p.recoveryLocations()))
			return errors.Join(errs...)
		}
		if err := verifyCarriedFiles(p.baseCwd, p.carried); err != nil {
			errs = append(errs, err)
			errs = append(errs, fmt.Errorf("rollback incomplete; stash and worktree retained; recovery: %s", p.recoveryLocations()))
			return errors.Join(errs...)
		}
		if err := p.dropStash(ctx); err != nil {
			errs = append(errs, fmt.Errorf("drop restored temporary stash: %w", err))
			errs = append(errs, fmt.Errorf("rollback incomplete; stash and worktree retained; recovery: %s", p.recoveryLocations()))
			return errors.Join(errs...)
		}
		p.stashDropped = true
	}
	for _, agentID := range p.workerIDs {
		if err := p.deleteWorkerRecord(agentID); err != nil {
			errs = append(errs, err)
		}
	}
	if p.workspace.WorkspaceID == "" {
		return errors.Join(errs...)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	archived, err := p.srv.store.ArchiveWorkspace(p.workspace.WorkspaceID, now)
	if err != nil {
		errs = append(errs, fmt.Errorf("archive rolled-back worktree record: %w; recovery: %s", err, p.recoveryLocations()))
		return errors.Join(errs...)
	}
	if archived == nil {
		errs = append(errs, fmt.Errorf("archive rolled-back worktree record: workspace %s not found; recovery: %s", p.workspace.WorkspaceID, p.recoveryLocations()))
		return errors.Join(errs...)
	}
	if prj, ok := p.srv.projectForWorkspace(archived.ProjectID); ok {
		p.srv.broadcastWorkspaceUpsert(*archived, prj)
	}
	p.srv.releaseArchivedWorkspaceObservation(ctx, archived.WorkspaceID)
	if message, _, _ := p.srv.removeArchivedWorktree(ctx, *archived); message != nil {
		errs = append(errs, fmt.Errorf("remove rolled-back worktree %s: %s; recovery: %s", archived.Cwd, *message, p.recoveryLocations()))
	}
	return errors.Join(errs...)
}

func (b *chiefBridge) prepareL2Worktree(ctx context.Context, baseCwd, branchSlug, title, dirtyPolicy string) (*l2WorktreePreparation, error) {
	policy := strings.ToLower(strings.TrimSpace(dirtyPolicy))
	if policy == "" {
		policy = "fail_if_dirty"
	}
	if policy != "fail_if_dirty" && policy != "carry_into_thread_1" {
		return nil, fmt.Errorf("invalid dirtyPolicy %q", dirtyPolicy)
	}
	carried, err := captureCarriedFiles(ctx, baseCwd)
	if err != nil {
		return nil, err
	}
	if len(carried) > 0 && policy == "fail_if_dirty" {
		return nil, errors.New("checkout has uncommitted changes; clean working directory or pass dirtyPolicy=carry_into_thread_1")
	}
	prep := &l2WorktreePreparation{srv: b.srv, baseCwd: baseCwd, carried: carried}
	if len(carried) > 0 {
		if _, err := workspace.Git(ctx, baseCwd, "stash", "push", "--include-untracked", "-m", "byspace-chief-upgrade-carry"); err != nil {
			return nil, fmt.Errorf("stash dirty changes for carry_into_thread_1: %w", err)
		}
		prep.stashSha = "stash@{0}"
		sha, resolveErr := workspace.Git(ctx, baseCwd, "rev-parse", "--verify", prep.stashSha)
		if resolveErr != nil || strings.TrimSpace(sha) == "" {
			abortErr := prep.abort(ctx)
			return nil, errors.Join(fmt.Errorf("resolve created stash reference: %w", resolveErr), abortErr)
		}
		prep.stashSha = strings.TrimSpace(sha)
	}

	slug := workspace.NormalizeWorktreeSlug(firstNonEmptyStr(branchSlug, title, "thread-1"))
	wsRec, _, wtErr := b.srv.createWorktreeWorkspaceWithSetup(ctx, baseCwd, chiefStrPtr(title), workspace.WorktreeIntentInput{
		WorktreeSlug: slug,
	}, nil, false)
	if wtErr != nil {
		abortErr := prep.abort(ctx)
		return nil, errors.Join(wtErr, abortErr)
	}
	prep.workspace = wsRec
	if prep.stashSha != "" {
		if err := applyCarriedStash(ctx, wsRec.Cwd, prep.stashSha); err != nil {
			abortErr := prep.abort(ctx)
			return nil, errors.Join(fmt.Errorf("apply carried changes into Thread 1 worktree: %w", err), abortErr)
		}
		if err := verifyCarriedFiles(wsRec.Cwd, carried); err != nil {
			abortErr := prep.abort(ctx)
			return nil, errors.Join(fmt.Errorf("verify carried changes in Thread 1 worktree: %w", err), abortErr)
		}
	}
	return prep, nil
}

func (s *Server) handleChiefMissionList(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID        string   `json:"requestId"`
		ChiefAgentID     string   `json:"chiefAgentId"`
		ProjectID        string   `json:"projectId"`
		BaseWorkspaceID  string   `json:"baseWorkspaceId"`
		Statuses         []string `json:"statuses"`
		IncludeCompleted bool     `json:"includeCompleted"`
	}
	_ = json.Unmarshal(raw, &req)
	if s.chief == nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.list.response", map[string]any{
			"requestId": req.RequestID, "missions": []chief.MissionSnapshot{}, "error": "chief orchestration not initialized",
		})
		return
	}

	all, err := s.chief.store.ListMissions()
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.list.response", map[string]any{
			"requestId": req.RequestID, "missions": []chief.MissionSnapshot{}, "error": err.Error(),
		})
		return
	}

	statusFilter := make(map[string]bool, len(req.Statuses))
	for _, st := range req.Statuses {
		if trimmed := strings.TrimSpace(st); trimmed != "" {
			statusFilter[trimmed] = true
		}
	}

	out := make([]chief.MissionSnapshot, 0, len(all))
	for _, m := range all {
		if req.ChiefAgentID != "" && m.ChiefAgentID != strings.TrimSpace(req.ChiefAgentID) {
			continue
		}
		if req.ProjectID != "" && m.ProjectID != strings.TrimSpace(req.ProjectID) {
			continue
		}
		if req.BaseWorkspaceID != "" && m.BaseWorkspaceID != strings.TrimSpace(req.BaseWorkspaceID) {
			continue
		}
		if len(statusFilter) > 0 {
			if !statusFilter[m.Status] {
				continue
			}
		} else if !req.IncludeCompleted && (m.Status == chief.MissionStatusCompleted || m.Status == chief.MissionStatusCanceled) {
			continue
		}
		out = append(out, s.chief.missionSnapshot(m))
	}

	_ = sendSessionMsg(ctx, sink, "chief.mission.list.response", map[string]any{
		"requestId": req.RequestID,
		"missions":  out,
		"error":     nil,
	})
}

func (s *Server) handleChiefMissionGet(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string `json:"requestId"`
		MissionID     string `json:"missionId"`
		IncludeEvents bool   `json:"includeEvents"`
		EventsLimit   int    `json:"eventsLimit"`
		AfterSeq      int64  `json:"afterSeq"`
	}
	_ = json.Unmarshal(raw, &req)
	if s.chief == nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.get.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": "chief orchestration not initialized",
		})
		return
	}

	m, err := s.chief.store.GetMission(strings.TrimSpace(req.MissionID))
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.get.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": err.Error(),
		})
		return
	}
	snap := s.chief.missionSnapshot(*m)
	payload := map[string]any{
		"requestId": req.RequestID,
		"mission":   &snap,
		"error":     nil,
	}
	if req.IncludeEvents || req.AfterSeq > 0 || req.EventsLimit > 0 {
		events, evErr := s.chief.store.ReadEvents(m.ID, req.AfterSeq, req.EventsLimit)
		if evErr != nil {
			_ = sendSessionMsg(ctx, sink, "chief.mission.get.response", map[string]any{
				"requestId": req.RequestID, "mission": nil, "error": evErr.Error(),
			})
			return
		}
		if events == nil {
			events = []chief.Event{}
		}
		payload["events"] = events
	}
	_ = sendSessionMsg(ctx, sink, "chief.mission.get.response", payload)
}

func (s *Server) handleChiefMissionCreate(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID       string `json:"requestId"`
		Goal            string `json:"goal"`
		Title           string `json:"title"`
		Tier            string `json:"tier"`
		ChiefAgentID    string `json:"chiefAgentId"`
		CallerAgentID   string `json:"callerAgentId"`
		ProjectID       string `json:"projectId"`
		BaseWorkspaceID string `json:"baseWorkspaceId"`
		BaseCwd         string `json:"baseCwd"`
		BaseBranch      string `json:"baseBranch"`
	}
	_ = json.Unmarshal(raw, &req)
	if s.chief == nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": "chief orchestration not initialized",
		})
		return
	}
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, false)
	if actorErr != nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": actorErr.Error(),
		})
		return
	}

	goal := strings.TrimSpace(req.Goal)
	if goal == "" {
		_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": "goal is required",
		})
		return
	}
	tier := strings.TrimSpace(req.Tier)
	if tier == "" {
		tier = chief.TierL1
	}
	if tier != chief.TierL0 && tier != chief.TierL1 && tier != chief.TierL2 {
		_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": fmt.Sprintf("invalid tier %q", tier),
		})
		return
	}

	chiefRec, _, err := s.chief.findOrEnsureChiefAgent(req.ChiefAgentID, actorID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": err.Error(),
		})
		return
	}
	projectID, wsID, cwd, branch, err := s.chief.resolveBaseTarget(ctx, req.ProjectID, req.BaseWorkspaceID, req.BaseCwd, req.BaseBranch, chiefRec)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": err.Error(),
		})
		return
	}

	cfg, _, _ := chief.ParseRoutingConfig(s.store.LoadDaemonConfig())
	landing := cfg.Landing
	now := time.Now().UTC().Format(time.RFC3339Nano)
	mission := chief.Mission{
		ID:              chief.NewID("mis"),
		Title:           firstNonEmptyStr(req.Title, goal),
		Goal:            goal,
		ChiefAgentID:    chiefRec.ID,
		ProjectID:       projectID,
		BaseWorkspaceID: wsID,
		BaseCwd:         cwd,
		BaseBranch:      branch,
		Tier:            tier,
		Status:          chief.MissionStatusActive,
		Landing:         &landing,
		Threads:         []chief.Thread{},
		Cursors:         map[string]int64{},
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	created, err := s.chief.store.CreateMission(mission)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": err.Error(),
		})
		return
	}
	ev, _ := s.chief.store.AppendEvent(created.ID, chief.Event{
		Kind:         chief.EventMissionCreated,
		ActorAgentID: chiefStrPtr(firstNonEmptyStr(actorID, chiefRec.ID)),
		Summary:      chief.ClampSummary(fmt.Sprintf("Created %s mission: %s", created.Tier, created.Title)),
		Ts:           now,
	})
	latest, _ := s.chief.store.GetMission(created.ID)
	if latest == nil {
		latest = &created
	}
	s.chief.broadcastMissionUpdate(latest, &ev)
	snap := s.chief.missionSnapshot(*latest)
	_ = sendSessionMsg(ctx, sink, "chief.mission.create.response", map[string]any{
		"requestId": req.RequestID,
		"mission":   &snap,
		"error":     nil,
	})
}

func (s *Server) handleChiefMissionUpgrade(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID          string   `json:"requestId"`
		MissionID          string   `json:"missionId"`
		SoloAgentID        string   `json:"soloAgentId"`
		CallerAgentID      string   `json:"callerAgentId"`
		TargetTier         string   `json:"targetTier"`
		DirtyPolicy        string   `json:"dirtyPolicy"`
		Title              string   `json:"title"`
		Goal               string   `json:"goal"`
		AcceptanceCriteria []string `json:"acceptanceCriteria"`
		OwnedPaths         []string `json:"ownedPaths"`
		AuthorProfileID    string   `json:"authorProfileId"`
		VerifierProfileID  string   `json:"verifierProfileId"`
	}
	_ = json.Unmarshal(raw, &req)
	replyErr := func(errMsg string) {
		_ = sendSessionMsg(ctx, sink, "chief.mission.upgrade.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "createdThreadId": nil, "error": errMsg,
		})
	}
	if s.chief == nil {
		replyErr("chief orchestration not initialized")
		return
	}
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, false)
	if actorErr != nil {
		replyErr(actorErr.Error())
		return
	}
	targetTier := strings.TrimSpace(req.TargetTier)
	if targetTier != chief.TierL1 && targetTier != chief.TierL2 {
		replyErr(fmt.Sprintf("invalid targetTier %q (expected L1 or L2)", req.TargetTier))
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	cfg, _, _ := chief.ParseRoutingConfig(s.store.LoadDaemonConfig())
	landing := cfg.Landing

	if soloID := strings.TrimSpace(req.SoloAgentID); soloID != "" {
		soloRec, err := s.store.GetAgent(soloID)
		if err != nil || soloRec == nil {
			replyErr(fmt.Sprintf("solo agent not found: %s", soloID))
			return
		}
		if soloRec.ArchivedAt != nil {
			replyErr(fmt.Sprintf("solo agent is archived: %s", soloID))
			return
		}
		chiefRec, chiefCreated, err := s.chief.findOrEnsureChiefAgent("", actorID)
		if err != nil {
			replyErr(err.Error())
			return
		}
		cleanupCreatedChief := func(cause error) error {
			if !chiefCreated {
				return cause
			}
			if err := s.store.DeleteAgent(chiefRec.ID); err != nil {
				return errors.Join(cause, fmt.Errorf("delete newly created Chief agent %s: %w", chiefRec.ID, err))
			}
			return cause
		}
		projectID, wsID, baseCwd, baseBranch, err := s.chief.resolveBaseTarget(ctx, "", soloRec.WorkspaceID, soloRec.Cwd, "", chiefRec)
		if err != nil {
			replyErr(cleanupCreatedChief(err).Error())
			return
		}
		_, authorProf, verifierProf, err := s.chief.resolveThreadProfiles(req.AuthorProfileID, req.VerifierProfileID, soloRec.Provider)
		if err != nil {
			replyErr(cleanupCreatedChief(err).Error())
			return
		}

		missionID := chief.NewID("mis")
		threadID := chief.NewID("thr")
		missionTitle := firstNonEmptyStr(req.Title, derefStr(soloRec.Title), "Upgraded mission")
		missionGoal := firstNonEmptyStr(req.Goal, missionTitle)

		mission := chief.Mission{
			ID:              missionID,
			Title:           missionTitle,
			Goal:            missionGoal,
			ChiefAgentID:    chiefRec.ID,
			ProjectID:       projectID,
			BaseWorkspaceID: wsID,
			BaseCwd:         baseCwd,
			BaseBranch:      baseBranch,
			Tier:            targetTier,
			Status:          chief.MissionStatusActive,
			Landing:         &landing,
			Threads:         []chief.Thread{},
			Cursors:         map[string]int64{},
			CreatedAt:       now,
			UpdatedAt:       now,
		}

		var l2Prep *l2WorktreePreparation
		if targetTier == chief.TierL1 {
			adoptedAuthor, err := s.chief.adoptExistingAuthor(soloRec.ID, missionID, threadID, chiefRec.ID)
			if err != nil {
				replyErr(cleanupCreatedChief(err).Error())
				return
			}
			verifierRec, err := s.chief.createWorkerRecord(missionID, threadID, chief.RoleVerifier, chiefRec.ID, wsID, baseCwd, missionTitle+" Verifier", verifierProf)
			if err != nil {
				replyErr(cleanupCreatedChief(err).Error())
				return
			}
			mission.Threads = []chief.Thread{{
				ID:                 threadID,
				MissionID:          missionID,
				Title:              missionTitle,
				Goal:               missionGoal,
				AcceptanceCriteria: nonNilSlice(req.AcceptanceCriteria),
				OwnedPaths:         nonNilPaths(req.OwnedPaths),
				WorkspaceID:        wsID,
				Cwd:                baseCwd,
				Branch:             baseBranch,
				BaseRef:            baseBranch,
				Isolation:          chief.IsolationNone,
				Status:             chief.ThreadStatusAuthoring,
				AuthorAgentID:      adoptedAuthor.ID,
				VerifierAgentID:    verifierRec.ID,
				AuthorProfileID:    authorProf.ID,
				VerifierProfileID:  verifierProf.ID,
				AuthorTier:         authorProf.Tier,
				VerifierTier:       verifierProf.Tier,
				LastProgressAt:     now,
				CreatedAt:          now,
				UpdatedAt:          now,
			}}
		} else {
			prep, prepErr := s.chief.prepareL2Worktree(ctx, baseCwd, "", missionTitle, req.DirtyPolicy)
			if prepErr != nil {
				replyErr(cleanupCreatedChief(prepErr).Error())
				return
			}
			l2Prep = prep
			if chiefCreated {
				prep.trackWorker(chiefRec.ID)
			}
			wtWs := prep.workspace
			authorRec, createErr := s.chief.createWorkerRecord(missionID, threadID, chief.RoleAuthor, chiefRec.ID, wtWs.WorkspaceID, wtWs.Cwd, missionTitle+" Author", authorProf)
			if createErr != nil {
				replyErr(l2Prep.abortWith(ctx, createErr).Error())
				return
			}
			prep.trackWorker(authorRec.ID)
			verifierRec, createErr := s.chief.createWorkerRecord(missionID, threadID, chief.RoleVerifier, chiefRec.ID, wtWs.WorkspaceID, wtWs.Cwd, missionTitle+" Verifier", verifierProf)
			if createErr != nil {
				replyErr(l2Prep.abortWith(ctx, createErr).Error())
				return
			}
			prep.trackWorker(verifierRec.ID)

			wtBranch := derefStr(wtWs.Branch)
			mission.Threads = []chief.Thread{{
				ID:                 threadID,
				MissionID:          missionID,
				Title:              missionTitle,
				Goal:               missionGoal,
				AcceptanceCriteria: nonNilSlice(req.AcceptanceCriteria),
				OwnedPaths:         nonNilPaths(req.OwnedPaths),
				WorkspaceID:        wtWs.WorkspaceID,
				Cwd:                wtWs.Cwd,
				Branch:             wtBranch,
				BaseRef:            baseBranch,
				Isolation:          chief.IsolationWorktree,
				Status:             chief.ThreadStatusAuthoring,
				AuthorAgentID:      authorRec.ID,
				VerifierAgentID:    verifierRec.ID,
				AuthorProfileID:    authorProf.ID,
				VerifierProfileID:  verifierProf.ID,
				AuthorTier:         authorProf.Tier,
				VerifierTier:       verifierProf.Tier,
				LastProgressAt:     now,
				CreatedAt:          now,
				UpdatedAt:          now,
			}}
		}

		created, err := s.chief.store.CreateMission(mission)
		if err != nil {
			if l2Prep != nil {
				replyErr(l2Prep.abortWith(ctx, err).Error())
			} else {
				replyErr(cleanupCreatedChief(err).Error())
			}
			return
		}
		if l2Prep != nil {
			if finalizeErr := l2Prep.commit(ctx); finalizeErr != nil {
				slog.Error("finalize committed L2 solo upgrade", "err", finalizeErr)
			}
			l2Prep.startSetup()
			if len(created.Threads) > 0 {
				var attachments []map[string]any
				if seedAtt := s.chief.seedContextFromAgent(*soloRec); seedAtt != nil {
					attachments = append(attachments, seedAtt)
				}
				if promptErr := s.chief.promptAgentWithText(ctx, created.Threads[0].AuthorAgentID, fmt.Sprintf("Mission %s Thread %s: %s", created.ID, threadID, missionGoal), attachments); promptErr != nil {
					slog.Error("prompt author after committed L2 solo upgrade", "err", promptErr)
				}
			}
		}
		_, _ = s.chief.store.AppendEvent(created.ID, chief.Event{
			Kind:         chief.EventMissionCreated,
			ActorAgentID: chiefStrPtr(firstNonEmptyStr(actorID, chiefRec.ID)),
			Summary:      chief.ClampSummary(fmt.Sprintf("Promoted solo agent %s to %s mission %s", soloID, targetTier, created.ID)),
			Ts:           now,
		})
		ev, _ := s.chief.store.AppendEvent(created.ID, chief.Event{
			ThreadID:     chiefStrPtr(threadID),
			Kind:         chief.EventTierUpgraded,
			ActorAgentID: chiefStrPtr(firstNonEmptyStr(actorID, chiefRec.ID)),
			Summary:      chief.ClampSummary(fmt.Sprintf("Upgraded solo agent %s to %s with thread %s", soloID, targetTier, threadID)),
			Ts:           now,
		})
		latest, _ := s.chief.store.GetMission(created.ID)
		if latest == nil {
			latest = &created
		}
		s.chief.broadcastMissionUpdate(latest, &ev)
		snap := s.chief.missionSnapshot(*latest)
		_ = sendSessionMsg(ctx, sink, "chief.mission.upgrade.response", map[string]any{
			"requestId":       req.RequestID,
			"mission":         &snap,
			"createdThreadId": &threadID,
			"error":           nil,
		})
		return
	}

	missionID := strings.TrimSpace(req.MissionID)
	if missionID == "" {
		replyErr("either missionId or soloAgentId is required")
		return
	}
	existing, err := s.chief.store.GetMission(missionID)
	if err != nil || existing == nil {
		replyErr(fmt.Sprintf("mission not found: %s", missionID))
		return
	}
	if existing.Tier == targetTier {
		snap := s.chief.missionSnapshot(*existing)
		_ = sendSessionMsg(ctx, sink, "chief.mission.upgrade.response", map[string]any{
			"requestId": req.RequestID, "mission": &snap, "createdThreadId": nil, "error": nil,
		})
		return
	}
	if tierOrder(targetTier) < tierOrder(existing.Tier) {
		replyErr(fmt.Sprintf("cannot downgrade mission from %s to %s", existing.Tier, targetTier))
		return
	}

	var createdThread *chief.Thread
	var l2Prep *l2WorktreePreparation
	var seedFrom *store.AgentRecord
	if targetTier == chief.TierL2 {
		threadTitle := firstNonEmptyStr(req.Title, existing.Title, "Thread 1")
		threadGoal := firstNonEmptyStr(req.Goal, existing.Goal, threadTitle)

		for _, th := range existing.Threads {
			if th.AuthorAgentID != "" {
				if rec, rErr := s.store.GetAgent(th.AuthorAgentID); rErr == nil && rec != nil {
					seedFrom = rec
					break
				}
			}
		}

		needThread := seedFrom != nil || strings.TrimSpace(req.Title) != "" || strings.TrimSpace(req.Goal) != ""
		if needThread {
			authorHint := ""
			if seedFrom != nil {
				authorHint = seedFrom.Provider
			}
			_, authorProf, verifierProf, pErr := s.chief.resolveThreadProfiles(req.AuthorProfileID, req.VerifierProfileID, authorHint)
			if pErr != nil {
				replyErr(pErr.Error())
				return
			}
			prep, prepErr := s.chief.prepareL2Worktree(ctx, existing.BaseCwd, "", threadTitle, req.DirtyPolicy)
			if prepErr != nil {
				replyErr(prepErr.Error())
				return
			}
			l2Prep = prep
			wtWs := prep.workspace
			threadID := chief.NewID("thr")
			authorRec, aErr := s.chief.createWorkerRecord(existing.ID, threadID, chief.RoleAuthor, existing.ChiefAgentID, wtWs.WorkspaceID, wtWs.Cwd, threadTitle+" Author", authorProf)
			if aErr != nil {
				replyErr(l2Prep.abortWith(ctx, aErr).Error())
				return
			}
			prep.trackWorker(authorRec.ID)
			verifierRec, vErr := s.chief.createWorkerRecord(existing.ID, threadID, chief.RoleVerifier, existing.ChiefAgentID, wtWs.WorkspaceID, wtWs.Cwd, threadTitle+" Verifier", verifierProf)
			if vErr != nil {
				replyErr(l2Prep.abortWith(ctx, vErr).Error())
				return
			}
			prep.trackWorker(verifierRec.ID)
			createdThread = &chief.Thread{
				ID:                 threadID,
				MissionID:          existing.ID,
				Title:              threadTitle,
				Goal:               threadGoal,
				AcceptanceCriteria: nonNilSlice(req.AcceptanceCriteria),
				OwnedPaths:         nonNilPaths(req.OwnedPaths),
				WorkspaceID:        wtWs.WorkspaceID,
				Cwd:                wtWs.Cwd,
				Branch:             derefStr(wtWs.Branch),
				BaseRef:            existing.BaseBranch,
				Isolation:          chief.IsolationWorktree,
				Status:             chief.ThreadStatusAuthoring,
				AuthorAgentID:      authorRec.ID,
				VerifierAgentID:    verifierRec.ID,
				AuthorProfileID:    authorProf.ID,
				VerifierProfileID:  verifierProf.ID,
				AuthorTier:         authorProf.Tier,
				VerifierTier:       verifierProf.Tier,
				LastProgressAt:     now,
				CreatedAt:          now,
				UpdatedAt:          now,
			}
		}
	}

	prevTier := existing.Tier
	updated, err := s.chief.store.UpdateMission(existing.ID, func(m *chief.Mission) error {
		m.Tier = targetTier
		if createdThread != nil {
			m.Threads = append(m.Threads, *createdThread)
		}
		m.UpdatedAt = now
		return nil
	})
	if err != nil {
		replyErr(l2Prep.abortWith(ctx, err).Error())
		return
	}
	if l2Prep != nil {
		if finalizeErr := l2Prep.commit(ctx); finalizeErr != nil {
			slog.Error("finalize committed L2 mission upgrade", "missionId", updated.ID, "err", finalizeErr)
		}
		l2Prep.startSetup()
		if createdThread != nil {
			var attachments []map[string]any
			if seedFrom != nil {
				if seedAtt := s.chief.seedContextFromAgent(*seedFrom); seedAtt != nil {
					attachments = append(attachments, seedAtt)
				}
			}
			if len(attachments) > 0 || strings.TrimSpace(req.Goal) != "" {
				if promptErr := s.chief.promptAgentWithText(ctx, createdThread.AuthorAgentID, fmt.Sprintf("Mission %s Thread %s: %s", updated.ID, createdThread.ID, createdThread.Goal), attachments); promptErr != nil {
					slog.Error("prompt author after committed L2 mission upgrade", "missionId", updated.ID, "err", promptErr)
				}
			}
		}
	}
	var createdTID *string
	if createdThread != nil {
		createdTID = &createdThread.ID
	}
	ev, _ := s.chief.store.AppendEvent(updated.ID, chief.Event{
		ThreadID:     createdTID,
		Kind:         chief.EventTierUpgraded,
		ActorAgentID: chiefStrPtr(firstNonEmptyStr(actorID, updated.ChiefAgentID)),
		Summary:      chief.ClampSummary(fmt.Sprintf("Upgraded mission %s from %s to %s", updated.ID, prevTier, targetTier)),
		Ts:           now,
	})
	latest, _ := s.chief.store.GetMission(updated.ID)
	if latest != nil {
		updated = latest
	}
	s.chief.broadcastMissionUpdate(updated, &ev)
	snap := s.chief.missionSnapshot(*updated)
	_ = sendSessionMsg(ctx, sink, "chief.mission.upgrade.response", map[string]any{
		"requestId":       req.RequestID,
		"mission":         &snap,
		"createdThreadId": createdTID,
		"error":           nil,
	})
}

func tierOrder(tier string) int {
	switch tier {
	case chief.TierL0:
		return 0
	case chief.TierL1:
		return 1
	case chief.TierL2:
		return 2
	default:
		return -1
	}
}

func (s *Server) handleChiefMissionResolveDecision(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID  string `json:"requestId"`
		MissionID  string `json:"missionId"`
		DecisionID string `json:"decisionId"`
		OptionID   string `json:"optionId"`
		Note       string `json:"note"`
	}
	_ = json.Unmarshal(raw, &req)
	replyErr := func(errMsg string) {
		_ = sendSessionMsg(ctx, sink, "chief.mission.resolve_decision.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "error": errMsg,
		})
	}
	if s.chief == nil {
		replyErr("chief orchestration not initialized")
		return
	}
	optionID := strings.TrimSpace(req.OptionID)
	if optionID == "" {
		replyErr("optionId is required")
		return
	}
	s.mu.Lock()
	_, agentBound := s.sinkAgentIDs[sink]
	s.mu.Unlock()
	if agentBound || !s.authorizationForSink(sink).Has("access.manage") {
		replyErr("trusted operator required to resolve mission decisions")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var chiefAgentID, resolvedSummary, landingDecisionID, landingThreadID string
	var landingStrategy, landingCommitMessage string
	updated, err := s.chief.store.UpdateMission(strings.TrimSpace(req.MissionID), func(m *chief.Mission) error {
		if m.PendingDecision == nil || m.PendingDecision.ResolvedAt != nil {
			return errors.New("mission has no pending decision")
		}
		if dID := strings.TrimSpace(req.DecisionID); dID != "" && m.PendingDecision.ID != dID {
			return fmt.Errorf("decision id mismatch: expected %s, got %s", m.PendingDecision.ID, dID)
		}
		if len(m.PendingDecision.Options) > 0 {
			valid := false
			for _, opt := range m.PendingDecision.Options {
				if opt.ID == optionID {
					valid = true
					break
				}
			}
			if !valid {
				return fmt.Errorf("unknown decision option %q", optionID)
			}
		}
		if m.PendingDecision.Kind == chief.LandingDecisionKind {
			landingDecisionID = m.PendingDecision.ID
			landingThreadID = derefStr(m.PendingDecision.ThreadID)
			landingStrategy = m.PendingDecision.LandingStrategy
			landingCommitMessage = m.PendingDecision.LandingCommitMessage
		}
		m.PendingDecision.ResolvedAt = &now
		m.PendingDecision.SelectedOptionID = &optionID
		m.PendingDecision.ResolutionNote = chiefStrPtr(req.Note)
		if m.Status == chief.MissionStatusWaitingHuman {
			m.Status = chief.MissionStatusActive
		}
		if m.SystemAttention != nil && m.SystemAttention.ResolvedAt == nil && m.SystemAttention.Kind == chief.AttentionKindPermissionBlocked {
			m.SystemAttention.ResolvedAt = &now
		}
		if m.NotifiedIncidents != nil {
			delete(m.NotifiedIncidents, "\x00"+chief.IncidentDecisionRequested)
		}
		chiefAgentID = m.ChiefAgentID
		resolvedSummary = fmt.Sprintf("Decision %s resolved with option %q", m.PendingDecision.ID, optionID)
		if strings.TrimSpace(req.Note) != "" {
			resolvedSummary += ": " + strings.TrimSpace(req.Note)
		}
		m.UpdatedAt = now
		return nil
	})
	if err != nil {
		replyErr(err.Error())
		return
	}

	ev, _ := s.chief.store.AppendEvent(updated.ID, chief.Event{
		Kind:          chief.EventDecisionResolved,
		TargetAgentID: chiefStrPtr(chiefAgentID),
		Summary:       chief.ClampSummary(resolvedSummary),
		Payload:       map[string]any{"optionId": optionID, "note": req.Note},
		Ts:            now,
	})
	_ = s.chief.router.RingBell(ctx, updated.ID, chiefAgentID, "decision_resolved")
	s.chief.reconcileChiefPermissionAttention(updated.ID)

	var landErr error
	if landingThreadID != "" && optionID == chief.LandingOptionApprove {
		if landingCommitMessage == "" {
			// Legacy decisions predate frozen landing inputs; new decisions always keep their saved message.
			landingCommitMessage = chiefLandingCommitMessage(landingThreadID, "")
		}
		var result *chief.LandThreadResult
		result, landErr = s.chief.landing.LandThread(ctx, chief.LandThreadInput{
			MissionID:     updated.ID,
			ThreadID:      landingThreadID,
			Strategy:      landingStrategy,
			CommitMessage: landingCommitMessage,
			Approval:      chief.NewTrustedHumanApproval(),
		})
		if result != nil && result.Mission != nil {
			updated = result.Mission
		}
		if landErr != nil {
			landingFailure := landErr.Error()
			persisted, persistErr := s.chief.store.UpdateMission(updated.ID, func(m *chief.Mission) error {
				decision := m.PendingDecision
				if decision == nil || decision.ID != landingDecisionID {
					return fmt.Errorf("landing decision %s is no longer current", landingDecisionID)
				}
				if decision.ResolvedAt == nil || decision.SelectedOptionID == nil || *decision.SelectedOptionID != chief.LandingOptionApprove {
					return fmt.Errorf("landing decision %s is no longer resolved as approved", landingDecisionID)
				}
				decision.LandingError = landingFailure
				return nil
			})
			if persistErr != nil {
				landErr = errors.Join(landErr, fmt.Errorf("persist landing outcome for decision %s: %w", landingDecisionID, persistErr))
			} else {
				updated = persisted
			}
		} else {
			updated, landErr = s.reconcileChiefReadyThreads(ctx, updated.ID)
		}
	}
	latest, _ := s.chief.store.GetMission(updated.ID)
	if latest != nil {
		updated = latest
	}
	s.chief.broadcastMissionUpdate(updated, &ev)
	snap := s.chief.missionSnapshot(*updated)
	var responseErr any
	if landErr != nil {
		responseErr = landErr.Error()
	}
	_ = sendSessionMsg(ctx, sink, "chief.mission.resolve_decision.response", map[string]any{
		"requestId": req.RequestID,
		"mission":   &snap,
		"error":     responseErr,
	})
}

func (s *Server) handleChiefThreadCreate(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID          string   `json:"requestId"`
		MissionID          string   `json:"missionId"`
		CallerAgentID      string   `json:"callerAgentId"`
		Title              string   `json:"title"`
		Goal               string   `json:"goal"`
		AcceptanceCriteria []string `json:"acceptanceCriteria"`
		OwnedPaths         []string `json:"ownedPaths"`
		Isolation          string   `json:"isolation"`
		BaseRef            string   `json:"baseRef"`
		Branch             string   `json:"branch"`
		AuthorProfileID    string   `json:"authorProfileId"`
		VerifierProfileID  string   `json:"verifierProfileId"`
		AuthorAgentID      string   `json:"authorAgentId"`
		InitialPrompt      string   `json:"initialPrompt"`
	}
	_ = json.Unmarshal(raw, &req)
	replyErr := func(errMsg string) {
		_ = sendSessionMsg(ctx, sink, "chief.thread.create.response", map[string]any{
			"requestId": req.RequestID, "mission": nil, "thread": nil, "error": errMsg,
		})
	}
	if s.chief == nil {
		replyErr("chief orchestration not initialized")
		return
	}
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, false)
	if actorErr != nil {
		replyErr(actorErr.Error())
		return
	}
	title := strings.TrimSpace(req.Title)
	goal := strings.TrimSpace(req.Goal)
	if title == "" || goal == "" {
		replyErr("title and goal are required")
		return
	}

	m, err := s.chief.store.GetMission(strings.TrimSpace(req.MissionID))
	if err != nil || m == nil {
		replyErr(fmt.Sprintf("mission not found: %s", req.MissionID))
		return
	}
	if m.Status == chief.MissionStatusCompleted || m.Status == chief.MissionStatusCanceled {
		replyErr(fmt.Sprintf("mission %s is %s", m.ID, m.Status))
		return
	}

	isolation := strings.TrimSpace(req.Isolation)
	if isolation == "" {
		if m.Tier == chief.TierL2 {
			isolation = chief.IsolationWorktree
		} else {
			isolation = chief.IsolationNone
		}
	}
	if isolation != chief.IsolationNone && isolation != chief.IsolationWorktree {
		replyErr(fmt.Sprintf("invalid isolation %q", isolation))
		return
	}

	authorHint := ""
	if aid := strings.TrimSpace(req.AuthorAgentID); aid != "" {
		if existingAuthor, aErr := s.store.GetAgent(aid); aErr == nil && existingAuthor != nil {
			authorHint = existingAuthor.Provider
		}
	}
	_, authorProf, verifierProf, pErr := s.chief.resolveThreadProfiles(req.AuthorProfileID, req.VerifierProfileID, authorHint)
	if pErr != nil {
		if errors.Is(pErr, chief.ErrVerifierTierBlocked) {
			now := time.Now().UTC().Format(time.RFC3339Nano)
			ev, _ := s.chief.store.AppendEvent(m.ID, chief.Event{
				Kind:    chief.EventVerifierTierBlocked,
				Summary: chief.ClampSummary(pErr.Error()),
				Ts:      now,
			})
			_, _ = s.chief.router.RaiseIncident(ctx, m.ID, "", chief.SystemAttention{
				Kind:     chief.AttentionKindVerifierTierBlocked,
				Severity: chief.SeverityFatal,
				Summary:  chief.ClampSummary(pErr.Error()),
				Since:    now,
			}, true)
			if latest, _ := s.chief.store.GetMission(m.ID); latest != nil {
				s.chief.broadcastMissionUpdate(latest, &ev)
			}
		}
		replyErr(pErr.Error())
		return
	}

	threadID := chief.NewID("thr")
	wsID := m.BaseWorkspaceID
	cwd := m.BaseCwd
	branch := firstNonEmptyStr(req.Branch, m.BaseBranch)
	baseRef := firstNonEmptyStr(req.BaseRef, m.BaseBranch)

	if isolation == chief.IsolationWorktree {
		slug := workspace.NormalizeWorktreeSlug(firstNonEmptyStr(req.Branch, title, threadID))
		intent := workspace.WorktreeIntentInput{
			WorktreeSlug: slug,
			BranchName:   strings.TrimSpace(req.Branch),
			RefName:      baseRef,
		}
		if intent.RefName != "" {
			intent.Action = "branch-off"
		}
		wtWs, _, wtErr := s.createWorktreeWorkspace(ctx, m.BaseCwd, &title, intent, nil)
		if wtErr != nil {
			replyErr(wtErr.Error())
			return
		}
		wsID = wtWs.WorkspaceID
		cwd = wtWs.Cwd
		branch = derefStr(wtWs.Branch)
	}

	var authorRec store.AgentRecord
	if aid := strings.TrimSpace(req.AuthorAgentID); aid != "" {
		adopted, aErr := s.chief.adoptExistingAuthor(aid, m.ID, threadID, m.ChiefAgentID)
		if aErr != nil {
			replyErr(aErr.Error())
			return
		}
		authorRec = adopted
	} else {
		createdAuthor, aErr := s.chief.createWorkerRecord(m.ID, threadID, chief.RoleAuthor, m.ChiefAgentID, wsID, cwd, title+" Author", authorProf)
		if aErr != nil {
			replyErr(aErr.Error())
			return
		}
		authorRec = createdAuthor
	}

	verifierRec, vErr := s.chief.createWorkerRecord(m.ID, threadID, chief.RoleVerifier, m.ChiefAgentID, wsID, cwd, title+" Verifier", verifierProf)
	if vErr != nil {
		replyErr(vErr.Error())
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	th := chief.Thread{
		ID:                 threadID,
		MissionID:          m.ID,
		Title:              title,
		Goal:               goal,
		AcceptanceCriteria: nonNilSlice(req.AcceptanceCriteria),
		OwnedPaths:         nonNilPaths(req.OwnedPaths),
		WorkspaceID:        wsID,
		Cwd:                cwd,
		Branch:             branch,
		BaseRef:            baseRef,
		Isolation:          isolation,
		Status:             chief.ThreadStatusAuthoring,
		AuthorAgentID:      authorRec.ID,
		VerifierAgentID:    verifierRec.ID,
		AuthorProfileID:    authorProf.ID,
		VerifierProfileID:  verifierProf.ID,
		AuthorTier:         authorProf.Tier,
		VerifierTier:       verifierProf.Tier,
		LastProgressAt:     now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	updated, uErr := s.chief.store.UpdateMission(m.ID, func(cur *chief.Mission) error {
		cur.Threads = append(cur.Threads, th)
		cur.UpdatedAt = now
		return nil
	})
	if uErr != nil {
		replyErr(uErr.Error())
		return
	}
	ev, _ := s.chief.store.AppendEvent(m.ID, chief.Event{
		ThreadID:      chiefStrPtr(th.ID),
		Kind:          chief.EventThreadCreated,
		ActorAgentID:  chiefStrPtr(firstNonEmptyStr(actorID, m.ChiefAgentID)),
		TargetAgentID: chiefStrPtr(authorRec.ID),
		Summary:       chief.ClampSummary(fmt.Sprintf("Created %s thread %s (%s)", isolation, th.Title, th.ID)),
		Ts:            now,
	})

	if initPrompt := strings.TrimSpace(req.InitialPrompt); initPrompt != "" {
		if pErr := s.chief.promptAgentWithText(ctx, authorRec.ID, initPrompt, nil); pErr != nil {
			replyErr(pErr.Error())
			return
		}
	}

	latest, _ := s.chief.store.GetMission(m.ID)
	if latest != nil {
		updated = latest
	}
	s.chief.broadcastMissionUpdate(updated, &ev)
	snap := s.chief.missionSnapshot(*updated)
	var thSnap *chief.ThreadSnapshot
	for i := range snap.Threads {
		if snap.Threads[i].ID == th.ID {
			cp := snap.Threads[i]
			thSnap = &cp
			break
		}
	}
	_ = sendSessionMsg(ctx, sink, "chief.thread.create.response", map[string]any{
		"requestId": req.RequestID,
		"mission":   &snap,
		"thread":    thSnap,
		"error":     nil,
	})
}

func (s *Server) handleChiefThreadSubmit(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string   `json:"requestId"`
		ThreadID      string   `json:"threadId"`
		MissionID     string   `json:"missionId"`
		CallerAgentID string   `json:"callerAgentId"`
		ChangedFiles  []string `json:"changedFiles"`
		Summary       string   `json:"summary"`
		Tests         string   `json:"tests"`
		CommitSha     string   `json:"commitSha"`
	}
	_ = json.Unmarshal(raw, &req)
	replyErr := func(errMsg string, violations []string, thSnap *chief.ThreadSnapshot) {
		if len(violations) > 0 {
			_ = sendSessionMsg(ctx, sink, "chief.thread.submit.response", map[string]any{
				"requestId":           req.RequestID,
				"accepted":            false,
				"thread":              thSnap,
				"ownershipViolations": violations,
				"error":               errMsg,
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "chief.thread.submit.response", map[string]any{
			"requestId": req.RequestID,
			"accepted":  false,
			"thread":    thSnap,
			"error":     errMsg,
		})
	}
	if s.chief == nil {
		replyErr("chief orchestration not initialized", nil, nil)
		return
	}
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, true)
	if actorErr != nil {
		replyErr(actorErr.Error(), nil, nil)
		return
	}

	m := s.chiefMissionForThread(req.MissionID, req.ThreadID)
	var changedFiles []string
	var changeErr error
	if m != nil {
		for _, th := range m.Threads {
			if th.ID == req.ThreadID {
				changedFiles, changeErr = authoritativeThreadChangedFiles(ctx, th)
				break
			}
		}
	}
	if changeErr != nil {
		var ownErr *chief.OwnershipError
		if errors.As(changeErr, &ownErr) {
			replyErr(ownErr.Error(), ownErr.Violations, nil)
			return
		}
		replyErr(changeErr.Error(), nil, nil)
		return
	}

	updated, err := s.chief.router.SubmitThread(ctx, chief.SubmitThreadInput{
		MissionID:    req.MissionID,
		ThreadID:     req.ThreadID,
		ActorAgentID: actorID,
		Summary:      req.Summary,
		Tests:        req.Tests,
		CommitSha:    req.CommitSha,
		ChangedFiles: changedFiles,
	})
	var thSnap *chief.ThreadSnapshot
	lookupMission := updated
	if lookupMission == nil {
		if strings.TrimSpace(req.MissionID) != "" {
			lookupMission, _ = s.chief.store.GetMission(strings.TrimSpace(req.MissionID))
		} else {
			lookupMission, _ = s.chief.store.FindMissionByThread(strings.TrimSpace(req.ThreadID))
		}
	}
	if lookupMission != nil {
		snap := s.chief.missionSnapshot(*lookupMission)
		for i := range snap.Threads {
			if snap.Threads[i].ID == req.ThreadID {
				cp := snap.Threads[i]
				thSnap = &cp
				break
			}
		}
	}

	if err != nil {
		if lookupMission != nil {
			s.chief.broadcastMissionUpdate(lookupMission, nil)
		}
		var ownErr *chief.OwnershipError
		if errors.As(err, &ownErr) {
			replyErr(ownErr.Error(), ownErr.Violations, thSnap)
			return
		}
		replyErr(err.Error(), nil, thSnap)
		return
	}

	s.chief.broadcastMissionUpdate(updated, nil)
	_ = sendSessionMsg(ctx, sink, "chief.thread.submit.response", map[string]any{
		"requestId": req.RequestID,
		"accepted":  true,
		"thread":    thSnap,
		"error":     nil,
	})
}

func (s *Server) handleChiefThreadVerdict(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID       string   `json:"requestId"`
		ThreadID        string   `json:"threadId"`
		MissionID       string   `json:"missionId"`
		CallerAgentID   string   `json:"callerAgentId"`
		Outcome         string   `json:"outcome"`
		Summary         string   `json:"summary"`
		Issues          []string `json:"issues"`
		CheckedCommands []string `json:"checkedCommands"`
	}
	_ = json.Unmarshal(raw, &req)
	replyErr := func(errMsg string, escalated bool, thSnap *chief.ThreadSnapshot) {
		_ = sendSessionMsg(ctx, sink, "chief.thread.verdict.response", map[string]any{
			"requestId":        req.RequestID,
			"accepted":         false,
			"escalatedToChief": escalated,
			"thread":           thSnap,
			"error":            errMsg,
		})
	}
	if s.chief == nil {
		replyErr("chief orchestration not initialized", false, nil)
		return
	}
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, true)
	if actorErr != nil {
		replyErr(actorErr.Error(), false, nil)
		return
	}

	var preMission *chief.Mission
	if strings.TrimSpace(req.MissionID) != "" {
		preMission, _ = s.chief.store.GetMission(strings.TrimSpace(req.MissionID))
	} else {
		preMission, _ = s.chief.store.FindMissionByThread(strings.TrimSpace(req.ThreadID))
	}
	if preMission == nil {
		replyErr(fmt.Sprintf("thread not found: %s", req.ThreadID), false, nil)
		return
	}
	var targetThread *chief.Thread
	for i := range preMission.Threads {
		if preMission.Threads[i].ID == req.ThreadID {
			targetThread = &preMission.Threads[i]
			break
		}
	}
	if targetThread == nil {
		replyErr(fmt.Sprintf("thread not found: %s", req.ThreadID), false, nil)
		return
	}

	verifierID := firstNonEmptyStr(actorID, targetThread.VerifierAgentID)
	mutated, details := s.chief.evaluateVerifierMutation(ctx, verifierID, targetThread.Cwd)

	updated, err := s.chief.router.RecordVerdict(ctx, chief.VerdictInput{
		MissionID:       preMission.ID,
		ThreadID:        req.ThreadID,
		ActorAgentID:    actorID,
		Outcome:         req.Outcome,
		Summary:         req.Summary,
		Issues:          req.Issues,
		CheckedCommands: req.CheckedCommands,
		VerifierMutated: mutated,
		MutationDetails: details,
	})
	if err != nil {
		replyErr(err.Error(), false, nil)
		return
	}

	s.chief.mu.Lock()
	if base := s.chief.verifierBaselines[verifierID]; base != nil {
		if mutated {
			base.reported = true
		} else {
			base.verdictClean = true
		}
	}
	s.chief.mu.Unlock()

	var readyErr error
	if !mutated && strings.EqualFold(strings.TrimSpace(req.Outcome), "pass") {
		reconciled, err := s.reconcileChiefReadyThreads(ctx, updated.ID)
		readyErr = err
		if reconciled != nil {
			updated = reconciled
		}
	}

	s.chief.broadcastMissionUpdate(updated, nil)
	snap := s.chief.missionSnapshot(*updated)
	var thSnap *chief.ThreadSnapshot
	var escalated bool
	for i := range snap.Threads {
		if snap.Threads[i].ID == req.ThreadID {
			cp := snap.Threads[i]
			thSnap = &cp
			if mutated || (strings.EqualFold(strings.TrimSpace(req.Outcome), "reject") && cp.VerifyRejectCount >= 2) {
				escalated = true
			}
			break
		}
	}

	if mutated {
		replyErr("verifier violated read-only contract: "+details, true, thSnap)
		return
	}
	if readyErr != nil {
		replyErr(readyErr.Error(), false, thSnap)
		return
	}
	_ = sendSessionMsg(ctx, sink, "chief.thread.verdict.response", map[string]any{
		"requestId":        req.RequestID,
		"accepted":         true,
		"escalatedToChief": escalated,
		"thread":           thSnap,
		"error":            nil,
	})
}

func nonNilSlice(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if t := strings.TrimSpace(s); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func nonNilPaths(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(in))
	for _, path := range in {
		if path != "" {
			out = append(out, path)
		}
	}
	return out
}

func firstNonEmptyStr(values ...string) string {
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func chiefStrPtr(v string) *string {
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
