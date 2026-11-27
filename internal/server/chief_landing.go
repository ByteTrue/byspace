package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func (b *chiefBridge) dryRunMerge(ctx context.Context, mission chief.Mission, thread chief.Thread) (chief.MergeDryRunResult, error) {
	checked, err := workspace.DryRunMerge(ctx, workspace.DryRunOptions{
		TargetCwd: mission.BaseCwd,
		TargetRef: mission.BaseBranch,
		SourceCwd: thread.Cwd,
		SourceRef: thread.Branch,
	})
	checkedAt := checked.CheckedAt
	if checkedAt.IsZero() {
		checkedAt = time.Now().UTC()
	}
	return chief.MergeDryRunResult{
		Clean:            checked.Clean,
		TargetRef:        checked.TargetRef,
		TargetSha:        chiefStrPtr(strings.TrimSpace(checked.TargetSha)),
		SourceRef:        checked.SourceRef,
		SourceSha:        chiefStrPtr(strings.TrimSpace(checked.SourceSha)),
		MergeTreeSha:     chiefStrPtr(strings.TrimSpace(checked.MergeTreeSha)),
		ConflictingFiles: append([]string(nil), checked.ConflictingFiles...),
		DirtyWorktree:    checked.DirtyWorktree,
		AheadCount:       checked.AheadCount,
		CheckedAt:        checkedAt.UTC().Format(time.RFC3339Nano),
	}, err
}

func (s *Server) chiefMissionForThread(missionID, threadID string) *chief.Mission {
	var m *chief.Mission
	if strings.TrimSpace(missionID) != "" {
		m, _ = s.chief.store.GetMission(strings.TrimSpace(missionID))
	} else {
		m, _ = s.chief.store.FindMissionByThread(strings.TrimSpace(threadID))
	}
	return m
}

func (s *Server) handleChiefThreadMergeCheck(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string `json:"requestId"`
		MissionID     string `json:"missionId"`
		ThreadID      string `json:"threadId"`
		CallerAgentID string `json:"callerAgentId"`
	}
	_ = json.Unmarshal(raw, &req)
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, false)
	if actorErr != nil {
		_ = sendSessionMsg(ctx, sink, "chief.thread.merge_check.response", map[string]any{
			"requestId": req.RequestID, "accepted": false, "mergeCheck": nil, "mission": nil, "error": actorErr.Error(),
		})
		return
	}
	var m *chief.Mission
	if s.chief != nil {
		m = s.chiefMissionForThread(req.MissionID, req.ThreadID)
	}
	if m == nil {
		_ = sendSessionMsg(ctx, sink, "chief.thread.merge_check.response", map[string]any{
			"requestId": req.RequestID, "accepted": false, "mergeCheck": nil, "mission": nil,
			"error": fmt.Sprintf("thread not found: %s", req.ThreadID),
		})
		return
	}
	updated, err := s.chief.landing.MergeCheck(ctx, m.ID, req.ThreadID, actorID)
	if updated == nil {
		updated = m
	}
	var check *chief.MergeDryRunResult
	for _, th := range updated.Threads {
		if th.ID == req.ThreadID {
			check = th.MergeCheck
			break
		}
	}
	snap := s.chief.missionSnapshot(*updated)
	var responseErr any
	if err != nil {
		responseErr = err.Error()
	}
	_ = sendSessionMsg(ctx, sink, "chief.thread.merge_check.response", map[string]any{
		"requestId": req.RequestID, "accepted": err == nil, "mergeCheck": check,
		"mission": &snap, "error": responseErr,
	})
}

func (s *Server) handleChiefThreadLand(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string `json:"requestId"`
		MissionID     string `json:"missionId"`
		ThreadID      string `json:"threadId"`
		CallerAgentID string `json:"callerAgentId"`
		Strategy      string `json:"strategy"`
		CommitMessage string `json:"commitMessage"`
	}
	_ = json.Unmarshal(raw, &req)
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, false)
	if actorErr != nil {
		_ = sendSessionMsg(ctx, sink, "chief.thread.land.response", map[string]any{
			"requestId": req.RequestID, "accepted": false, "approvalRequired": false, "mission": nil, "error": actorErr.Error(),
		})
		return
	}
	var m *chief.Mission
	if s.chief != nil {
		m = s.chiefMissionForThread(req.MissionID, req.ThreadID)
	}
	if m == nil {
		_ = sendSessionMsg(ctx, sink, "chief.thread.land.response", map[string]any{
			"requestId": req.RequestID, "accepted": false, "approvalRequired": false,
			"mission": nil, "error": fmt.Sprintf("thread not found: %s", req.ThreadID),
		})
		return
	}
	result, err := s.chief.landing.LandThread(ctx, chief.LandThreadInput{
		MissionID: m.ID, ThreadID: req.ThreadID, ActorAgentID: actorID,
		Strategy: req.Strategy, CommitMessage: chiefLandingCommitMessage(req.ThreadID, req.CommitMessage),
	})
	var updated *chief.Mission
	approvalRequired := false
	if result != nil {
		updated = result.Mission
		approvalRequired = result.ApprovalRequired
	}
	if err == nil && !approvalRequired {
		updated, err = s.reconcileChiefReadyThreads(ctx, m.ID)
	}
	if updated == nil {
		updated, _ = s.chief.store.GetMission(m.ID)
	}
	if updated == nil {
		updated = m
	}
	snap := s.chief.missionSnapshot(*updated)
	var responseErr any
	if err != nil {
		responseErr = err.Error()
	}
	s.chief.broadcastMissionUpdate(updated, nil)
	_ = sendSessionMsg(ctx, sink, "chief.thread.land.response", map[string]any{
		"requestId": req.RequestID, "accepted": err == nil && !approvalRequired, "approvalRequired": approvalRequired,
		"mission": &snap, "error": responseErr,
	})
}

func (s *Server) reconcileChiefReadyThreads(ctx context.Context, missionID string) (*chief.Mission, error) {
	for {
		m, err := s.chief.store.GetMission(missionID)
		if err != nil {
			return nil, err
		}
		if m.PendingDecision != nil && (m.PendingDecision.ResolvedAt == nil || strings.TrimSpace(m.PendingDecision.LandingError) != "") {
			return m, nil
		}
		ready := make([]chief.Thread, 0)
		for _, th := range m.Threads {
			if th.Status == chief.ThreadStatusReadyToLand {
				ready = append(ready, th)
			}
		}
		if len(ready) == 0 {
			return m, nil
		}
		sort.Slice(ready, func(i, j int) bool { return ready[i].ID < ready[j].ID })
		result, err := s.chief.landing.LandThread(ctx, chief.LandThreadInput{
			MissionID: missionID, ThreadID: ready[0].ID, CommitMessage: chiefLandingCommitMessage(ready[0].ID, ""),
		})
		if err != nil {
			if result != nil && result.Mission != nil {
				return result.Mission, err
			}
			latest, _ := s.chief.store.GetMission(missionID)
			if latest != nil {
				return latest, err
			}
			return m, err
		}
		if result.ApprovalRequired {
			return result.Mission, nil
		}
	}
}

func (s *Server) handleChiefThreadCancel(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string `json:"requestId"`
		MissionID     string `json:"missionId"`
		ThreadID      string `json:"threadId"`
		CallerAgentID string `json:"callerAgentId"`
		Reason        string `json:"reason"`
	}
	_ = json.Unmarshal(raw, &req)
	var m *chief.Mission
	if s.chief != nil {
		m = s.chiefMissionForThread(req.MissionID, req.ThreadID)
	}
	respond := func(accepted bool, mission *chief.Mission, err error) {
		var snap *chief.MissionSnapshot
		if mission != nil {
			cp := s.chief.missionSnapshot(*mission)
			snap = &cp
		}
		var responseErr any
		if err != nil {
			responseErr = err.Error()
		}
		_ = sendSessionMsg(ctx, sink, "chief.thread.cancel.response", map[string]any{
			"requestId": req.RequestID, "accepted": accepted, "mission": snap, "error": responseErr,
		})
	}
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, false)
	if actorErr != nil {
		respond(false, nil, actorErr)
		return
	}
	if m == nil {
		respond(false, nil, fmt.Errorf("thread not found: %s", req.ThreadID))
		return
	}
	var thread *chief.Thread
	for i := range m.Threads {
		if m.Threads[i].ID == req.ThreadID {
			thread = &m.Threads[i]
			break
		}
	}
	if thread == nil {
		respond(false, m, fmt.Errorf("thread not found: %s", req.ThreadID))
		return
	}
	seen := make(map[string]bool)
	var abortErr error
	for _, agentID := range []string{thread.AuthorAgentID, thread.VerifierAgentID, thread.IntegratorAgentID} {
		if agentID == "" || seen[agentID] {
			continue
		}
		seen[agentID] = true
		s.mu.Lock()
		mp := s.agents[agentID]
		s.mu.Unlock()
		if mp != nil && mp.session != nil {
			if err := mp.session.Abort(ctx); err != nil && abortErr == nil {
				abortErr = fmt.Errorf("abort worker %s: %w", agentID, err)
			}
		}
	}
	if abortErr != nil {
		respond(false, m, abortErr)
		return
	}
	updated, err := s.chief.landing.CancelThread(ctx, m.ID, req.ThreadID, actorID)
	if updated == nil {
		updated = m
	}
	if err == nil {
		s.chief.broadcastMissionUpdate(updated, nil)
	}
	respond(err == nil, updated, err)
}

func chiefLandingCommitMessage(threadID, requested string) string {
	if message := strings.TrimSpace(requested); message != "" {
		return message
	}
	return "Land thread " + threadID
}

func authoritativeThreadChangedFiles(ctx context.Context, thread chief.Thread) ([]string, error) {
	if strings.TrimSpace(thread.Cwd) == "" {
		return nil, errors.New("authoritative change collection requires a thread cwd")
	}
	if strings.TrimSpace(thread.BaseRef) == "" {
		return nil, errors.New("authoritative change collection requires a thread base ref")
	}
	commands := [][]string{
		{"diff", "--name-only", "--no-renames", "-z", thread.BaseRef + "...HEAD", "--"},
		{"diff", "--name-only", "--no-renames", "-z", "HEAD", "--"},
		{"ls-files", "--others", "--exclude-standard", "-z"},
	}
	seen := make(map[string]bool)
	for _, args := range commands {
		out, err := workspace.GitRawOutput(ctx, thread.Cwd, args...)
		if err != nil {
			return nil, fmt.Errorf("collect authoritative changed files: %w", err)
		}
		for _, path := range strings.Split(out, "\x00") {
			path = filepath.ToSlash(path)
			if path != "" {
				seen[path] = true
			}
		}
	}
	paths := make([]string, 0, len(seen))
	for path := range seen {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, nil
}
