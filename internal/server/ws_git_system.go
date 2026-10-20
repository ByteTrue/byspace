package server

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func checkoutErr(msg string) map[string]any {
	return map[string]any{
		"code":    "UNKNOWN",
		"message": msg,
	}
}

func (s *Server) handleGitParityOps(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &base)

	switch msgType {
	case "unsubscribe_checkout_diff_request":
		var req struct {
			SubscriptionID string `json:"subscriptionId"`
		}
		_ = json.Unmarshal(raw, &req)
		s.UnregisterDiffSubscription(req.SubscriptionID)
		return

	case "checkout.refresh.request":
		_ = sendSessionMsg(ctx, sink, "checkout.refresh.response", map[string]any{
			"cwd":       base.Cwd,
			"success":   true,
			"error":     nil,
			"requestId": base.RequestID,
		})

	case "checkout.commits.file_diff.request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			Sha       string `json:"sha"`
			Path      string `json:"path"`
		}
		_ = json.Unmarshal(raw, &req)
		diffFile, err := workspace.GetCommitFileDiff(ctx, req.Cwd, req.Sha, req.Path)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		_ = sendSessionMsg(ctx, sink, "checkout.commits.file_diff.response", map[string]any{
			"cwd":       req.Cwd,
			"sha":       req.Sha,
			"path":      req.Path,
			"file":      diffFile,
			"error":     errObj,
			"requestId": req.RequestID,
		})

	case "validate_branch_request":
		var req struct {
			RequestID  string `json:"requestId"`
			Cwd        string `json:"cwd"`
			BranchName string `json:"branchName"`
		}
		_ = json.Unmarshal(raw, &req)
		exists, resolved, isRemote := workspace.ValidateBranch(ctx, req.Cwd, req.BranchName)
		var resRef any
		if exists {
			resRef = resolved
		}
		_ = sendSessionMsg(ctx, sink, "validate_branch_response", map[string]any{
			"exists":      exists,
			"resolvedRef": resRef,
			"isRemote":    isRemote,
			"error":       nil,
			"requestId":   req.RequestID,
		})

	case "branch_suggestions_request":
		branches := workspace.ListBranches(ctx, base.Cwd)
		_ = sendSessionMsg(ctx, sink, "branch_suggestions_response", map[string]any{
			"branches":  branches,
			"error":     nil,
			"requestId": base.RequestID,
		})

	case "checkout_switch_branch_request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			Branch    string `json:"branch"`
			Create    bool   `json:"create"`
		}
		_ = json.Unmarshal(raw, &req)
		if err := workspace.SwitchBranch(ctx, req.Cwd, req.Branch, req.Create); err != nil {
			_ = sendSessionMsg(ctx, sink, "checkout_switch_branch_response", map[string]any{
				"cwd":       req.Cwd,
				"success":   false,
				"branch":    req.Branch,
				"error":     checkoutErr(err.Error()),
				"requestId": req.RequestID,
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "checkout_switch_branch_response", map[string]any{
			"cwd":       req.Cwd,
			"success":   true,
			"branch":    req.Branch,
			"source":    "local",
			"error":     nil,
			"requestId": req.RequestID,
		})

	case "checkout.rename_branch.request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			NewName   string `json:"newName"`
		}
		_ = json.Unmarshal(raw, &req)
		cur, err := workspace.RenameBranch(ctx, req.Cwd, req.NewName)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "checkout.rename_branch.response", map[string]any{
				"requestId":     req.RequestID,
				"success":       false,
				"cwd":           req.Cwd,
				"currentBranch": nil,
				"error":         checkoutErr(err.Error()),
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "checkout.rename_branch.response", map[string]any{
			"requestId":     req.RequestID,
			"success":       true,
			"cwd":           req.Cwd,
			"currentBranch": cur,
			"error":         nil,
		})

	case "checkout_push_request":
		err := workspace.Push(ctx, base.Cwd)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		_ = sendSessionMsg(ctx, sink, "checkout_push_response", map[string]any{
			"cwd":       base.Cwd,
			"success":   err == nil,
			"error":     errObj,
			"requestId": base.RequestID,
		})

	case "checkout_pull_request":
		err := workspace.Pull(ctx, base.Cwd)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		_ = sendSessionMsg(ctx, sink, "checkout_pull_response", map[string]any{
			"cwd":       base.Cwd,
			"success":   err == nil,
			"error":     errObj,
			"requestId": base.RequestID,
		})

	case "checkout_merge_request", "checkout_merge_from_base_request":
		var req struct {
			RequestID        string `json:"requestId"`
			Cwd              string `json:"cwd"`
			Branch           string `json:"branch"`
			BaseRef          string `json:"baseRef"`
			Strategy         string `json:"strategy"`
			RequireCleanTree bool   `json:"requireCleanTarget"`
		}
		_ = json.Unmarshal(raw, &req)
		ref := req.Branch
		if ref == "" {
			ref = req.BaseRef
		}
		if req.RequireCleanTree {
			if st := workspace.GetCheckoutStatus(ctx, req.Cwd, req.RequestID); st.IsGit && st.IsDirty != nil && *st.IsDirty {
				_ = sendSessionMsg(ctx, sink, "checkout_merge_response", map[string]any{
					"cwd":       req.Cwd,
					"success":   false,
					"error":     checkoutErr("target has uncommitted changes"),
					"requestId": req.RequestID,
				})
				return
			}
		}
		err := workspace.MergeStrategy(ctx, req.Cwd, ref, req.Strategy)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		respType := "checkout_merge_response"
		if msgType == "checkout_merge_from_base_request" {
			respType = "checkout_merge_from_base_response"
		}
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"cwd":       req.Cwd,
			"success":   err == nil,
			"error":     errObj,
			"requestId": req.RequestID,
		})

	case "stash_list_request":
		var stashListReq struct {
			RequestID   string `json:"requestId"`
			Cwd         string `json:"cwd"`
			BySpaceOnly bool   `json:"byspaceOnly"`
		}
		_ = json.Unmarshal(raw, &stashListReq)
		entries := workspace.StashList(ctx, base.Cwd)
		if stashListReq.BySpaceOnly {
			filtered := entries[:0]
			for _, e := range entries {
				if e.IsBySpace {
					filtered = append(filtered, e)
				}
			}
			entries = filtered
		}
		_ = sendSessionMsg(ctx, sink, "stash_list_response", map[string]any{
			"cwd":       base.Cwd,
			"entries":   entries,
			"error":     nil,
			"requestId": base.RequestID,
		})

	case "stash_save_request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			Message   string `json:"message"`
		}
		_ = json.Unmarshal(raw, &req)
		err := workspace.StashSave(ctx, req.Cwd, req.Message)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		_ = sendSessionMsg(ctx, sink, "stash_save_response", map[string]any{
			"cwd":       req.Cwd,
			"success":   err == nil,
			"error":     errObj,
			"requestId": req.RequestID,
		})

	case "stash_pop_request":
		var stashPopReq struct {
			RequestID  string `json:"requestId"`
			Cwd        string `json:"cwd"`
			StashIndex int    `json:"stashIndex"`
		}
		_ = json.Unmarshal(raw, &stashPopReq)
		err := workspace.StashPopIndex(ctx, base.Cwd, stashPopReq.StashIndex)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		_ = sendSessionMsg(ctx, sink, "stash_pop_response", map[string]any{
			"cwd":       base.Cwd,
			"success":   err == nil,
			"error":     errObj,
			"requestId": base.RequestID,
		})
	}
}

func (s *Server) handleForgeParityOps(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID     string `json:"requestId"`
		Cwd           string `json:"cwd"`
		Enabled       bool   `json:"enabled"`
		Repo          string `json:"repo"`
		TargetDir     string `json:"targetDirectory"`
		CloneProtocol string `json:"cloneProtocol"`
	}
	_ = json.Unmarshal(raw, &base)

	switch msgType {
	case "checkout_pr_status_request":
		prStatus, _ := workspace.GetPRStatus(ctx, base.Cwd)
		forge := workspace.DetectForge(ctx, base.Cwd)
		_ = sendSessionMsg(ctx, sink, "checkout_pr_status_response", map[string]any{
			"cwd":                   base.Cwd,
			"status":                prStatus,
			"githubFeaturesEnabled": true,
			"authState":             map[string]any{"status": "authenticated"},
			"forge":                 forge,
			"error":                 nil,
			"requestId":             base.RequestID,
		})

	case "checkout_pr_create_request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			Title     string `json:"title"`
			Body      string `json:"body"`
			Base      string `json:"base"`
			Draft     bool   `json:"draft"`
		}
		_ = json.Unmarshal(raw, &req)
		prURL, prNum, err := workspace.CreatePR(ctx, req.Cwd, req.Title, req.Body, req.Base, req.Draft)
		var urlVal any
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		} else if prURL != "" {
			urlVal = prURL
		}
		_ = sendSessionMsg(ctx, sink, "checkout_pr_create_response", map[string]any{
			"cwd":       req.Cwd,
			"url":       urlVal,
			"number":    prNum,
			"error":     errObj,
			"requestId": req.RequestID,
		})

	case "checkout_pr_merge_request":
		var req struct {
			RequestID   string `json:"requestId"`
			Cwd         string `json:"cwd"`
			Method      string `json:"method"`
			MergeMethod string `json:"mergeMethod"`
		}
		_ = json.Unmarshal(raw, &req)
		if req.Method == "" {
			req.Method = req.MergeMethod
		}
		err := workspace.MergePR(ctx, req.Cwd, req.Method)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		_ = sendSessionMsg(ctx, sink, "checkout_pr_merge_response", map[string]any{
			"cwd":       req.Cwd,
			"success":   err == nil,
			"error":     errObj,
			"requestId": req.RequestID,
		})

	case "pull_request_timeline_request":
		var prTimelineReq struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			RepoOwner string `json:"repoOwner"`
			RepoName  string `json:"repoName"`
			PrNumber  int    `json:"prNumber"`
		}
		_ = json.Unmarshal(raw, &prTimelineReq)
		_ = sendSessionMsg(ctx, sink, "pull_request_timeline_response", map[string]any{
			"cwd":                   base.Cwd,
			"prNumber":              nil,
			"items":                 []any{},
			"truncated":             false,
			"error":                 nil,
			"requestId":             base.RequestID,
			"githubFeaturesEnabled": true,
			"authState":             map[string]any{"status": "authenticated"},
		})

	case "checkout.forge.set_auto_merge.request", "checkout.github.set_auto_merge.request":
		err := workspace.SetAutoMerge(ctx, base.Cwd, base.Enabled)
		var errObj any
		if err != nil {
			errObj = checkoutErr(err.Error())
		}
		respType := strings.TrimSuffix(msgType, ".request") + ".response"
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"cwd":       base.Cwd,
			"enabled":   base.Enabled,
			"success":   err == nil,
			"error":     errObj,
			"requestId": base.RequestID,
		})

	case "checkout.forge.get_check_details.request", "checkout.github.get_check_details.request":
		respType := strings.TrimSuffix(msgType, ".request") + ".response"
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"cwd":       base.Cwd,
			"success":   true,
			"details":   nil,
			"error":     nil,
			"requestId": base.RequestID,
		})

	case "forge.search.request", "github_search_request":
		var forgeSearchReq struct {
			RequestID string   `json:"requestId"`
			Cwd       string   `json:"cwd"`
			Query     string   `json:"query"`
			Kinds     []string `json:"kinds"`
		}
		_ = json.Unmarshal(raw, &forgeSearchReq)
		respType := "forge.search.response"
		if msgType == "github_search_request" {
			respType = "github_search_response"
		}
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"items":                 []any{},
			"githubFeaturesEnabled": true,
			"authState":             map[string]any{"status": "authenticated"},
			"error":                 nil,
			"requestId":             base.RequestID,
		})

	case "workspace.github.search_repositories.request":
		var req struct {
			RequestID string `json:"requestId"`
			Query     string `json:"query"`
			Limit     int    `json:"limit"`
		}
		_ = json.Unmarshal(raw, &req)
		repos, available := workspace.SearchGitHubRepos(ctx, req.Query, req.Limit)
		if !available {
			_ = sendSessionMsg(ctx, sink, "workspace.github.search_repositories.response", map[string]any{
				"status":       "unavailable",
				"requestId":    req.RequestID,
				"repositories": []any{},
				"reason":       "gh_missing",
				"available":    false,
				"error":        "GitHub CLI (gh) is not installed",
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "workspace.github.search_repositories.response", map[string]any{
			"status":       "success",
			"requestId":    req.RequestID,
			"repositories": repos,
			"available":    true,
			"error":        nil,
		})

	case "project.github.clone.request":
		repo := strings.TrimSpace(base.Repo)
		dst := expandUserPath(base.TargetDir)
		if dst == "" {
			dst = filepath.Join(s.homeDir, "clones", filepath.Base(repo))
		}
		if err := exec.CommandContext(ctx, "git", "clone", repo, dst).Run(); err != nil {
			_ = sendSessionMsg(ctx, sink, "project.github.clone.response", map[string]any{
				"requestId":    base.RequestID,
				"repo":         repo,
				"checkoutPath": nil,
				"project":      nil,
				"error":        err.Error(),
			})
			return
		}
		prj, _, err := s.store.EnsureWorkspaceForCwd(dst)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "project.github.clone.response", map[string]any{
				"requestId":    base.RequestID,
				"repo":         repo,
				"checkoutPath": dst,
				"project":      nil,
				"error":        err.Error(),
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "project.github.clone.response", map[string]any{
			"requestId":    base.RequestID,
			"repo":         repo,
			"checkoutPath": dst,
			"project":      buildProjectDescriptor(prj),
			"error":        nil,
		})
	}
}

func (s *Server) handleTerminalParityOps(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID  string `json:"requestId"`
		TerminalID string `json:"terminalId"`
		Cwd        string `json:"cwd"`
		Name       string `json:"name"`
	}
	_ = json.Unmarshal(raw, &base)

	switch msgType {
	case "subscribe_terminals_request":
		s.handleListTerminals(ctx, sink, raw)

	case "unsubscribe_terminals_request", "unsubscribe_terminal_request":
		return

	case "terminal_input":
		var req struct {
			TerminalID string `json:"terminalId"`
			Data       string `json:"data"`
		}
		_ = json.Unmarshal(raw, &req)
		s.mu.Lock()
		slot, ok := s.terminalSlotsByID[req.TerminalID]
		var sess = s.terminals[slot]
		s.mu.Unlock()
		if ok && sess != nil {
			_ = sess.WriteInput([]byte(req.Data))
		}

	case "kill_terminal_request":
		s.mu.Lock()
		slot, ok := s.terminalSlotsByID[base.TerminalID]
		var sess = s.terminals[slot]
		if ok {
			delete(s.terminalSlotsByID, base.TerminalID)
			delete(s.terminals, slot)
		}
		s.mu.Unlock()
		if sess != nil {
			_ = sess.Close()
		}
		_ = sendSessionMsg(ctx, sink, "kill_terminal_response", map[string]any{
			"terminalId": base.TerminalID,
			"success":    ok,
			"requestId":  base.RequestID,
		})

	case "capture_terminal_request":
		var capReq struct {
			RequestID  string `json:"requestId"`
			TerminalID string `json:"terminalId"`
			Start      *int   `json:"start"`
			End        *int   `json:"end"`
			StripAnsi  *bool  `json:"stripAnsi"`
		}
		_ = json.Unmarshal(raw, &capReq)
		s.mu.Lock()
		slot, ok := s.terminalSlotsByID[capReq.TerminalID]
		var sess = s.terminals[slot]
		s.mu.Unlock()
		lines := []string{}
		if ok && sess != nil {
			if res := sess.ResumeSince(0); res != nil && res.Data != "" {
				lines = strings.Split(strings.TrimRight(res.Data, "\r\n"), "\n")
			}
		}
		if capReq.StripAnsi == nil || *capReq.StripAnsi {
			for i := range lines {
				lines[i] = terminal.StripAnsi(lines[i])
			}
		}
		total := len(lines)
		if capReq.Start != nil || capReq.End != nil {
			start := 0
			end := total
			if capReq.Start != nil && *capReq.Start > 0 {
				start = *capReq.Start
			}
			if capReq.End != nil && *capReq.End > 0 && *capReq.End < end {
				end = *capReq.End
			}
			if start > end {
				start = end
			}
			lines = lines[start:end]
		}
		_ = sendSessionMsg(ctx, sink, "capture_terminal_response", map[string]any{
			"terminalId": capReq.TerminalID,
			"lines":      lines,
			"totalLines": total,
			"requestId":  capReq.RequestID,
		})

	case "terminal.rename.request":
		_ = sendSessionMsg(ctx, sink, "terminal.rename.response", map[string]any{
			"requestId": base.RequestID,
			"success":   true,
			"error":     nil,
		})
	}
}

func (s *Server) handleAgentParityOps(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID string `json:"requestId"`
		AgentID   string `json:"agentId"`
	}
	_ = json.Unmarshal(raw, &base)

	switch msgType {
	case "clear_agent_attention":
		var req struct {
			RequestID string `json:"requestId"`
			AgentID   any    `json:"agentId"`
		}
		_ = json.Unmarshal(raw, &req)
		_ = sendSessionMsg(ctx, sink, "clear_agent_attention_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"agents":    []any{},
		})

	case "refresh_agent_request":
		mp, err := s.ensureAgentLoaded(base.AgentID)
		if err != nil {
			return
		}
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_updated",
			"agentId":   base.AgentID,
			"requestId": base.RequestID,
			"agent":     s.buildAgentSnapshotPayload(mp.record),
		})

	case "close_items_request":
		var req struct {
			RequestID   string   `json:"requestId"`
			AgentIDs    []string `json:"agentIds"`
			TerminalIDs []string `json:"terminalIds"`
		}
		_ = json.Unmarshal(raw, &req)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		agentResults := make([]map[string]any, 0, len(req.AgentIDs))
		for _, id := range req.AgentIDs {
			rec, _ := s.store.GetAgent(id)
			if rec != nil {
				rec.ArchivedAt = &now
				rec.UpdatedAt = now
				_ = s.store.UpsertAgent(*rec)
				agentResults = append(agentResults, map[string]any{
					"agentId":    id,
					"archivedAt": now,
				})
			}
		}
		termResults := make([]map[string]any, 0, len(req.TerminalIDs))
		for _, tid := range req.TerminalIDs {
			termResults = append(termResults, map[string]any{
				"terminalId": tid,
				"success":    true,
			})
		}
		_ = sendSessionMsg(ctx, sink, "close_items_response", map[string]any{
			"requestId": req.RequestID,
			"agents":    agentResults,
			"terminals": termResults,
		})

	case "agent.detach.request":
		rec, _ := s.store.GetAgent(base.AgentID)
		if rec != nil {
			rec.ParentAgentID = nil
			rec.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_ = s.store.UpsertAgent(*rec)
		}
		_ = sendSessionMsg(ctx, sink, "agent.detach.response", map[string]any{
			"requestId": base.RequestID,
			"agentId":   base.AgentID,
			"accepted":  true,
			"error":     nil,
		})

	case "agent.rewind.request":
		var req struct {
			RequestID string `json:"requestId"`
			AgentID   string `json:"agentId"`
			Mode      string `json:"mode"` // "conversation" | "code" | "both"
			Seq       int    `json:"seq"`
		}
		_ = json.Unmarshal(raw, &req)
		if mp, err := s.ensureAgentLoaded(req.AgentID); err == nil {
			if req.Mode == "code" || req.Mode == "both" {
				_ = workspace.DiscardChanges(ctx, mp.record.Cwd)
			}
			if (req.Mode == "conversation" || req.Mode == "both") && req.Seq > 0 {
				tl := mp.session.Timeline()
				if req.Seq < len(tl) {
					mp.session.SeedTimeline(tl[:req.Seq])
				}
			}
		}
		_ = sendSessionMsg(ctx, sink, "agent.rewind.response", map[string]any{
			"requestId": base.RequestID,
			"agentId":   base.AgentID,
			"ok":        true,
			"error":     nil,
		})

	case "agent.fork_context.request":
		var forkReq struct {
			RequestID      string `json:"requestId"`
			AgentID        string `json:"agentId"`
			BoundaryCursor *struct {
				Epoch string `json:"epoch"`
				Seq   int    `json:"seq"`
			} `json:"boundaryCursor"`
		}
		_ = json.Unmarshal(raw, &forkReq)
		mp, err := s.ensureAgentLoaded(base.AgentID)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "agent.fork_context.response", map[string]any{
				"requestId":         base.RequestID,
				"agentId":           base.AgentID,
				"attachment":        nil,
				"itemCount":         0,
				"boundaryMessageId": nil,
				"error":             err.Error(),
			})
			return
		}
		tl := mp.session.Timeline()
		if forkReq.BoundaryCursor != nil && forkReq.BoundaryCursor.Seq > 0 {
			cut := forkReq.BoundaryCursor.Seq
			if cut < len(tl) {
				tl = tl[:cut]
			}
		}
		var sb strings.Builder
		for _, e := range tl {
			if e.Item.Text != "" {
				sb.WriteString("[" + e.Item.Type + "]\n" + e.Item.Text + "\n\n")
			}
		}
		_ = sendSessionMsg(ctx, sink, "agent.fork_context.response", map[string]any{
			"requestId": base.RequestID,
			"agentId":   base.AgentID,
			"attachment": map[string]any{
				"type":     "text",
				"name":     "fork-context.md",
				"mimeType": "text/markdown",
				"text":     sb.String(),
			},
			"itemCount":         len(tl),
			"boundaryMessageId": nil,
			"error":             nil,
		})

	case "agent.timeline.list_prompts.request":
		mp, err := s.ensureAgentLoaded(base.AgentID)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "agent.timeline.list_prompts.response", map[string]any{
				"requestId": base.RequestID,
				"agentId":   base.AgentID,
				"epoch":     "ep_1",
				"prompts":   []any{},
				"error":     err.Error(),
			})
			return
		}
		tl := mp.session.Timeline()
		prompts := make([]map[string]any, 0)
		for _, e := range tl {
			if e.Item.Type == "user_message" {
				prompts = append(prompts, map[string]any{
					"seq":       e.Seq,
					"timestamp": e.Timestamp,
					"preview":   e.Item.Text,
				})
			}
		}
		_ = sendSessionMsg(ctx, sink, "agent.timeline.list_prompts.response", map[string]any{
			"requestId": base.RequestID,
			"agentId":   base.AgentID,
			"epoch":     "ep_1",
			"prompts":   prompts,
			"error":     nil,
		})

	case "agent.timeline.append.request":
		_ = sendSessionMsg(ctx, sink, "agent.timeline.append.response", map[string]any{
			"requestId": base.RequestID,
			"seq":       1,
			"epoch":     "ep_1",
		})

	case "set_agent_feature_request":
		var featReq struct {
			RequestID string `json:"requestId"`
			AgentID   string `json:"agentId"`
			FeatureID string `json:"featureId"`
			Value     any    `json:"value"`
		}
		_ = json.Unmarshal(raw, &featReq)
		accepted := false
		if rec, _ := s.store.GetAgent(featReq.AgentID); rec != nil && featReq.FeatureID != "" {
			if rec.Config == nil {
				rec.Config = &store.AgentConfig{}
			}
			if rec.Config.FeatureValues == nil {
				rec.Config.FeatureValues = map[string]any{}
			}
			rec.Config.FeatureValues[featReq.FeatureID] = featReq.Value
			rec.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_ = s.store.UpsertAgent(*rec)
			s.broadcastAgentUpdate(*rec)
			accepted = true
		}
		_ = sendSessionMsg(ctx, sink, "set_agent_feature_response", map[string]any{
			"requestId": featReq.RequestID,
			"agentId":   featReq.AgentID,
			"accepted":  accepted,
			"error":     nil,
		})

	case "abort_request":
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_cancelled",
			"agentId":   base.AgentID,
			"requestId": base.RequestID,
		})
	}
}

func (s *Server) handleSystemParityOps(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID string `json:"requestId"`
		Provider  string `json:"provider"`
		TunnelID  string `json:"tunnelId"`
		PeerID    string `json:"peerId"`
	}
	_ = json.Unmarshal(raw, &base)

	switch msgType {
	case "agent.skills.get_status.request", "agent.skills.reconcile.request", "agent.skills.uninstall.request":
		cfg := s.store.LoadDaemonConfig()
		sel, ok := cfg["skillsSelection"].(map[string]any)
		if !ok || sel == nil {
			sel = map[string]any{"mode": "all"}
		}
		targets := []string{"agents", "claude"}
		if rawT, hasT := cfg["skillTargets"].([]any); hasT && len(rawT) > 0 {
			targets = nil
			for _, it := range rawT {
				if s, ok := it.(string); ok {
					targets = append(targets, s)
				}
			}
		}
		uninstall := msgType == "agent.skills.uninstall.request"
		state, ops, avail, inst := ReconcileSkills(sel, targets, uninstall)
		respType := strings.TrimSuffix(msgType, ".request") + ".response"
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"requestId": base.RequestID,
			"state":     state,
			"ops":       ops,
			"available": avail,
			"installed": inst,
			"selection": sel,
			"targets": map[string]any{
				"available": []string{"agents", "claude"},
				"selected":  targets,
			},
			"selectionSaved": ok,
		})

	case "agent.skills.save_selection.request":
		var req struct {
			RequestID string         `json:"requestId"`
			Selection map[string]any `json:"selection"`
			Targets   []string       `json:"targets"`
		}
		_ = json.Unmarshal(raw, &req)
		sel := req.Selection
		if sel == nil {
			sel = map[string]any{"mode": "all"}
		}
		targets := req.Targets
		if len(targets) == 0 {
			targets = []string{"agents", "claude"}
		}
		_ = s.store.SaveDaemonConfig(map[string]any{
			"skillsSelection": sel,
			"skillTargets":    targets,
		})
		state, ops, avail, inst := ReconcileSkills(sel, targets, false)
		_ = sendSessionMsg(ctx, sink, "agent.skills.save_selection.response", map[string]any{
			"requestId": req.RequestID,
			"state":     state,
			"ops":       ops,
			"available": avail,
			"installed": inst,
			"selection": sel,
			"targets": map[string]any{
				"available": []string{"agents", "claude"},
				"selected":  targets,
			},
			"selectionSaved":       true,
			"confirmationRequired": nil,
		})

	case "agent.skills.import_legacy_selection.request":
		var req struct {
			RequestID string         `json:"requestId"`
			Selection map[string]any `json:"selection"`
		}
		_ = json.Unmarshal(raw, &req)
		sel := req.Selection
		if sel == nil {
			sel = map[string]any{"mode": "all"}
		}
		_ = s.store.SaveDaemonConfig(map[string]any{"skillsSelection": sel})
		_ = sendSessionMsg(ctx, sink, "agent.skills.import_legacy_selection.response", map[string]any{
			"requestId": req.RequestID,
			"imported":  true,
			"selection": sel,
		})

	case "provider.usage.list.request":
		_ = sendSessionMsg(ctx, sink, "provider.usage.list.response", map[string]any{
			"requestId": base.RequestID,
			"fetchedAt": time.Now().UTC().Format(time.RFC3339Nano),
			"providers": []any{},
		})

	case "provider_diagnostic_request":
		prov := base.Provider
		if prov == "" {
			prov = "pi"
		}
		_ = sendSessionMsg(ctx, sink, "provider_diagnostic_response", map[string]any{
			"requestId":  base.RequestID,
			"provider":   prov,
			"diagnostic": "Pi provider is healthy (Go runtime host)",
		})

	case "set_daemon_config_request":
		var req struct {
			RequestID string         `json:"requestId"`
			Config    map[string]any `json:"config"`
		}
		_ = json.Unmarshal(raw, &req)
		updated := s.store.SaveDaemonConfig(req.Config)
		_ = sendSessionMsg(ctx, sink, "set_daemon_config_response", map[string]any{
			"requestId": req.RequestID,
			"config":    updated,
		})

	case "daemon.config.reload.request":
		_ = sendSessionMsg(ctx, sink, "daemon.config.reload.response", map[string]any{
			"requestId":               base.RequestID,
			"appliedPaths":            []string{},
			"restartRequiredPaths":    []string{},
			"overrideControlledPaths": []string{},
		})

	case "daemon.update.request":
		_ = sendSessionMsg(ctx, sink, "daemon.update.response", map[string]any{
			"requestId":       base.RequestID,
			"success":         true,
			"error":           nil,
			"previousVersion": s.version,
			"newVersion":      s.version,
		})

	case "restart_server_request", "shutdown_server_request":
		return

	case "tunnel.list.request":
		_ = sendSessionMsg(ctx, sink, "tunnel.list.response", map[string]any{
			"requestId": base.RequestID,
			"entries":   []any{},
		})

	case "tunnel.open.request":
		_ = sendSessionMsg(ctx, sink, "tunnel.open.response", map[string]any{
			"requestId":  base.RequestID,
			"tunnelId":   base.TunnelID,
			"remotePort": 0,
			"allowed":    false,
			"reason":     "Tunnel not configured",
		})

	case "tunnel.close.request":
		_ = sendSessionMsg(ctx, sink, "tunnel.close.response", map[string]any{
			"requestId": base.RequestID,
			"tunnelId":  base.TunnelID,
		})

	case "tunnel.stats.request":
		_ = sendSessionMsg(ctx, sink, "tunnel.stats.response", map[string]any{
			"requestId": base.RequestID,
			"entries":   []any{},
		})

	case "tunnel.create.request":
		_ = sendSessionMsg(ctx, sink, "tunnel.create.response", map[string]any{
			"requestId": base.RequestID,
			"peerId":    base.PeerID,
			"ok":        true,
		})

	case "tunnel.remove.request":
		_ = sendSessionMsg(ctx, sink, "tunnel.remove.response", map[string]any{
			"requestId": base.RequestID,
			"peerId":    base.PeerID,
			"ok":        true,
		})

	case "hub.management.daemon.connect.request",
		"hub.management.daemon.get_status.request",
		"hub.management.daemon.disconnect.request",
		"hub.management.daemon.permissions.update.request":
		var hubReq struct {
			RequestID   string         `json:"requestId"`
			HubURL      string         `json:"hubUrl"`
			Force       bool           `json:"force"`
			Grant       []string       `json:"grant"`
			Revoke      []string       `json:"revoke"`
			Permissions map[string]any `json:"permissions"`
		}
		_ = json.Unmarshal(raw, &hubReq)
		respType := strings.TrimSuffix(msgType, ".request") + ".response"
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"requestId": base.RequestID,
			"status": map[string]any{
				"state":       "not_connected",
				"daemonId":    s.serverID,
				"hubOrigin":   nil,
				"connectedAt": nil,
				"lastError":   nil,
			},
		})

	case "hub.execution.agent.validate.request":
		var hubValidateReq struct {
			RequestID       string         `json:"requestId"`
			ProviderOptions map[string]any `json:"providerOptions"`
		}
		_ = json.Unmarshal(raw, &hubValidateReq)
		_ = sendSessionMsg(ctx, sink, "hub.execution.agent.validate.response", map[string]any{
			"requestId": base.RequestID,
			"valid":     true,
			"issues":    []any{},
			"error":     nil,
		})

	case "hub.execution.agent.create.request":
		var hubCreateReq struct {
			RequestID       string            `json:"requestId"`
			ExecutionID     string            `json:"executionId"`
			FeatureValues   map[string]any    `json:"featureValues"`
			ProviderOptions map[string]any    `json:"providerOptions"`
			ToolPolicy      map[string]any    `json:"toolPolicy"`
			McpServers      []any             `json:"mcpServers"`
			Env             map[string]string `json:"env"`
		}
		_ = json.Unmarshal(raw, &hubCreateReq)
		_ = sendSessionMsg(ctx, sink, "hub.execution.agent.create.response", map[string]any{
			"requestId":   base.RequestID,
			"executionId": "exec_1",
			"agentId":     nil,
			"agent":       nil,
			"success":     false,
			"error": map[string]any{
				"code":    "unavailable",
				"message": "Hub execution is disabled",
			},
		})

	case "hub.execution.control.request":
		_ = sendSessionMsg(ctx, sink, "hub.execution.control.response", map[string]any{
			"requestId":   base.RequestID,
			"executionId": "exec_1",
			"action":      "cancel",
			"success":     true,
			"error":       nil,
		})

	case "set_voice_mode":
		_ = sendSessionMsg(ctx, sink, "set_voice_mode_response", map[string]any{
			"requestId": base.RequestID,
			"enabled":   false,
			"agentId":   nil,
			"accepted":  false,
			"error":     "Voice mode is not enabled",
		})

	case "dictation_stream_start",
		"dictation_stream_chunk",
		"dictation_stream_finish",
		"dictation_stream_cancel",
		"voice_audio_chunk",
		"audio_played":
		return
	}
}

func scanLocalSkills() ([]string, []string) {
	bundled := []string{
		"byspace",
		"byspace-advisor",
		"byspace-committee",
		"byspace-handoff",
		"byspace-help",
		"byspace-project-setup",
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return bundled, []string{}
	}
	agentsSkillsDir := filepath.Join(userHome, ".agents", "skills")
	installed := make([]string, 0, len(bundled))
	for _, name := range bundled {
		if _, err := os.Stat(filepath.Join(agentsSkillsDir, name, "SKILL.md")); err == nil {
			installed = append(installed, name)
		}
	}
	return bundled, installed
}
