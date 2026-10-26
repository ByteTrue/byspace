package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/activity"
	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/agentnotices"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/naming"
	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func (s *Server) probeOrCachedPiModels(ctx context.Context) []pi.CatalogModel {
	return s.probePiModelsInCwd(ctx, "")
}

// probePiModelsInCwd probes with an explicit working directory.
//
// The cache is keyed on the directory: a checkout can carry repo-local provider config, so a
// model list probed in one project is not valid in another. An empty cwd reuses whatever was
// cached, which is the common case.
func (s *Server) probePiModelsInCwd(ctx context.Context, cwd string) []pi.CatalogModel {
	s.mu.Lock()
	if s.cachedPiModels != nil && (cwd == "" || s.cachedPiModelsCwd == "" || s.cachedPiModelsCwd == cwd) {
		out := s.cachedPiModels
		s.mu.Unlock()
		return out
	}
	if cwd != "" && s.cachedPiModels != nil && s.cachedPiModelsCwd != cwd {
		// A different project: the cached list was probed elsewhere and must not be served.
		s.cachedPiModels = nil
	}
	s.mu.Unlock()

	// Probing spawns pi, which loads extensions; a cold or busy machine can exceed a short
	// timeout. Ten seconds is still well under any user-visible wait, and a failure is NOT
	// cached: caching the fallback pinned a placeholder model forever, so the real catalog
	// never appeared for the rest of the daemon's life.
	pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	models, cmds, err := pi.ProbeCatalog(pctx, pi.LaunchOptions{Command: s.piCommand, Cwd: cwd})
	if err != nil || len(models) == 0 {
		return pi.DefaultFallbackModels()
	}

	s.mu.Lock()
	s.cachedPiModels = models
	s.cachedPiCommands = cmds
	if cwd != "" {
		s.cachedPiModelsCwd = cwd
	}
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
	// The response only reaches the caller. Every other client — including this one's replicas on
	// other devices — keeps the old model until an agent_update says otherwise, which is what the
	// composer renders from.
	s.broadcastAgentUpdate(recCopy)

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
	// A provider keeps the running turn on its original level and applies the new one next turn.
	// Without telling the user, changing the level mid-turn looks like it did nothing.
	midTurn := mp.record.LastStatus == "running"
	s.mu.Unlock()
	_ = s.store.UpsertAgent(recCopy)

	s.broadcastAgentUpdate(recCopy)

	var notice *agentnotices.Notice
	if midTurn {
		notice = &agentnotices.ThinkingAppliesNextTurn
	}
	_ = sendSessionMsg(ctx, sink, "set_agent_thinking_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
		// Nullable and optional: nil is the correct absent value, and an empty object fails the
		// discriminated union that validates this field.
		"notice": agentnotices.ToPayload(notice),
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
	// Same as the thinking level: the running turn keeps its mode, and the user needs to know the
	// change is not in effect yet.
	midTurn := mp.record.LastStatus == "running"
	s.mu.Unlock()
	_ = s.store.UpsertAgent(recCopy)

	s.broadcastAgentUpdate(recCopy)

	var notice *agentnotices.Notice
	if midTurn {
		notice = &agentnotices.ModeAppliesNextTurn
	}
	_ = sendSessionMsg(ctx, sink, "set_agent_mode_response", map[string]any{
		"requestId": req.RequestID,
		"agentId":   req.AgentID,
		"accepted":  true,
		"error":     nil,
		"notice":    agentnotices.ToPayload(notice),
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
	// A bundle changes several fields at once; the composer and the picker both read them from the
	// agent snapshot, so the update has to be pushed rather than left to the response.
	s.broadcastAgentUpdate(recCopy)

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

	// Tell every connected client to drop this agent's subagents before the session goes away.
	// Otherwise the Subagents panel keeps rows for a parent that no longer exists, and they can
	// never be cleared because the parent they point at is gone.
	if mp != nil && mp.session != nil {
		for _, sub := range mp.session.ListSubagents(req.AgentID) {
			s.broadcastSessionMsg("agent.provider_subagents.update", map[string]any{
				"kind":          "remove",
				"parentAgentId": req.AgentID,
				"subagentId":    sub.ID,
			})
		}
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
		// BuildArchivedAgentRecord normalizes the status and clears attention; writing the fields
		// by hand is what left an archived agent with a permanent unread dot.
		archived := store.BuildArchivedAgentRecord(*rec, now)
		_ = s.store.UpsertAgent(archived)
		// The archive has to reach every socket, not just the caller: the directory store on each
		// client decides which workspace tabs to keep from the archived flag, so a silent write
		// leaves the archived conversation open everywhere else.
		s.broadcastAgentUpdate(archived)
	}
	// Archiving a conversation must not leave its subagents running: they would keep spending
	// tokens and holding provider processes for a conversation the user removed.
	s.cascadeArchiveChildren(req.AgentID)

	// Broadcast rather than reply: the client that asked waits for `agent_archived` with its own
	// requestId, and every other socket needs the same fact to prune the tab.
	s.broadcastSessionMsg("agent_archived", map[string]any{
		"agentId":    req.AgentID,
		"archivedAt": now,
		"requestId":  req.RequestID,
	})
}

// mergeLabelPatch applies a label write on top of the agent's current labels.
//
// A label write is a patch, not a replacement. Clients post one key at a time — an open-tab marker,
// a parent link — and they expect the rest to survive. Assigning the map dropped every other label
// on the agent, including the parent link the subagent track groups by. An empty value deletes,
// matching the shape the archive cascade sends.
func mergeLabelPatch(current, patch map[string]string) map[string]string {
	merged := make(map[string]string, len(current)+len(patch))
	for key, value := range current {
		merged[key] = value
	}
	for key, value := range patch {
		if strings.TrimSpace(value) == "" {
			delete(merged, key)
			continue
		}
		merged[key] = value
	}
	return merged
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
		rec.Labels = mergeLabelPatch(rec.Labels, req.Labels)
	}
	rec.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_ = s.store.UpsertAgent(*rec)

	s.mu.Lock()
	if mp, ok := s.agents[req.AgentID]; ok {
		mp.record = *rec
	}
	s.mu.Unlock()

	// The response answers the caller; other clients keep the old title until a refetch without this.
	s.broadcastAgentUpdate(*rec)
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
	provider := ""
	if req.AgentID != "" {
		if record, err := s.store.GetAgent(req.AgentID); err == nil && record != nil {
			provider = record.Provider
		}
		if mp, err := s.ensureAgentLoaded(req.AgentID); err == nil && mp.session != nil {
			cmds, _ = mp.session.GetCommands(ctx)
		}
	}
	// omp's harness implements a handful of commands itself, so its RPC never reports them. Merging them
	// here is the only place that knows which provider reported the list.
	if provider == "omp" {
		cmds = providers.MapOmpSlashCommands(cmds)
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
		GithubPrNumber *int `json:"githubPrNumber"`
		// ProjectID names the project when the caller is not inside it — the sidebar creates a
		// worktree from a project row, and without the id the new worktree was registered under
		// whatever directory happened to be current.
		ProjectID string `json:"projectId"`
		// Attachments are composer files the user queued for the first agent. Dropping them
		// silently loses the images the user dragged in before the worktree even existed.
		Attachments       []any          `json:"attachments"`
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
			name, nameErr := naming.PiGenerator{Command: s.piCommand, Model: s.namingModel(), Overrides: naming.ReadProjectOverrides(req.Cwd)}.Generate(nctx, seed)
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
	s.broadcastWorkspaceUpsertStatus(wsRec, prj, createdWorkspaceStatusOverride(req.FirstAgentContext))
	s.writeCreatedWorktreeMetadata(wtPath, intent, branch)
	s.broadcastCheckoutStatusUpdate(ctx, wsRec.Cwd)

	// A fresh worktree has no node_modules and no .env, so setup has to run before the
	// workspace is usable. Node starts it asynchronously and streams progress into the
	// worktree_setup timeline item; without it a new worktree looks ready but every command
	// inside it fails.
	setupCommands := workspace.ReadSetupCommands(wtPath)
	// Run even when there is nothing to run: a project with no setup still needs a "completed"
	// snapshot, otherwise a client waiting for progress waits forever. Node emits the empty
	// completed progress for exactly this case.
	var setupSkippedReason any
	if len(setupCommands) == 0 {
		setupSkippedReason = "no setup commands configured"
	}
	go s.runWorkspaceSetup(wsRec.WorkspaceID, wtPath, branch, setupCommands)

	setupErrCode := ""
	desc := s.workspaceDescriptor(wsRec, prj)
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
		// RepoRoot names the repository when the client is not sitting in it — the sidebar asks
		// for a project's worktrees by repo root, and ignoring the field listed the daemon's own
		// directory instead.
		RepoRoot string `json:"repoRoot"`
	}
	_ = json.Unmarshal(raw, &req)
	root := strings.TrimSpace(req.RepoRoot)
	if root == "" {
		root = req.Cwd
	}
	wts, err := workspace.ListWorktrees(ctx, root)
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
	cmp := req.Compare
	if cmp == nil {
		cmp = map[string]any{"mode": "uncommitted"}
	}
	files := s.checkoutDiffFiles(ctx, req.Cwd, cmp)
	s.RegisterDiffSubscription(req.SubscriptionID, sink, req.Cwd, cmp, files)
	_ = sendSessionMsg(ctx, sink, "subscribe_checkout_diff_response", map[string]any{
		"subscriptionId": req.SubscriptionID,
		"cwd":            req.Cwd,
		"files":          files,
		"error":          nil,
		"requestId":      req.RequestID,
	})
}

// checkoutDiffFiles computes the files for one comparison mode.
//
// The mode is the whole point of the picker: "Uncommitted" answers what is not committed yet, "Committed" answers what
// the branch carries over its base. Go ignored the field and always returned the working diff, so a clean checkout showed
// an empty Changes pane no matter which mode was selected — and a branch full of commits looked like it had no changes.
func (s *Server) checkoutDiffFiles(ctx context.Context, cwd string, compare map[string]any) []workspace.ParsedDiffFile {
	mode, _ := compare["mode"].(string)
	if strings.TrimSpace(mode) == "base" {
		baseRef, _ := compare["baseRef"].(string)
		files, err := workspace.GetBaseDiff(ctx, cwd, baseRef)
		if err == nil {
			return files
		}
		// A failed base diff falls back to the working diff rather than an empty pane: showing the uncommitted
		// changes is closer to the truth than showing nothing at all.
	}
	files, _ := workspace.GetWorkingDiff(ctx, cwd)
	if files == nil {
		return []workspace.ParsedDiffFile{}
	}
	return files
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
			generated, genErr := naming.PiGenerator{Command: s.piCommand, Model: s.namingModel(), Overrides: naming.ReadProjectOverrides(req.Cwd)}.GenerateCommitMessage(genCtx, diff)
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
			"schedule":  sched,
			"error":     nil,
		})

	case "schedule/update":
		var req struct {
			ScheduleID     string            `json:"scheduleId"`
			Name           *string           `json:"name"`
			Prompt         *string           `json:"prompt"`
			Cadence        *schedule.Cadence `json:"cadence"`
			NewAgentConfig *struct {
				Provider         *string `json:"provider"`
				Model            *string `json:"model"`
				ModeID           *string `json:"modeId"`
				ThinkingOptionID *string `json:"thinkingOptionId"`
				ArchiveOnFinish  *bool   `json:"archiveOnFinish"`
				Isolation        *string `json:"isolation"`
				Cwd              *string `json:"cwd"`
			} `json:"newAgentConfig"`
			MaxRuns   *int    `json:"maxRuns"`
			ExpiresAt *string `json:"expiresAt"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			emitErr(err)
			return
		}
		update := schedule.UpdateInput{
			ID:        firstNonEmptyTrimmed(req.ScheduleID, schedID),
			Name:      req.Name,
			HasName:   req.Name != nil,
			Prompt:    req.Prompt,
			Cadence:   req.Cadence,
			MaxRuns:   req.MaxRuns,
			ExpiresAt: req.ExpiresAt,
		}
		// The patch is only meaningful for a new-agent target; a schedule bound to an existing agent
		// has no config to edit, and applying one would invent knobs the run never reads.
		if cfg := req.NewAgentConfig; cfg != nil {
			update.Config = &schedule.TargetConfigPatch{
				Provider:         cfg.Provider,
				Model:            cfg.Model,
				ModeID:           cfg.ModeID,
				ThinkingOptionID: cfg.ThinkingOptionID,
				ArchiveOnFinish:  cfg.ArchiveOnFinish,
				Isolation:        cfg.Isolation,
				Cwd:              cfg.Cwd,
			}
		}
		sched, err := s.schedules.Update(update)
		if err != nil {
			emitErr(err)
			return
		}
		_ = sendSessionMsg(ctx, sink, "schedule/update/response", map[string]any{
			"requestId": base.RequestID,
			"schedule":  sched,
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
		items := make([]sdk.TimelineItem, 0, len(mp.session.Timeline()))
		for _, entry := range mp.session.Timeline() {
			items = append(items, entry.Item)
		}
		out := scheduledRunOutput(mp.session.LastAssistantText(), items)
		return schedule.ExecutionResult{
			AgentID: &agtID,
			Output:  out,
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
	// A schedule that leaves the run's workspace open asks for inspection; anything else keeps the
	// sidebar clean. Absent means archive, which is also what the runner does for a run with no
	// agent of its own.
	if sched.Target.Config == nil || sched.Target.Config.ArchiveOnFinish == nil || *sched.Target.Config.ArchiveOnFinish {
		s.archiveWorkspaces(ctx, []string{wsID}, time.Now().UTC().Format(time.RFC3339Nano))
	}
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
		// Cursor is the sequence to resume from, for both `before` and `after`. Asking for a
		// window without a cursor means "the end of the timeline".
		Cursor *int `json:"cursor"`
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
		// A cursor restricts the window to one side of it. Without this the two directions behave
		// identically whenever the timeline is shorter than the limit, and a client paging
		// backwards sees the newest rows again instead of the ones before its cursor.
		if req.Cursor != nil && *req.Cursor > 0 && *req.Cursor <= total && dir != "tail" {
			cursor := *req.Cursor
			if dir == "after" {
				rows = rows[cursor:]
				hasOlder = cursor > 0
			} else {
				rows = rows[:cursor]
				hasNewer = true
			}
			total = len(rows)
			minSeq = 0
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
		}
		if len(rows) > 0 {
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

// hostedAppBaseURL is the web app origin that pairs with this build's release channel.
//
// A beta build has to hand out the beta app: the two channels are separate deployments, and a link
// that opens the stable app for a beta daemon sends the tester to a client of the other channel.
// The relay endpoint cannot decide this. Both channels default to the hosted relay, and pointing a
// daemon at another one is an operator choice that says nothing about which app the tester wants.
func hostedAppBaseURL(version string) string {
	if strings.Contains(version, "-") {
		return "https://app-beta.byspace.cc.cd"
	}
	return "https://app.byspace.cc.cd"
}

// normalizeRelayEndpoint fills in the port a bare host implies.
//
// The offer carries `host:port` and the client parses it with parseHostPort, which rejects a bare
// host with `Invalid host:port (expected localhost:6777)`. Operators write `app-beta.byspace.cc.cd`
// in config and on the command line, so the port is filled in rather than demanded.
func normalizeRelayEndpoint(endpoint string, useTLS bool) string {
	ep := strings.TrimSpace(endpoint)
	if ep == "" {
		return ep
	}
	if strings.Contains(ep, "://") {
		// A ws:// or wss:// override names its own scheme and port.
		return ep
	}
	if _, _, err := net.SplitHostPort(ep); err == nil {
		return ep
	}
	host := strings.TrimSuffix(strings.TrimPrefix(ep, "["), "]")
	if host == "" {
		return ep
	}
	port := "80"
	if useTLS {
		port = "443"
	}
	return net.JoinHostPort(host, port)
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
	ep = normalizeRelayEndpoint(ep, useTLS)
	baseURL := strings.TrimSpace(appBaseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv("BYSPACE_APP_BASE_URL"))
	}
	if baseURL == "" {
		baseURL = hostedAppBaseURL(s.version)
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

// storedAppBaseURL reads the app base URL from the daemon config. The daemon stores it flat
// (`appBaseUrl`), while the wire and the node daemon speak `app.baseUrl`; the config snapshot
// maps between them, so both spellings are accepted here.
// StoredAppBaseURL is the app origin this home is configured for.
//
// Exported because the CLI mints pairing offers in-process when no daemon is reachable, and it has
// to name the same origin the running daemon would.
func StoredAppBaseURL(cfg map[string]any) string {
	return storedAppBaseURL(cfg)
}

func storedAppBaseURL(cfg map[string]any) string {
	if v, ok := cfg["appBaseUrl"].(string); ok {
		return strings.TrimSpace(v)
	}
	if app, ok := cfg["app"].(map[string]any); ok {
		if v, ok := app["baseUrl"].(string); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
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
	// A `--relay` flag outranks the stored config: an operator who launched the daemon pointed
	// somewhere means it, and handing out an offer for the stored endpoint would send devices to
	// a relay this daemon is not connected to.
	s.mu.Lock()
	if override := s.relayOverride; override != "" {
		relayCfg.Enabled = true
		relayCfg.Endpoint = override
		relayCfg.PublicEndpoint = override
		relayCfg.UseTLS = s.relayUseTLS || relayEndpointImpliesTLS(override)
		relayCfg.PublicUseTLS = relayCfg.UseTLS
	}
	s.mu.Unlock()
	if !relayCfg.Enabled || strings.TrimSpace(relayCfg.Endpoint) == "" {
		_ = sendSessionMsg(ctx, sink, "daemon.get_pairing_offer.response", map[string]any{
			"requestId":    req.RequestID,
			"url":          "",
			"qr":           nil,
			"relayEnabled": false,
		})
		return
	}

	offerURL := s.BuildPairingOfferURL(relayCfg.ClientRelayEndpoint(), relayCfg.ClientRelayUseTLS(), storedAppBaseURL(s.store.LoadDaemonConfig()))
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

// createWorktreeForAgent creates a BySpace-owned worktree for an agent's requested name.
//
// Returns the new directory, or "" when a worktree already exists there. A failure is not fatal:
// the agent still runs in the requested directory, which is what the caller asked for as a fallback
// and better than refusing to create the agent.
func (s *Server) createWorktreeForAgent(ctx context.Context, repoRoot, name string) (string, error) {
	if strings.TrimSpace(repoRoot) == "" {
		return "", fmt.Errorf("no directory to branch from")
	}
	slug := workspace.NormalizeWorktreeSlug(name)
	if slug == "" {
		return "", fmt.Errorf("worktree name has no usable characters")
	}
	path, _, err := workspace.CreateWorktree(ctx, repoRoot, s.worktreesBaseDir(), slug, "")
	if err != nil {
		return "", err
	}
	return path, nil
}

// worktreesBaseDir is where BySpace-owned worktrees live.
func (s *Server) worktreesBaseDir() string {
	return filepath.Join(s.homeDir, "worktrees")
}

// createWorktreeForIntent branches a worktree according to the client's intent.
//
// The three modes map onto workspace.ResolveWorktreeIntent, which is the same resolver the
// worktree RPCs use: one implementation, so a worktree created by creating an agent and one created
// from the sidebar cannot diverge.
func (s *Server) createWorktreeForIntent(ctx context.Context, repoRoot string, intent *struct {
	Mode      string `json:"mode"`
	NewBranch string `json:"newBranch"`
	Base      string `json:"base"`
	Branch    string `json:"branch"`
	PrNumber  int    `json:"prNumber"`
}) (string, error) {
	if strings.TrimSpace(repoRoot) == "" {
		return "", fmt.Errorf("no directory to branch from")
	}
	slug := workspace.NormalizeWorktreeSlug(intent.NewBranch)
	if slug == "" {
		slug = workspace.NormalizeWorktreeSlug(intent.Branch)
	}
	if slug == "" {
		slug = fmt.Sprintf("pr-%d", intent.PrNumber)
	}

	baseRef := strings.TrimSpace(intent.Base)
	switch intent.Mode {
	case "branch-off":
		if strings.TrimSpace(intent.NewBranch) == "" {
			return "", fmt.Errorf("branch-off needs a new branch name")
		}
	case "checkout-branch":
		if strings.TrimSpace(intent.Branch) == "" {
			return "", fmt.Errorf("checkout-branch needs a branch")
		}
		// An existing branch is the base; the worktree is created on it rather than from it.
		baseRef = intent.Branch
	case "checkout-pr":
		if intent.PrNumber <= 0 {
			return "", fmt.Errorf("checkout-pr needs a pull request number")
		}
		baseRef = fmt.Sprintf("refs/pull/%d/head", intent.PrNumber)
	default:
		return "", fmt.Errorf("unknown worktree mode %q", intent.Mode)
	}

	path, _, err := workspace.CreateWorktree(ctx, repoRoot, s.worktreesBaseDir(), slug, baseRef)
	if err != nil {
		return "", err
	}
	return path, nil
}

// scheduledRunOutput picks what a schedule run reports.
//
// Ported from buildRunOutput: the assistant's last message, then the curated timeline. The fallback
// matters because a turn that produced only tool calls has no assistant text, and reporting nothing
// makes a successful run look like it did not happen. The curated timeline is what tells the user
// which tools ran.
func scheduledRunOutput(lastMessage string, timeline []sdk.TimelineItem) *string {
	if text := strings.TrimSpace(lastMessage); text != "" {
		return &text
	}
	if curated := activity.CurateAgentActivity(timeline, activity.CuratorOptions{}); curated != "No activity to display." {
		trimmed := strings.TrimSpace(curated)
		if trimmed != "" {
			return &trimmed
		}
	}
	return nil
}
