package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func (s *Server) probeOrCachedPiModels(ctx context.Context) []pi.CatalogModel {
	s.mu.Lock()
	if s.cachedPiModels != nil {
		out := s.cachedPiModels
		s.mu.Unlock()
		return out
	}
	s.mu.Unlock()

	pctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	models, cmds, err := pi.ProbeCatalog(pctx, pi.LaunchOptions{Command: s.piCommand})
	if err != nil || len(models) == 0 {
		models = pi.DefaultFallbackModels()
	}

	s.mu.Lock()
	s.cachedPiModels = models
	s.cachedPiCommands = cmds
	s.mu.Unlock()
	return models
}

func (s *Server) handleSetAgentModel(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string  `json:"requestId"`
		AgentID   string  `json:"agentId"`
		ModelID   *string `json:"modelId"`
	}
	_ = json.Unmarshal(raw, &req)

	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "set_agent_model_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     err.Error(),
		})
		return
	}

	if req.ModelID != nil && strings.TrimSpace(*req.ModelID) != "" {
		prov, mod := pi.SplitModelID(*req.ModelID)
		if _, err := mp.session.SetModel(ctx, prov, mod); err != nil {
			_ = sendSessionMsg(ctx, sink, "set_agent_model_response", map[string]any{
				"requestId": req.RequestID,
				"agentId":   req.AgentID,
				"accepted":  false,
				"error":     err.Error(),
			})
			return
		}
	}

	s.mu.Lock()
	if mp.record.Config == nil {
		mp.record.Config = &store.AgentConfig{}
	}
	mp.record.Config.Model = req.ModelID
	mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	recCopy := mp.record
	s.mu.Unlock()
	_ = s.store.UpsertAgent(recCopy)

	_ = sendSessionMsg(ctx, sink, "set_agent_model_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
	})
}

func (s *Server) handleSetAgentThinking(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID        string  `json:"requestId"`
		AgentID          string  `json:"agentId"`
		ThinkingOptionID *string `json:"thinkingOptionId"`
	}
	_ = json.Unmarshal(raw, &req)

	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "set_agent_thinking_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     err.Error(),
		})
		return
	}

	if req.ThinkingOptionID != nil && strings.TrimSpace(*req.ThinkingOptionID) != "" {
		if err := mp.session.SetThinkingLevel(ctx, *req.ThinkingOptionID); err != nil {
			_ = sendSessionMsg(ctx, sink, "set_agent_thinking_response", map[string]any{
				"requestId": req.RequestID,
				"agentId":   req.AgentID,
				"accepted":  false,
				"error":     err.Error(),
			})
			return
		}
	}

	s.mu.Lock()
	if mp.record.Config == nil {
		mp.record.Config = &store.AgentConfig{}
	}
	mp.record.Config.ThinkingOptionID = req.ThinkingOptionID
	mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	recCopy := mp.record
	s.mu.Unlock()
	_ = s.store.UpsertAgent(recCopy)

	_ = sendSessionMsg(ctx, sink, "set_agent_thinking_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
	})
}

func (s *Server) handleSetAgentMode(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		AgentID   string `json:"agentId"`
		ModeID    string `json:"modeId"`
	}
	_ = json.Unmarshal(raw, &req)

	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "set_agent_mode_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     err.Error(),
		})
		return
	}

	s.mu.Lock()
	if mp.record.Config == nil {
		mp.record.Config = &store.AgentConfig{}
	}
	modeCopy := req.ModeID
	mp.record.Config.ModeID = &modeCopy
	mp.record.LastModeID = &modeCopy
	mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	recCopy := mp.record
	s.mu.Unlock()
	_ = s.store.UpsertAgent(recCopy)

	_ = sendSessionMsg(ctx, sink, "set_agent_mode_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
	})
}

func (s *Server) handleAgentConfigApply(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		AgentID   string `json:"agentId"`
		Config    struct {
			ModelID          *string `json:"modelId"`
			ModeID           *string `json:"modeId"`
			ThinkingOptionID *string `json:"thinkingOptionId"`
		} `json:"config"`
	}
	_ = json.Unmarshal(raw, &req)

	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "agent.config.apply.response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     err.Error(),
		})
		return
	}

	if req.Config.ModelID != nil && strings.TrimSpace(*req.Config.ModelID) != "" {
		prov, mod := pi.SplitModelID(*req.Config.ModelID)
		_, _ = mp.session.SetModel(ctx, prov, mod)
	}
	if req.Config.ThinkingOptionID != nil && strings.TrimSpace(*req.Config.ThinkingOptionID) != "" {
		_ = mp.session.SetThinkingLevel(ctx, *req.Config.ThinkingOptionID)
	}

	s.mu.Lock()
	if mp.record.Config == nil {
		mp.record.Config = &store.AgentConfig{}
	}
	if req.Config.ModelID != nil {
		mp.record.Config.Model = req.Config.ModelID
	}
	if req.Config.ModeID != nil {
		mp.record.Config.ModeID = req.Config.ModeID
		mp.record.LastModeID = req.Config.ModeID
	}
	if req.Config.ThinkingOptionID != nil {
		mp.record.Config.ThinkingOptionID = req.Config.ThinkingOptionID
	}
	mp.record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	recCopy := mp.record
	s.mu.Unlock()
	_ = s.store.UpsertAgent(recCopy)

	_ = sendSessionMsg(ctx, sink, "agent.config.apply.response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
	})
}

func (s *Server) handleDeleteAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		AgentID   string `json:"agentId"`
	}
	_ = json.Unmarshal(raw, &req)

	s.mu.Lock()
	mp := s.agents[req.AgentID]
	delete(s.agents, req.AgentID)
	s.mu.Unlock()
	if mp != nil && mp.session != nil {
		_ = mp.session.Close()
	}
	_ = s.store.DeleteAgent(req.AgentID)

	_ = sendSessionMsg(ctx, sink, "agent_deleted", map[string]any{
		"agentId":   req.AgentID,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleArchiveAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		AgentID   string `json:"agentId"`
	}
	_ = json.Unmarshal(raw, &req)

	now := time.Now().UTC().Format(time.RFC3339Nano)
	s.mu.Lock()
	mp := s.agents[req.AgentID]
	delete(s.agents, req.AgentID)
	s.mu.Unlock()

	if mp != nil && mp.session != nil {
		_ = mp.session.Close()
	}
	if rec, _ := s.store.GetAgent(req.AgentID); rec != nil {
		rec.ArchivedAt = &now
		rec.UpdatedAt = now
		rec.LastStatus = "closed"
		_ = s.store.UpsertAgent(*rec)
	}

	_ = sendSessionMsg(ctx, sink, "agent_archived", map[string]any{
		"agentId":    req.AgentID,
		"archivedAt": now,
		"requestId":  req.RequestID,
	})
}

func (s *Server) handleUpdateAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string            `json:"requestId"`
		AgentID   string            `json:"agentId"`
		Name      *string           `json:"name"`
		Labels    map[string]string `json:"labels"`
	}
	_ = json.Unmarshal(raw, &req)

	rec, _ := s.store.GetAgent(req.AgentID)
	if rec == nil {
		_ = sendSessionMsg(ctx, sink, "update_agent_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"accepted":  false,
			"error":     "Agent not found",
		})
		return
	}

	if req.Name != nil {
		rec.Title = req.Name
	}
	if req.Labels != nil {
		rec.Labels = req.Labels
	}
	rec.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_ = s.store.UpsertAgent(*rec)

	s.mu.Lock()
	if mp, ok := s.agents[req.AgentID]; ok {
		mp.record = *rec
	}
	s.mu.Unlock()

	_ = sendSessionMsg(ctx, sink, "update_agent_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
	})
}

func (s *Server) handleListCommands(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID   string         `json:"requestId"`
		AgentID     string         `json:"agentId"`
		DraftConfig map[string]any `json:"draftConfig"`
	}
	_ = json.Unmarshal(raw, &req)

	var cmds []pi.SlashCommand
	if req.AgentID != "" {
		if mp, err := s.ensureAgentLoaded(req.AgentID); err == nil && mp.session != nil {
			cmds, _ = mp.session.GetCommands(ctx)
		}
	}
	if cmds == nil {
		cmds = []pi.SlashCommand{}
	}

	_ = sendSessionMsg(ctx, sink, "list_commands_response", map[string]any{
		"agentId":   req.AgentID,
		"commands":  cmds,
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleCreateBySpaceWorktree(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID         string         `json:"requestId"`
		Cwd               string         `json:"cwd"`
		WorktreeSlug      string         `json:"worktreeSlug"`
		RefName           string         `json:"refName"`
		CheckoutSource    string         `json:"checkoutSource"`
		GithubPrNumber    *int           `json:"githubPrNumber"`
		NameContext       map[string]any `json:"nameContext"`
		FirstAgentContext map[string]any `json:"firstAgentContext"`
	}
	_ = json.Unmarshal(raw, &req)

	wtBase := filepath.Join(s.homeDir, "worktrees")
	wtPath, branch, err := workspace.CreateWorktree(ctx, req.Cwd, wtBase, req.WorktreeSlug, req.RefName)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "create_byspace_worktree_response", map[string]any{
			"workspace":          nil,
			"error":              err.Error(),
			"errorCode":          "worktree_create_failed",
			"setupTerminalId":    nil,
			"setupSkippedReason": nil,
			"requestId":          req.RequestID,
		})
		return
	}

	prj, _, err := s.store.EnsureWorkspaceForCwd(req.Cwd)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "create_byspace_worktree_response", map[string]any{
			"workspace":          nil,
			"error":              err.Error(),
			"errorCode":          "project_register_failed",
			"setupTerminalId":    nil,
			"setupSkippedReason": nil,
			"requestId":          req.RequestID,
		})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	repoRoot := prj.RootPath
	wsRec := store.WorkspaceRecord{
		WorkspaceID:            store.NewWorkspaceID(),
		ProjectID:              prj.ProjectID,
		Cwd:                    wtPath,
		Kind:                   "worktree",
		DisplayName:            branch,
		Branch:                 &branch,
		WorktreeRoot:           &wtPath,
		MainRepoRoot:           &repoRoot,
		IsBySpaceOwnedWorktree: true,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	_ = s.store.UpsertWorkspace(wsRec)
	s.broadcastWorkspaceUpsert(wsRec, prj)
	s.broadcastCheckoutStatusUpdate(ctx, wsRec.Cwd)

	desc := buildWorkspaceDescriptor(wsRec, prj)
	_ = sendSessionMsg(ctx, sink, "create_byspace_worktree_response", map[string]any{
		"workspace":          desc,
		"error":              nil,
		"errorCode":          nil,
		"setupTerminalId":    nil,
		"setupSkippedReason": nil,
		"requestId":          req.RequestID,
	})
}

func (s *Server) handleBySpaceWorktreeList(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &req)
	wts, err := workspace.ListWorktrees(ctx, req.Cwd)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "byspace_worktree_list_response", map[string]any{
			"worktrees": []any{},
			"error":     map[string]any{"code": "git_error", "message": err.Error()},
			"requestId": req.RequestID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "byspace_worktree_list_response", map[string]any{
		"worktrees": wts,
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleSubscribeCheckoutDiff(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID      string         `json:"requestId"`
		SubscriptionID string         `json:"subscriptionId"`
		Cwd            string         `json:"cwd"`
		Compare        map[string]any `json:"compare"`
	}
	_ = json.Unmarshal(raw, &req)
	files, _ := workspace.GetWorkingDiff(ctx, req.Cwd)
	cmp := req.Compare
	if cmp == nil {
		cmp = map[string]any{"mode": "working"}
	}
	s.RegisterDiffSubscription(req.SubscriptionID, sink, req.Cwd, cmp, files)
	_ = sendSessionMsg(ctx, sink, "subscribe_checkout_diff_response", map[string]any{
		"subscriptionId": req.SubscriptionID,
		"cwd":            req.Cwd,
		"files":          files,
		"error":          nil,
		"requestId":      req.RequestID,
	})
}

func (s *Server) handleCheckoutCommit(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
		Message   string `json:"message"`
		AddAll    *bool  `json:"addAll"`
	}
	_ = json.Unmarshal(raw, &req)
	addAll := req.AddAll == nil || *req.AddAll
	err := workspace.CommitWithOptions(ctx, req.Cwd, req.Message, addAll)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "checkout_commit_response", map[string]any{
			"cwd":       req.Cwd,
			"success":   false,
			"error":     map[string]any{"code": "git_error", "message": err.Error()},
			"requestId": req.RequestID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "checkout_commit_response", map[string]any{
		"cwd":       req.Cwd,
		"success":   true,
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleCheckoutDiscardChanges(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string   `json:"requestId"`
		Cwd       string   `json:"cwd"`
		Paths     []string `json:"paths"`
	}
	_ = json.Unmarshal(raw, &req)
	err := workspace.DiscardPaths(ctx, req.Cwd, req.Paths)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "checkout.discard_changes.response", map[string]any{
			"cwd":       req.Cwd,
			"success":   false,
			"error":     map[string]any{"code": "git_error", "message": err.Error()},
			"requestId": req.RequestID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "checkout.discard_changes.response", map[string]any{
		"cwd":       req.Cwd,
		"success":   true,
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleScheduleMessage(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID  string `json:"requestId"`
		ScheduleID string `json:"scheduleId"`
		ID         string `json:"id"`
	}
	_ = json.Unmarshal(raw, &base)
	schedID := base.ScheduleID
	if schedID == "" {
		schedID = base.ID
	}

	emitErr := func(err error) {
		_ = sendSessionMsg(ctx, sink, "rpc_error", map[string]any{
			"requestId":   base.RequestID,
			"requestType": msgType,
			"error":       err.Error(),
			"code":        "schedule_request_failed",
		})
	}

	switch msgType {
	case "schedule/create":
		var req struct {
			RequestID   string           `json:"requestId"`
			Name        *string          `json:"name"`
			Prompt      string           `json:"prompt"`
			Cadence     schedule.Cadence `json:"cadence"`
			Target      schedule.Target  `json:"target"`
			MaxRuns     *int             `json:"maxRuns"`
			ExpiresAt   *string          `json:"expiresAt"`
			RunOnCreate bool             `json:"runOnCreate"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			emitErr(err)
			return
		}
		if req.Target.Type == "self" {
			req.Target.Type = "agent"
		}
		created, err := s.schedules.Create(ctx, schedule.CreateInput{
			Name:        req.Name,
			Prompt:      req.Prompt,
			Cadence:     req.Cadence,
			Target:      req.Target,
			MaxRuns:     req.MaxRuns,
			ExpiresAt:   req.ExpiresAt,
			RunOnCreate: req.RunOnCreate,
		})
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/create/response", map[string]any{
			"requestId": req.RequestID,
			"schedule":  created.ToSummary(),
			"error":     nil,
		})

	case "schedule/list":
		list, err := s.schedules.List()
		if err != nil {
			emitErr(err)
			return
		}
		summaries := make([]schedule.Summary, 0, len(list))
		for _, item := range list {
			summaries = append(summaries, item.ToSummary())
		}
		_ = sendSessionMsg(ctx, sink, "schedule/list/response", map[string]any{
			"requestId": base.RequestID,
			"schedules": summaries,
			"error":     nil,
		})

	case "schedule/inspect":
		sched, err := s.schedules.Inspect(schedID)
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/inspect/response", map[string]any{
			"requestId": base.RequestID,
			"schedule":  sched,
			"error":     nil,
		})

	case "schedule/logs":
		runs, err := s.schedules.Logs(schedID)
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/logs/response", map[string]any{
			"requestId": base.RequestID,
			"runs":      runs,
			"error":     nil,
		})

	case "schedule/pause":
		sched, err := s.schedules.Pause(schedID)
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/pause/response", map[string]any{
			"requestId": base.RequestID,
			"schedule":  sched.ToSummary(),
			"error":     nil,
		})

	case "schedule/resume":
		sched, err := s.schedules.Resume(schedID)
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/resume/response", map[string]any{
			"requestId": base.RequestID,
			"schedule":  sched.ToSummary(),
			"error":     nil,
		})

	case "schedule/delete":
		if err := s.schedules.Delete(schedID); err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/delete/response", map[string]any{
			"requestId":  base.RequestID,
			"scheduleId": schedID,
			"error":      nil,
		})

	case "schedule/run-once":
		sched, err := s.schedules.RunOnce(ctx, schedID)
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/run-once/response", map[string]any{
			"requestId": base.RequestID,
			"schedule":  sched.ToSummary(),
			"error":     nil,
		})

	case "schedule/update":
		sched, err := s.schedules.Inspect(schedID)
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/update/response", map[string]any{
			"requestId": base.RequestID,
			"schedule":  sched.ToSummary(),
			"error":     nil,
		})
	}
}

func (s *Server) executeScheduledPiRun(ctx context.Context, sched schedule.StoredSchedule) (schedule.ExecutionResult, error) {
	if sched.Target.Type == "agent" && sched.Target.AgentID != "" {
		mp, err := s.ensureAgentLoaded(sched.Target.AgentID)
		if err != nil {
			return schedule.ExecutionResult{}, err
		}
		if err := mp.session.Prompt(ctx, sched.Prompt, nil); err != nil {
			return schedule.ExecutionResult{}, err
		}
		_ = mp.session.WaitForFinish(ctx)
		agtID := sched.Target.AgentID
		out := mp.session.LastAssistantText()
		return schedule.ExecutionResult{
			AgentID: &agtID,
			Output:  &out,
		}, nil
	}

	cwd, _ := os.Getwd()
	if sched.Target.Config != nil && sched.Target.Config.Cwd != "" {
		cwd = sched.Target.Config.Cwd
	}
	_, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
	if err != nil {
		return schedule.ExecutionResult{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	agentID := newAgentID()
	rec := store.AgentRecord{
		ID:          agentID,
		Provider:    "pi",
		Cwd:         cwd,
		WorkspaceID: ws.WorkspaceID,
		CreatedAt:   now,
		UpdatedAt:   now,
		Title:       sched.Name,
		Labels:      map[string]string{},
		LastStatus:  "idle",
	}
	mp, err := s.startOrGetPiAgent(rec)
	if err != nil {
		return schedule.ExecutionResult{}, err
	}
	_ = s.store.UpsertAgent(mp.record)
	if err := mp.session.Prompt(ctx, sched.Prompt, nil); err != nil {
		return schedule.ExecutionResult{AgentID: &agentID}, err
	}
	_ = mp.session.WaitForFinish(ctx)
	out := mp.session.LastAssistantText()
	wsID := ws.WorkspaceID
	return schedule.ExecutionResult{
		AgentID:     &agentID,
		WorkspaceID: &wsID,
		Output:      &out,
	}, nil
}

func (s *Server) handleAgentPermissionResponse(ctx context.Context, _ frameSink, raw json.RawMessage) {
	var req struct {
		AgentID   string         `json:"agentId"`
		RequestID string         `json:"requestId"`
		Response  map[string]any `json:"response"`
	}
	_ = json.Unmarshal(raw, &req)
	if req.AgentID == "" || req.RequestID == "" {
		return
	}
	mp, err := s.ensureAgentLoaded(req.AgentID)
	if err != nil {
		return
	}
	_ = mp.session.RespondToPermission(req.RequestID, req.Response)
	nowStr := time.Now().UTC().Format(time.RFC3339Nano)
	s.broadcastSessionMsg("agent_stream", map[string]any{
		"agentId":   req.AgentID,
		"provider":  mp.record.Provider,
		"timestamp": nowStr,
		"event": map[string]any{
			"type":       "permission_resolved",
			"provider":   mp.record.Provider,
			"requestId":  req.RequestID,
			"resolution": req.Response,
		},
	})
	// The permission store keys off this dedicated message; the stream event only updates the
	// inline card.
	s.broadcastSessionMsg("agent_permission_resolved", map[string]any{
		"agentId":    req.AgentID,
		"requestId":  req.RequestID,
		"resolution": req.Response,
	})
}

func (s *Server) handleProviderSubagentsList(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string `json:"requestId"`
		ParentAgentID string `json:"parentAgentId"`
	}
	_ = json.Unmarshal(raw, &req)
	mp, err := s.ensureAgentLoaded(req.ParentAgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "agent.provider_subagents.list.response", map[string]any{
			"requestId":     req.RequestID,
			"parentAgentId": req.ParentAgentID,
			"subagents":     []any{},
			"error":         err.Error(),
		})
		return
	}
	subs := mp.session.ListSubagents(req.ParentAgentID)
	_ = sendSessionMsg(ctx, sink, "agent.provider_subagents.list.response", map[string]any{
		"requestId":     req.RequestID,
		"parentAgentId": req.ParentAgentID,
		"subagents":     subs,
		"error":         nil,
	})
}

func (s *Server) handleProviderSubagentTimeline(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string `json:"requestId"`
		ParentAgentID string `json:"parentAgentId"`
		SubagentID    string `json:"subagentId"`
		Direction     string `json:"direction"`
	}
	_ = json.Unmarshal(raw, &req)
	dir := req.Direction
	if dir == "" {
		dir = "tail"
	}

	mp, err := s.ensureAgentLoaded(req.ParentAgentID)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "agent.provider_subagents.timeline.get.response", map[string]any{
			"requestId":     req.RequestID,
			"parentAgentId": req.ParentAgentID,
			"subagentId":    req.SubagentID,
			"provider":      nil,
			"direction":     dir,
			"epoch":         "",
			"reset":         false,
			"staleCursor":   false,
			"gap":           false,
			"window":        map[string]any{"minSeq": 0, "maxSeq": 0, "nextSeq": 0},
			"hasOlder":      false,
			"hasNewer":      false,
			"rows":          []any{},
			"error":         err.Error(),
		})
		return
	}

	sub, ok := mp.session.GetSubagent(req.ParentAgentID, req.SubagentID)
	if !ok {
		_ = sendSessionMsg(ctx, sink, "agent.provider_subagents.timeline.get.response", map[string]any{
			"requestId":     req.RequestID,
			"parentAgentId": req.ParentAgentID,
			"subagentId":    req.SubagentID,
			"provider":      nil,
			"direction":     dir,
			"epoch":         "",
			"reset":         false,
			"staleCursor":   false,
			"gap":           false,
			"window":        map[string]any{"minSeq": 0, "maxSeq": 0, "nextSeq": 0},
			"hasOlder":      false,
			"hasNewer":      false,
			"rows":          []any{},
			"error":         "Provider subagent not found",
		})
		return
	}

	var entries []pi.TimelineEntry
	if file := pi.LocateSubagentSessionFile(sub, s.piSessionDir); file != "" {
		entries, _ = pi.LoadTimelineFromJSONL(file)
	}
	rows := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, map[string]any{
			"item":      e.Item,
			"timestamp": e.Timestamp,
			"seq":       e.Seq,
		})
	}
	minSeq := 0
	if len(rows) > 0 {
		minSeq = 1
	}

	_ = sendSessionMsg(ctx, sink, "agent.provider_subagents.timeline.get.response", map[string]any{
		"requestId":     req.RequestID,
		"parentAgentId": req.ParentAgentID,
		"subagentId":    req.SubagentID,
		"provider":      "pi",
		"direction":     dir,
		"epoch":         "ep_sub_1",
		"reset":         false,
		"staleCursor":   false,
		"gap":           false,
		"window": map[string]any{
			"minSeq":  minSeq,
			"maxSeq":  len(rows),
			"nextSeq": len(rows) + 1,
		},
		"hasOlder": false,
		"hasNewer": false,
		"rows":     rows,
		"error":    nil,
	})
}

// BuildPairingOfferURL constructs a ConnectionOfferV2 fragment URL (#offer=<base64url>).
func (s *Server) BuildPairingOfferURL(relayEndpoint string, useTLS bool, appBaseURL string) string {
	ep := strings.TrimSpace(relayEndpoint)
	if ep == "" {
		ep = strings.TrimSpace(os.Getenv("BYSPACE_RELAY_ENDPOINT"))
	}
	if ep == "" {
		ep = "relay.byspace.cc.cd:443"
		useTLS = true
	}
	baseURL := strings.TrimSpace(appBaseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv("BYSPACE_APP_BASE_URL"))
	}
	if baseURL == "" {
		baseURL = "https://app.byspace.cc.cd"
	}

	hostname, _ := os.Hostname()
	offer := map[string]any{
		"v":                  2,
		"serverId":           s.serverID,
		"daemonPublicKeyB64": s.pubKeyB64,
		"relay": map[string]any{
			"endpoint": ep,
			"useTls":   useTLS,
		},
		"hostname": hostname,
	}
	b, _ := json.Marshal(offer)
	encoded := base64.RawURLEncoding.EncodeToString(b)
	return strings.TrimRight(baseURL, "/") + "/#offer=" + encoded
}

func (s *Server) handleGetPairingOffer(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
	}
	_ = json.Unmarshal(raw, &req)
	offerURL := s.BuildPairingOfferURL("", true, "")
	var qrText any
	if qr, qrErr := RenderASCIIQRCode(offerURL); qrErr == nil {
		qrText = qr
	}
	_ = sendSessionMsg(ctx, sink, "daemon.get_pairing_offer.response", map[string]any{
		"requestId":    req.RequestID,
		"url":          offerURL,
		"qr":           qrText,
		"relayEnabled": true,
	})
}

func (s *Server) handleRegisterPushToken(raw json.RawMessage) {
	var req struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(raw, &req)
	tok := strings.TrimSpace(req.Token)
	if tok == "" {
		return
	}
	tokensPath := filepath.Join(s.homeDir, "push-tokens.json")
	var tokens []string
	if b, err := os.ReadFile(tokensPath); err == nil {
		_ = json.Unmarshal(b, &tokens)
	}
	for _, existing := range tokens {
		if existing == tok {
			return
		}
	}
	tokens = append(tokens, tok)
	out, _ := json.MarshalIndent(tokens, "", "  ")
	_ = home.WriteAtomic(tokensPath, append(out, '\n'), 0o600)
}

func (s *Server) handlePushUnregister(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Token     string `json:"token"`
	}
	_ = json.Unmarshal(raw, &req)
	tok := strings.TrimSpace(req.Token)
	tokensPath := filepath.Join(s.homeDir, "push-tokens.json")
	var tokens []string
	if b, err := os.ReadFile(tokensPath); err == nil {
		_ = json.Unmarshal(b, &tokens)
	}
	next := tokens[:0]
	for _, existing := range tokens {
		if existing != tok {
			next = append(next, existing)
		}
	}
	out, _ := json.MarshalIndent(next, "", "  ")
	_ = home.WriteAtomic(tokensPath, append(out, '\n'), 0o600)
	_ = sendSessionMsg(ctx, sink, "push.unregister.response", map[string]any{
		"requestId": req.RequestID,
	})
}

func (s *Server) handleDiagnostics(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
	}
	_ = json.Unmarshal(raw, &req)
	logPath := filepath.Join(s.homeDir, "daemon.log")
	var logTail string
	if b, err := os.ReadFile(logPath); err == nil {
		if len(b) > 8192 {
			b = b[len(b)-8192:]
		}
		logTail = string(b)
	}
	diag := "Daemon log tail (" + s.version + "):\n" + logTail
	_ = sendSessionMsg(ctx, sink, "diagnostics.response", map[string]any{
		"requestId":  req.RequestID,
		"diagnostic": diag,
	})
}
