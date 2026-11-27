package chief

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// DefaultWatchdogInterval is the 15s Go ticker cadence for zero-LLM liveness supervision.
const DefaultWatchdogInterval = 15 * time.Second

// AgentWatchSnapshot describes a bound agent's live runtime state for Watchdog inspection.
type AgentWatchSnapshot struct {
	Loaded               bool
	SessionStatus        string // Live mp.session.Status() when Loaded, or stored status otherwise.
	RecordStatus         string // Persisted store.AgentRecord.LastStatus.
	HasPendingPermission bool
	LastError            string
}

// WatchdogHooks configure the Watchdog's probes, thresholds, and callbacks.
type WatchdogHooks struct {
	Store      *Store
	Router     *Router
	ProbeAgent func(agentID string) AgentWatchSnapshot
	// Thresholds returns the active soft/hard stall durations (e.g. from hot-reloaded daemon config).
	// Nil defaults to 600s soft / 1200s hard.
	Thresholds    func() (soft, hard time.Duration)
	Now           func() time.Time
	Interval      time.Duration
	OnDeadSession func(ctx context.Context, mission Mission, thread Thread, role, agentID string, snap AgentWatchSnapshot)
	OnSoftStall   func(ctx context.Context, mission Mission, thread Thread, role, agentID string, stalledFor time.Duration)
	OnHardStall   func(ctx context.Context, mission Mission, thread Thread, role, agentID string, stalledFor time.Duration)
}

// Watchdog runs deterministic 15s checks for dead sessions (`status=="closed"`) and
// zero-progress stalls (`600s` soft warning / `1200s` hard recovery) using zero LLM tokens.
type Watchdog struct {
	hooks WatchdogHooks

	startOnce sync.Once
	stopOnce  sync.Once
	stopCh    chan struct{}
	doneCh    chan struct{}
	startedMu sync.Mutex
	started   bool
}

// NewWatchdog creates a new Watchdog with 15s default tick and 600s/1200s defaults.
func NewWatchdog(hooks WatchdogHooks) *Watchdog {
	if hooks.Interval <= 0 {
		hooks.Interval = DefaultWatchdogInterval
	}
	if hooks.Now == nil {
		hooks.Now = func() time.Time { return time.Now().UTC() }
	}
	return &Watchdog{
		hooks:  hooks,
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
}

// Start launches the 15s ticker loop. Safe to call multiple times; only the first starts the loop.
func (w *Watchdog) Start() {
	w.startOnce.Do(func() {
		w.startedMu.Lock()
		w.started = true
		w.startedMu.Unlock()
		go w.loop()
	})
}

// Stop terminates the watchdog loop and waits for exit. Safe to call from Server.Close()
// even if Start() was never called or Stop() is called multiple times.
func (w *Watchdog) Stop() {
	w.stopOnce.Do(func() {
		close(w.stopCh)
	})
	w.startedMu.Lock()
	wasStarted := w.started
	w.startedMu.Unlock()
	if wasStarted {
		<-w.doneCh
	}
}

func (w *Watchdog) loop() {
	defer close(w.doneCh)
	ticker := time.NewTicker(w.hooks.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-w.stopCh:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			w.CheckOnce(ctx)
			cancel()
		}
	}
}

// CheckOnce performs one deterministic liveness and stall sweep across all active missions.
func (w *Watchdog) CheckOnce(ctx context.Context) {
	if w == nil || w.hooks.Store == nil || w.hooks.ProbeAgent == nil {
		return
	}
	missions, err := w.hooks.Store.ListMissions()
	if err != nil {
		return
	}
	softThreshold, hardThreshold := w.activeThresholds()
	now := w.hooks.Now().UTC()
	nowStr := now.Format(time.RFC3339Nano)

	for _, m := range missions {
		if m.Status != MissionStatusActive {
			continue
		}
		for _, th := range m.Threads {
			if !isWatchableThreadStatus(th.Status) {
				continue
			}
			for _, binding := range boundThreadAgents(th) {
				snap := w.hooks.ProbeAgent(binding.agentID)
				if isDeadSessionSnapshot(th, binding.role, snap) {
					w.handleDead(ctx, m, th, binding.role, binding.agentID, snap, nowStr)
					continue
				}
				if snap.SessionStatus != "running" || snap.HasPendingPermission {
					continue
				}
				lastProgress := parseWatchTimestamp(th.LastProgressAt, th.UpdatedAt, th.CreatedAt)
				if lastProgress.IsZero() {
					continue
				}
				stalledFor := now.Sub(lastProgress)
				if stalledFor >= hardThreshold && th.HardStallTriggeredAt == "" {
					w.handleHardStall(ctx, m, th, binding.role, binding.agentID, stalledFor, nowStr)
					continue
				}
				if stalledFor >= softThreshold && th.SoftStallWarnedAt == "" {
					w.handleSoftStall(ctx, m, th, binding.role, binding.agentID, stalledFor, nowStr)
				}
			}
		}
	}
}

func (w *Watchdog) activeThresholds() (time.Duration, time.Duration) {
	soft := time.Duration(DefaultSoftStallSeconds) * time.Second
	hard := time.Duration(DefaultHardStallSeconds) * time.Second
	if w.hooks.Thresholds != nil {
		s, h := w.hooks.Thresholds()
		if s > 0 {
			soft = s
		}
		if h > 0 {
			hard = h
		}
	}
	if hard < soft {
		hard = soft
	}
	return soft, hard
}

func (w *Watchdog) handleDead(ctx context.Context, m Mission, th Thread, role, agentID string, snap AgentWatchSnapshot, nowStr string) {
	summary := fmt.Sprintf("%s agent %s on thread %s exited unexpectedly (status=%s)", role, agentID, th.ID, snap.SessionStatus)
	if snap.LastError != "" {
		summary += ": " + snap.LastError
	}
	att := SystemAttention{
		Kind:     AttentionKindProcessCrash,
		Severity: SeverityFatal,
		Summary:  ClampSummary(summary),
		AgentID:  optStringPtr(agentID),
		ThreadID: optStringPtr(th.ID),
		Since:    nowStr,
	}
	if w.hooks.Router != nil {
		_, _ = w.hooks.Router.RaiseIncident(ctx, m.ID, th.ID, att, false)
	} else {
		_, _ = w.hooks.Store.UpdateMission(m.ID, func(cur *Mission) error {
			if target := findThread(cur, th.ID); target != nil {
				target.SystemAttention = &att
				target.UpdatedAt = nowStr
			}
			return nil
		})
	}
	if w.hooks.OnDeadSession != nil {
		w.hooks.OnDeadSession(ctx, m, th, role, agentID, snap)
	}
}

func (w *Watchdog) handleSoftStall(ctx context.Context, m Mission, th Thread, role, agentID string, stalledFor time.Duration, nowStr string) {
	_, _ = w.hooks.Store.UpdateMission(m.ID, func(cur *Mission) error {
		if target := findThread(cur, th.ID); target != nil {
			target.SoftStallWarnedAt = nowStr
			target.SystemAttention = &SystemAttention{
				Kind:     AttentionKindStall,
				Severity: SeverityWarning,
				Summary:  ClampSummary(fmt.Sprintf("%s agent %s stalled for %ds without stream/tool/usage progress", role, agentID, int(stalledFor.Seconds()))),
				AgentID:  optStringPtr(agentID),
				ThreadID: optStringPtr(th.ID),
				Since:    nowStr,
			}
			target.UpdatedAt = nowStr
		}
		return nil
	})
	if w.hooks.OnSoftStall != nil {
		w.hooks.OnSoftStall(ctx, m, th, role, agentID, stalledFor)
	}
}

func (w *Watchdog) handleHardStall(ctx context.Context, m Mission, th Thread, role, agentID string, stalledFor time.Duration, nowStr string) {
	att := SystemAttention{
		Kind:     AttentionKindStall,
		Severity: SeverityFatal,
		Summary:  ClampSummary(fmt.Sprintf("%s agent %s reached hard stall threshold (%ds) with zero progress", role, agentID, int(stalledFor.Seconds()))),
		AgentID:  optStringPtr(agentID),
		ThreadID: optStringPtr(th.ID),
		Since:    nowStr,
	}
	_, _ = w.hooks.Store.UpdateMission(m.ID, func(cur *Mission) error {
		if target := findThread(cur, th.ID); target != nil {
			if target.SoftStallWarnedAt == "" {
				target.SoftStallWarnedAt = nowStr
			}
			target.HardStallTriggeredAt = nowStr
			target.SystemAttention = &att
			target.UpdatedAt = nowStr
		}
		return nil
	})
	if w.hooks.OnHardStall != nil {
		w.hooks.OnHardStall(ctx, m, th, role, agentID, stalledFor)
	}
}

type roleBinding struct {
	role    string
	agentID string
}

func boundThreadAgents(th Thread) []roleBinding {
	var out []roleBinding
	switch th.Status {
	case ThreadStatusVerifying:
		if th.VerifierAgentID != "" {
			out = append(out, roleBinding{role: RoleVerifier, agentID: th.VerifierAgentID})
		}
	case ThreadStatusNeedsRebase:
		if th.IntegratorAgentID != "" {
			out = append(out, roleBinding{role: RoleIntegrator, agentID: th.IntegratorAgentID})
		} else if th.AuthorAgentID != "" {
			out = append(out, roleBinding{role: RoleAuthor, agentID: th.AuthorAgentID})
		}
	default:
		if th.AuthorAgentID != "" {
			out = append(out, roleBinding{role: RoleAuthor, agentID: th.AuthorAgentID})
		}
		if th.VerifierAgentID != "" && th.VerifierAgentID != th.AuthorAgentID {
			out = append(out, roleBinding{role: RoleVerifier, agentID: th.VerifierAgentID})
		}
	}
	return out
}

func isWatchableThreadStatus(status string) bool {
	switch status {
	case ThreadStatusAuthoring, ThreadStatusVerifying, ThreadStatusNeedsRebase, ThreadStatusMergeChecking:
		return true
	default:
		return false
	}
}

func isDeadSessionSnapshot(th Thread, role string, snap AgentWatchSnapshot) bool {
	if snap.Loaded && snap.SessionStatus == "closed" {
		return true
	}
	if !snap.Loaded && snap.RecordStatus == "running" {
		return true
	}
	if !snap.Loaded && snap.SessionStatus == "closed" {
		if (role == RoleAuthor && th.Status == ThreadStatusAuthoring) || (role == RoleVerifier && th.Status == ThreadStatusVerifying) {
			return true
		}
	}
	return false
}

func parseWatchTimestamp(candidates ...string) time.Time {
	for _, raw := range candidates {
		if raw == "" {
			continue
		}
		if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
			return t.UTC()
		}
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}
