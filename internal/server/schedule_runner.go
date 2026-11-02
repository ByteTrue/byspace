package server

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"

	agentmode "github.com/ByteTrue/byspace/internal/agent/mode"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	agenttitle "github.com/ByteTrue/byspace/internal/agent/title"
	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// The schedule runner: what one fire of a schedule does. Ported from executeSchedule in the archived
// Node daemon's schedule/service.ts and the workspace hooks bootstrap.ts gives it.
//
//   - A heartbeat (agent target) sends the prompt to that agent as a system notification and waits
//     for the turn.
//   - A new-agent schedule creates a fresh workspace for every run — a new workspace on the directory
//     (local isolation) or a new BySpace worktree — starts an agent there with the schedule's
//     provider, model, mode and thinking, runs the prompt, and archives that run's workspace when it
//     is done (unless the schedule keeps it). The project's own workspaces are never touched.

// scheduleHooks connects the schedule service to this daemon.
func (s *Server) scheduleHooks() schedule.Hooks {
	return schedule.Hooks{
		Execute: s.executeScheduledRun,
		AgentLive: func(agentID string) bool {
			record, err := s.store.GetAgent(agentID)
			return err == nil && record != nil && record.ArchivedAt == nil
		},
		ArchiveWorkspace: func(workspaceID string) error {
			s.archiveWorkspaces(context.Background(), []string{workspaceID}, time.Now().UTC().Format(time.RFC3339Nano))
			return nil
		},
		Logf: func(format string, args ...any) {
			fmt.Fprintf(os.Stderr, format+"\n", args...)
		},
	}
}

// noteAgentArchived ends the heartbeats that target an agent once it is archived: they can never
// fire again. Node does this from the agent manager's archived callback.
func (s *Server) noteAgentArchived(agentID string) {
	if s.schedules == nil || strings.TrimSpace(agentID) == "" {
		return
	}
	go func() {
		if _, err := s.schedules.CompleteForAgent(agentID); err != nil {
			fmt.Fprintf(os.Stderr, "failed to complete schedules for archived agent %s: %v\n", agentID, err)
		}
	}()
}

func (s *Server) executeScheduledRun(ctx context.Context, sched schedule.StoredSchedule, run schedule.RunHandle) (schedule.ExecutionResult, error) {
	if sched.Target.Type == "agent" {
		return s.executeHeartbeatRun(ctx, sched, run)
	}
	config := sched.Target.Config
	if sched.Target.Type != "new-agent" || config == nil {
		return schedule.ExecutionResult{}, fmt.Errorf("Schedule %s target changed during execution", sched.ID)
	}
	if err := assertScheduleCwdDirectory(config.Cwd); err != nil {
		return schedule.ExecutionResult{}, err
	}

	var ws *store.WorkspaceRecord
	var agentID *string
	defer func() {
		if ws == nil || !schedule.ShouldArchiveRunWorkspace(agentID, config.ArchiveOnFinish) {
			return
		}
		// The run's own workspace, never the project's: the run created it, and it goes once the run
		// is over unless the schedule asked to keep it for inspection.
		s.archiveWorkspaces(context.Background(), []string{ws.WorkspaceID}, time.Now().UTC().Format(time.RFC3339Nano))
	}()

	created, err := s.createScheduleRunWorkspace(ctx, *config, sched.Prompt)
	if err != nil {
		return schedule.ExecutionResult{}, err
	}
	ws = &created
	run.RecordWorkspace(ws.WorkspaceID, nil)

	mp, err := s.startScheduledAgent(sched, run.ID, *config, *ws)
	if err != nil {
		return schedule.ExecutionResult{}, err
	}
	id := mp.record.ID
	agentID = &id
	run.RecordWorkspace(ws.WorkspaceID, agentID)

	canceled, err := s.runScheduledTurn(ctx, mp, sched.Prompt)
	if err != nil {
		return schedule.ExecutionResult{}, err
	}
	if canceled {
		return schedule.ExecutionResult{}, fmt.Errorf("Scheduled agent %s was canceled", id)
	}
	if err := s.scheduledTurnError(mp); err != nil {
		return schedule.ExecutionResult{}, err
	}
	items := make([]sdk.TimelineItem, 0, len(mp.session.Timeline()))
	for _, entry := range mp.session.Timeline() {
		items = append(items, entry.Item)
	}
	return schedule.ExecutionResult{
		AgentID: agentID,
		Output:  scheduledRunOutput(mp.session.LastAssistantText(), items),
	}, nil
}

// executeHeartbeatRun prompts the schedule's agent with the fire notice and waits for the turn.
func (s *Server) executeHeartbeatRun(ctx context.Context, sched schedule.StoredSchedule, run schedule.RunHandle) (schedule.ExecutionResult, error) {
	agentID := sched.Target.AgentID
	record, err := s.store.GetAgent(agentID)
	if err != nil || record == nil {
		return schedule.ExecutionResult{}, schedule.TargetGoneError{Reason: fmt.Sprintf("Agent %s no longer exists", agentID)}
	}
	if record.ArchivedAt != nil {
		return schedule.ExecutionResult{}, schedule.TargetGoneError{Reason: fmt.Sprintf("Agent %s is archived", agentID)}
	}
	mp, err := s.ensureAgentLoaded(agentID)
	if err != nil {
		return schedule.ExecutionResult{}, err
	}
	if turnID, _ := mp.session.ActiveTurn(); turnID != "" || mp.session.Status() == "running" {
		return schedule.ExecutionResult{}, fmt.Errorf("Agent %s already has an active run", agentID)
	}
	prompt := sdk.FormatSystemNotificationPrompt(scheduleFireBody(sched, run.ID))
	if _, err := s.runScheduledTurn(ctx, mp, prompt); err != nil {
		return schedule.ExecutionResult{}, err
	}
	if err := s.scheduledTurnError(mp); err != nil {
		return schedule.ExecutionResult{}, err
	}
	var output *string
	if last := strings.TrimSpace(mp.session.LastAssistantText()); last != "" {
		output = &last
	}
	return schedule.ExecutionResult{AgentID: &agentID, Output: output}, nil
}

// scheduleFireBody is what a heartbeat's agent reads: which schedule fired, then its prompt.
func scheduleFireBody(sched schedule.StoredSchedule, runID string) string {
	heading := fmt.Sprintf("Schedule fired (id=%s, run=%s).", sched.ID, runID)
	if sched.Name != nil && strings.TrimSpace(*sched.Name) != "" {
		heading = fmt.Sprintf("Schedule %q fired (id=%s, run=%s).", *sched.Name, sched.ID, runID)
	}
	return heading + "\n" + sched.Prompt
}

// assertScheduleCwdDirectory refuses a run whose directory is gone: permanent, so the schedule ends.
func assertScheduleCwdDirectory(cwd string) error {
	info, err := os.Stat(cwd)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return schedule.TargetGoneError{Reason: fmt.Sprintf("Working directory %s no longer exists", cwd)}
		}
		return err
	}
	if !info.IsDir() {
		return schedule.TargetGoneError{Reason: fmt.Sprintf("Working directory %s is not a directory", cwd)}
	}
	return nil
}

// createScheduleRunWorkspace creates the workspace one run works in.
func (s *Server) createScheduleRunWorkspace(ctx context.Context, config schedule.TargetConfig, prompt string) (store.WorkspaceRecord, error) {
	firstAgentContext := map[string]any{"prompt": prompt}
	if config.Isolation == "worktree" {
		ws, _, err := s.createWorktreeWorkspace(ctx, config.Cwd, nil, workspace.WorktreeIntentInput{}, firstAgentContext)
		if err != nil {
			return store.WorkspaceRecord{}, err
		}
		s.scheduleWorkspaceAutoName(ws.WorkspaceID, ws.Cwd, prompt)
		return ws, nil
	}
	prj, ws, err := s.store.CreateWorkspaceForDirectory(config.Cwd, workspaceCreateTitle(nil, firstAgentContext), "")
	if err != nil {
		return store.WorkspaceRecord{}, err
	}
	s.adoptWorktreePlacement(ctx, &ws)
	s.announceProject(prj)
	s.broadcastWorkspaceUpsertStatus(ws, prj, createdWorkspaceStatusOverride(firstAgentContext))
	s.scheduleWorkspaceAutoName(ws.WorkspaceID, ws.Cwd, prompt)
	return ws, nil
}

// startScheduledAgent creates the run's agent with the schedule's config.
//
// Ported from the createAgent call in executeSchedule: the run is unattended (so with no mode named
// it starts in the provider's unattended mode), titled from the schedule, and labelled with the
// schedule and run it belongs to.
func (s *Server) startScheduledAgent(sched schedule.StoredSchedule, runID string, config schedule.TargetConfig, ws store.WorkspaceRecord) (*managedPi, error) {
	provider := strings.TrimSpace(config.Provider)
	var requestedMode *string
	if mode := strings.TrimSpace(config.ModeID); mode != "" {
		requestedMode = &mode
	}
	modeInput := s.agentModeInput(provider, requestedMode, nil)
	modeInput.Unattended = true
	resolvedMode, err := agentmode.Resolve(modeInput)
	if err != nil {
		return nil, err
	}

	var title *string
	titles := agenttitle.Resolve(derefOr(config.Title, ""), sched.Prompt)
	if titles.Explicit != "" {
		explicit := titles.Explicit
		title = &explicit
	} else if titles.Provisional != "" {
		provisional := titles.Provisional
		title = &provisional
	}
	optional := func(value string) *string {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return &trimmed
		}
		return nil
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	rec := store.AgentRecord{
		ID:          newAgentID(),
		Provider:    provider,
		Cwd:         ws.Cwd,
		WorkspaceID: ws.WorkspaceID,
		CreatedAt:   now,
		UpdatedAt:   now,
		Title:       title,
		Labels: map[string]string{
			"byspace.schedule-id":  sched.ID,
			"byspace.schedule-run": runID,
		},
		LastStatus: "idle",
		LastModeID: resolvedMode,
		Config: &store.AgentConfig{
			Model:            optional(config.Model),
			ThinkingOptionID: optional(config.ThinkingOptionID),
			ModeID:           resolvedMode,
			SystemPrompt:     config.SystemPrompt,
			ProviderOptions:  config.ProviderOptions,
			FeatureValues:    config.FeatureValues,
		},
	}
	mp, err := s.startOrGetPiAgent(rec)
	if err != nil {
		return nil, err
	}
	if err := s.store.UpsertAgent(mp.record); err != nil {
		return nil, err
	}
	s.broadcastAgentUpdate(mp.record)
	return mp, nil
}

// runScheduledTurn submits a prompt the way a user message is submitted and waits for the turn to
// end. It reports whether the turn was canceled.
func (s *Server) runScheduledTurn(ctx context.Context, mp *managedPi, text string) (bool, error) {
	var canceled atomic.Bool
	unsubscribe := mp.session.OnEvent(func(ev map[string]any) {
		if eventType, _ := ev["type"].(string); eventType == "byspace_turn_canceled" {
			canceled.Store(true)
		}
	})
	defer unsubscribe()

	stampedAt := time.Now().UTC().Format(time.RFC3339Nano)
	s.mu.Lock()
	mp.record.UpdatedAt = stampedAt
	mp.record.LastUserMessageAt = &stampedAt
	record := mp.record
	s.mu.Unlock()
	_ = s.store.UpsertAgent(record)

	clientMessageID := newMessageID()
	mp.session.SetNextClientMessageID(clientMessageID)
	if err := mp.session.Prompt(ctx, text, nil); err != nil {
		return false, err
	}
	s.appendSubmittedPromptRow(record, mp.session, clientMessageID, text)
	if err := s.waitForRunStart(ctx, record.ID, record.Provider); err != nil {
		return false, err
	}
	s.mu.Lock()
	mp.record.LastStatus = resolveAgentStatus(mp.record.LastStatus, mp.session.Status())
	record = mp.record
	s.mu.Unlock()
	_ = s.store.UpsertAgent(record)

	if err := mp.session.WaitForFinish(ctx); err != nil {
		return false, err
	}
	return canceled.Load(), nil
}

// scheduledTurnError is the failure a finished scheduled turn reports: parked on a permission, or
// ended in error.
func (s *Server) scheduledTurnError(mp *managedPi) error {
	s.mu.Lock()
	mp.record.LastStatus = resolveAgentStatus(mp.record.LastStatus, mp.session.Status())
	status := mp.record.LastStatus
	agentID := mp.record.ID
	s.mu.Unlock()
	if len(mp.session.PendingPermissions()) > 0 {
		return fmt.Errorf("Scheduled agent %s is waiting for permission", agentID)
	}
	if status == "error" {
		if last := strings.TrimSpace(mp.session.LastAssistantText()); last != "" {
			return errors.New(last)
		}
		return fmt.Errorf("Scheduled agent %s failed", agentID)
	}
	return nil
}
