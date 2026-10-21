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
	"github.com/ByteTrue/byspace/internal/naming"
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

	// Probing spawns pi, which loads extensions; a cold or busy machine can exceed a short
	// timeout. Ten seconds is still well under any user-visible wait, and a failure is NOT
	// cached: caching the fallback pinned a placeholder model forever, so the real catalog
	// never appeared for the rest of the daemon's life.
	pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	models, cmds, err := pi.ProbeCatalog(pctx, pi.LaunchOptions{Command: s.piCommand})
	if err != nil || len(models) == 0 {
		return pi.DefaultFallbackModels()
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
		// Clients waiting on this turn (a `wait_for_finish`, a blocking CLI) need a terminal
		// event; otherwise they sit until their own timeout on an agent that no longer exists.
		if turnID, _ := mp.session.ActiveTurn(); turnID != "" {
			s.broadcastTurnCanceled(mp.record, turnID, "agent archived")
		}
		_ = mp.session.Close()
	}
	if rec, _ := s.store.GetAgent(req.AgentID); rec != nil {
		rec.ArchivedAt = &now
		rec.UpdatedAt = now
		rec.LastStatus = "closed"
		_ = s.store.UpsertAgent(*rec)
	}
	// Archiving a conversation must not leave its subagents running: they would keep spending
	// tokens and holding provider processes for a conversation the user removed.
	s.cascadeArchiveChildren(req.AgentID)

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
		RequestID    string `json:"requestId"`
		Cwd          string `json:"cwd"`
		WorktreeSlug string `json:"worktreeSlug"`
		BranchName   string `json:"branchName"`
		RefName      string `json:"refName"`
		// `action` and `checkoutSource` decide *what* to create; reading only `refName`
		// meant "check out this PR" and "check out this existing branch" both became
		// "create a new branch from refName".
		Action         string `json:"action"`
		CheckoutSource *struct {
			Kind        string `json:"kind"`
			Forge       string `json:"forge"`
			Number      int    `json:"number"`
			ProjectPath string `json:"projectPath"`
		} `json:"checkoutSource"`
		GithubPrNumber    *int           `json:"githubPrNumber"`
		NameContext       map[string]any `json:"nameContext"`
		FirstAgentContext map[string]any `json:"firstAgentContext"`
		// AutoTitle is filled from the naming model so the workspace is not named after its
		// generated branch slug.
		AutoTitle string
	}
	_ = json.Unmarshal(raw, &req)

	// Normalize a supplied slug with the same rules the client uses, so a name that passed in
	// the UI is not rejected here and a third-party client's name is held to the same standard.
	if normalized := workspace.NormalizeWorktreeSlug(req.WorktreeSlug); normalized != "" {
		req.WorktreeSlug = normalized
	}
	if strings.TrimSpace(req.WorktreeSlug) == "" {
		if seed := firstAgentContextSeed(req.FirstAgentContext); seed != "" {
			nctx, cancel := context.WithTimeout(ctx, 45*time.Second)
			name, nameErr := naming.PiGenerator{Command: s.piCommand, Model: s.namingModel()}.Generate(nctx, seed)
			cancel()
			if nameErr == nil {
				req.WorktreeSlug = name.Branch
				if strings.TrimSpace(req.AutoTitle) == "" {
					req.AutoTitle = name.Title
				}
			}
			// A failed generation is not fatal: fall through to the generated slug.
		}
	}

	wtBase := filepath.Join(s.homeDir, "worktrees")
	intentInput := workspace.WorktreeIntentInput{
		WorktreeSlug:   req.WorktreeSlug,
		BranchName:     req.BranchName,
		RefName:        req.RefName,
		Action:         req.Action,
		GithubPRNumber: req.GithubPrNumber,
	}
	if req.CheckoutSource != nil {
		intentInput.CheckoutSource = &workspace.CheckoutSource{
			Number:      req.CheckoutSource.Number,
			Forge:       req.CheckoutSource.Forge,
			ProjectPath: req.CheckoutSource.ProjectPath,
		}
	}
	intent, intentErr := workspace.ResolveWorktreeIntent(ctx, intentInput, req.Cwd, workspace.WorktreeIntentDeps{
		Forge:         workspace.DetectForge(ctx, req.Cwd),
		DefaultBranch: workspace.ResolveDefaultBranch,
	})
	if intentErr != nil {
		code, msg := workspace.ToWorktreeWireError(intentErr)
		_ = sendSessionMsg(ctx, sink, "create_byspace_worktree_response", map[string]any{
			"workspace":       nil,
			"error":           msg,
			"errorCode":       code,
			"setupTerminalId": nil,
			"requestId":       req.RequestID,
		})
		return
	}
	wtPath, branch, err := workspace.CreateWorktreeFromIntent(ctx, req.Cwd, wtBase, intent, req.WorktreeSlug)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "create_byspace_worktree_response", map[string]any{
			"workspace":       nil,
			"error":           err.Error(),
			"errorCode":       "worktree_create_failed",
			"setupTerminalId": nil,
			"requestId":       req.RequestID,
		})
		return
	}

	prj, _, err := s.store.EnsureWorkspaceForCwd(req.Cwd)
	if err != nil {
		// `errorCode` / `setupSkippedReason` are optional, not nullable: sending null makes the
		// client reject the whole response, so the user sees nothing instead of the error.
		_ = sendSessionMsg(ctx, sink, "create_byspace_worktree_response", map[string]any{
			"workspace":       nil,
			"error":           err.Error(),
			"errorCode":       "project_register_failed",
			"setupTerminalId": nil,
			"requestId":       req.RequestID,
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
	// A worktree checked out from someone else's change request carries that author's
	// byspace.json. Remember where it came from so setup and scripts stay blocked until the user
	// explicitly allows them.
	if intent.Kind == workspace.IntentCheckoutChangeRequest && intent.HeadRepository != "" {
		wsRec.UntrustedSource = &store.UntrustedSource{
			Kind:           "change_request",
			Forge:          intent.Forge,
			Number:         intent.ChangeRequestNumber,
			HeadRepository: intent.HeadRepository,
		}
	}
	_ = s.store.UpsertWorkspace(wsRec)
	s.broadcastWorkspaceUpsert(wsRec, prj)
	// Record what the worktree was cut from, inside the worktree: it survives the registry being
	// lost or rebuilt, and it is how the daemon knows which base to diff against without asking
	// the forge on every request.
	meta := workspace.WorktreeMetadata{
		Version:     2,
		BaseRefName: intent.BaseBranch,
		BaseRef:     intent.BaseRef,
	}
	if intent.Kind == workspace.IntentCheckoutChangeRequest {
		meta.ChangeRequestLookupTarget = &workspace.ChangeRequestLookupTarget{
			HeadRef:             intent.HeadRef,
			HeadRepositoryOwner: intent.HeadRepository,
			ChangeRequestNumber: intent.ChangeRequestNumber,
			LocalBranchName:     branch,
		}
	}
	_ = workspace.WriteWorktreeMetadata(wtPath, meta)
	s.broadcastCheckoutStatusUpdate(ctx, wsRec.Cwd)

	// A fresh worktree has no node_modules and no .env, so setup has to run before the
	// workspace is usable. Node starts it asynchronously and streams progress into the
	// worktree_setup timeline item; without it a new worktree looks ready but every command
	// inside it fails.
	setupCommands := workspace.ReadSetupCommands(wtPath)
	setupSkippedReason := any(nil)
	if len(setupCommands) == 0 {
		setupSkippedReason = "no setup commands configured"
	} else {
		go s.runWorkspaceSetup(wsRec.WorkspaceID, wtPath, branch, setupCommands)
	}

	setupErrCode := ""
	desc := buildWorkspaceDescriptor(wsRec, prj)
	respPayload := map[string]any{
		"workspace":       desc,
		"error":           nil,
		"setupTerminalId": nil,
		"requestId":       req.RequestID,
	}
	// Both extra keys are optional-not-nullable; add them only when they carry a value.
	if setupSkippedReason != nil {
		respPayload["setupSkippedReason"] = setupSkippedReason
	}
	if setupErrCode != "" {
		respPayload["errorCode"] = setupErrCode
	}
	_ = sendSessionMsg(ctx, sink, "create_byspace_worktree_response", respPayload)
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

	message := strings.TrimSpace(req.Message)
	if message == "" {
		// An empty -m makes git open an editor, which hangs a daemon that has no terminal —
		// and the UI offers Commit without requiring the user to type a message. Generate one
		// from the diff instead of failing or hanging.
		diff, diffErr := workspace.GetDiffSummaryForPrompt(ctx, req.Cwd)
		if diffErr == nil && strings.TrimSpace(diff) != "" {
			genCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
			generated, genErr := naming.PiGenerator{Command: s.piCommand, Model: s.namingModel()}.GenerateCommitMessage(genCtx, diff)
			cancel()
			if genErr == nil {
				message = generated
			}
		}
	}
	if strings.TrimSpace(message) == "" {
		_ = sendSessionMsg(ctx, sink, "checkout_commit_response", map[string]any{
			"cwd":     req.Cwd,
			"success": false,
			"error": map[string]any{
				"code":    "message_required",
				"message": "A commit message is required",
			},
			"requestId": req.RequestID,
		})
		return
	}

	err := workspace.CommitWithOptions(ctx, req.Cwd, message, addAll)
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
		// A target that no longer exists is permanent: the schedule must complete rather than
		// fail on every tick until it burns through its budget.
		record, loadErr := s.store.GetAgent(sched.Target.AgentID)
		if loadErr != nil || record == nil || record.ArchivedAt != nil {
			return schedule.ExecutionResult{}, schedule.TargetGoneError{
				Reason: "target agent " + sched.Target.AgentID + " was deleted or archived",
			}
		}
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
	// The same permanence rule as a deleted agent: a cwd that no longer exists cannot host an
	// agent, and retrying every tick fails identically.
	if info, statErr := os.Stat(cwd); statErr != nil || !info.IsDir() {
		return schedule.ExecutionResult{}, schedule.TargetGoneError{
			Reason: "target directory " + cwd + " no longer exists",
		}
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
		// Limit is omitted for "all"; the node store defaults it to 200 and treats 0 as all.
		Limit *int `json:"limit"`
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

	// The window semantics are what make the panel usable for a long subagent: `tail` shows the
	// most recent N with hasOlder set, `head` the first N with hasNewer set. Returning everything
	// ignores both the limit and the direction, so a subagent that ran for an hour ships its whole
	// transcript on every poll.
	total := len(rows)
	minSeq, maxSeq := 0, total
	hasOlder, hasNewer := false, false
	if req.Limit != nil {
		limit := *req.Limit
		if limit < 0 {
			limit = 0
		}
		if limit > 0 && limit < total {
			// The protocol's directions are tail (newest N), before (older than a cursor) and
			// after (newer than a cursor). `after` reads forward from the cursor, so it keeps the
			// leading rows and reports that newer ones remain; `tail` and `before` keep the
			// trailing rows and report older ones.
			if dir == "after" {
				rows = rows[:limit]
				hasNewer = true
			} else {
				rows = rows[total-limit:]
				hasOlder = true
			}
			minSeq = 1
		}
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
			"maxSeq":  maxSeq,
			"nextSeq": total + 1,
		},
		"hasOlder": hasOlder,
		"hasNewer": hasNewer,
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

	// A pairing offer only makes sense through a relay: the phone cannot reach this daemon
	// directly. With the relay off, node returns no url and no qr rather than handing out a
	// link that can never connect — a scanned QR that silently fails is worse than "enable the
	// relay first".
	relayCfg := relayConfigFromStore(s.store.LoadDaemonConfig())
	if !relayCfg.Enabled || strings.TrimSpace(relayCfg.Endpoint) == "" {
		_ = sendSessionMsg(ctx, sink, "daemon.get_pairing_offer.response", map[string]any{
			"requestId":    req.RequestID,
			"url":          "",
			"qr":           nil,
			"relayEnabled": false,
		})
		return
	}

	offerURL := s.BuildPairingOfferURL("", relayCfg.UseTLS, relayCfg.Endpoint)
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

// broadcastTurnCanceled tells clients a turn will never produce a result.
//
// Ported from prepareAgentForClosure, which cancels every waiter with `turn_canceled` when an
// agent closes. Without it a `wait_for_finish` blocks until its own timeout even though the
// agent is already gone.
func (s *Server) broadcastTurnCanceled(rec store.AgentRecord, turnID, reason string) {
	s.broadcastSessionMsg("agent_stream", map[string]any{
		"agentId":   rec.ID,
		"provider":  rec.Provider,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"event": map[string]any{
			"type":     "turn_canceled",
			"provider": rec.Provider,
			"turnId":   turnID,
			"reason":   reason,
		},
	})
}

// firstAgentContextSeed extracts the prompt text the naming model should read.
func firstAgentContextSeed(ctx map[string]any) string {
	if ctx == nil {
		return ""
	}
	for _, key := range []string{"prompt", "text", "message", "initialPrompt"} {
		if value, ok := ctx[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// namingModel returns the configured metadata-generation model, or "" for pi's default.
func (s *Server) namingModel() string {
	cfg := s.store.LoadDaemonConfig()
	if cfg == nil {
		return ""
	}
	meta, ok := cfg["metadataGeneration"].(map[string]any)
	if !ok {
		return ""
	}
	if model, ok := meta["model"].(string); ok {
		return strings.TrimSpace(model)
	}
	return ""
}
