package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/naming"
	"github.com/ByteTrue/byspace/internal/quota"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// CheckoutErrorCode values the protocol accepts.
const (
	CheckoutErrNotGitRepo    = "NOT_GIT_REPO"
	CheckoutErrNotAllowed    = "NOT_ALLOWED"
	CheckoutErrMergeConflict = "MERGE_CONFLICT"
	CheckoutErrUnknown       = "UNKNOWN"
)

// checkoutErr classifies a git failure into the code the protocol carries.
//
// The code is what lets the UI offer the right next step: a merge conflict needs "resolve in your
// editor", a non-repository needs "this is not a git checkout", and neither is a generic failure.
// Everything used to report UNKNOWN, so both looked like an unexplained error.
func checkoutErr(msg string) map[string]any {
	return map[string]any{
		"code":    classifyCheckoutError(msg),
		"message": msg,
	}
}

// classifyCheckoutError maps git's own wording onto the protocol's codes.
func classifyCheckoutError(msg string) string {
	lowered := strings.ToLower(msg)
	switch {
	case strings.Contains(lowered, "not a git repository"),
		strings.Contains(lowered, "not a git repo"):
		return CheckoutErrNotGitRepo
	case strings.Contains(lowered, "would be overwritten"),
		strings.Contains(lowered, "not allowed"),
		strings.Contains(lowered, "refusing to"),
		strings.Contains(lowered, "permission denied"):
		return CheckoutErrNotAllowed
	case strings.Contains(lowered, "merge conflict"),
		strings.Contains(lowered, "conflict"),
		strings.Contains(lowered, "needs merge"),
		strings.Contains(lowered, "unmerged"):
		return CheckoutErrMergeConflict
	default:
		return CheckoutErrUnknown
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
		// Recompute what the caller can see, then answer. Node's refresh invalidates the forge
		// service and re-reads the workspace snapshot with force: the client asking for a
		// refresh is asking for current facts, not an ack of the request. Re-reading the snapshot
		// is what picks up a branch the user switched in a terminal — without it the record keeps
		// the branch it was created on and every list shows a stale name.
		s.refreshWorkspacePlacementAtCwd(ctx, base.Cwd)
		s.broadcastCheckoutStatusUpdate(ctx, base.Cwd)
		s.refreshCheckoutDiffStat(ctx, base.Cwd)
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
		// The picker filters server-side: a repository with thousands of branches cannot ship the
		// whole list on every keystroke, and the client sends what the user typed.
		var suggestReq struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			Query     string `json:"query"`
			Limit     int    `json:"limit"`
		}
		_ = json.Unmarshal(raw, &suggestReq)
		suggestCwd := suggestReq.Cwd
		if strings.TrimSpace(suggestCwd) == "" {
			suggestCwd = base.Cwd
		}
		suggestions := workspace.ListBranchSuggestions(ctx, suggestCwd, suggestReq.Query, suggestReq.Limit)
		branches := make([]string, 0, len(suggestions))
		for _, suggestion := range suggestions {
			branches = append(branches, suggestion.Name)
		}
		_ = sendSessionMsg(ctx, sink, "branch_suggestions_response", map[string]any{
			"branches": branches,
			// The picker labels each row "Local", "Remote" or "Local • Remote" from these two flags, and shows how
			// far the two sides have diverged. Sending an empty list dropped every annotation and, worse, hid any
			// branch that existed only on origin — it was not in `branches` either.
			"branchDetails": suggestions,
			"error":         nil,
			"requestId":     base.RequestID,
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
		s.refreshWorkspacePlacementAtCwd(ctx, req.Cwd)

	case "checkout.rename_branch.request":
		var req struct {
			RequestID string `json:"requestId"`
			Cwd       string `json:"cwd"`
			// The protocol field is `branch`; `newName` was my own invention, so every rename
			// silently renamed the branch to "" (and failed).
			Branch string `json:"branch"`
		}
		_ = json.Unmarshal(raw, &req)
		cur, err := workspace.RenameBranch(ctx, req.Cwd, req.Branch)
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
		// A pull can move remote-tracking branches. Push the new set so an open branch picker
		// does not keep offering a branch that was pruned. `checkout_pull_response` has no
		// field for it, so it travels as a separate update the client already understands.
		if refs, nonRemote, fetchErr := workspace.FetchRemote(ctx, base.Cwd); fetchErr == nil && (len(refs) > 0 || nonRemote) {
			_ = sendSessionMsg(ctx, sink, "branch_suggestions_response", map[string]any{
				"requestId":     base.RequestID,
				"branches":      listLocalBranches(ctx, base.Cwd),
				"branchDetails": []any{},
				"error":         nil,
			})
			s.broadcastCheckoutStatusUpdate(ctx, base.Cwd)
		}
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
			// `branch` is the label the picker shows when restoring; `message` is my own
			// invention and does not exist on the wire.
			Branch  string `json:"branch"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &req)
		label := strings.TrimSpace(req.Branch)
		if label == "" {
			label = req.Message
		}
		err := workspace.StashSave(ctx, req.Cwd, label)
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
		prAuthState := workspace.ProbeForgeAuth(base.Cwd, forge)
		_ = sendSessionMsg(ctx, sink, "checkout_pr_status_response", map[string]any{
			"cwd":    base.Cwd,
			"status": prStatus,
			// The legacy boolean is derived from the richer state rather than hardcoded: a client at the
			// compat floor reads it, and `true` while unauthenticated sends it down a path that fails.
			"githubFeaturesEnabled": prAuthState == workspace.ForgeAuthAuthenticated,
			"authState":             string(prAuthState),
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
			// The protocol field is `baseRef`; reading `base` meant the PR always targeted the
			// repository default instead of the branch the user picked.
			BaseRef string `json:"baseRef"`
			Base    string `json:"base"`
			Draft   bool   `json:"draft"`
		}
		_ = json.Unmarshal(raw, &req)
		baseRef := strings.TrimSpace(req.BaseRef)
		if baseRef == "" {
			baseRef = req.Base
		}

		// A missing title or body is generated from the diff, the way the node daemon does it.
		// Creating a PR with an empty title makes the forge reject it, and an empty body loses
		// the explanation a reviewer needs.
		prTitle := strings.TrimSpace(req.Title)
		prBody := strings.TrimSpace(req.Body)
		if prTitle == "" || prBody == "" {
			if diff, diffErr := workspace.GetDiffSummaryForPrompt(ctx, req.Cwd); diffErr == nil && strings.TrimSpace(diff) != "" {
				genCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
				generated, genErr := naming.PiGenerator{Command: s.piCommand, Model: s.namingModel(), Overrides: naming.ReadProjectOverrides(base.Cwd)}.GeneratePRText(genCtx, diff)
				cancel()
				if genErr == nil {
					if prTitle == "" {
						prTitle = generated.Title
					}
					if prBody == "" {
						prBody = generated.Body
					}
				}
			}
		}
		if prTitle == "" {
			_ = sendSessionMsg(ctx, sink, "checkout_pr_create_response", map[string]any{
				"cwd":       req.Cwd,
				"url":       nil,
				"number":    nil,
				"error":     map[string]any{"code": "title_required", "message": "A pull request title is required"},
				"requestId": req.RequestID,
			})
			return
		}

		prURL, prNum, err := workspace.CreatePR(ctx, req.Cwd, prTitle, prBody, baseRef, req.Draft)
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

		cwd := prTimelineReq.Cwd
		if strings.TrimSpace(cwd) == "" {
			cwd = base.Cwd
		}
		prNumber := prTimelineReq.PrNumber
		if prNumber <= 0 {
			// Fall back to the PR of the current branch rather than returning an empty thread
			// the UI would render as "no discussion yet".
			if pr, prErr := workspace.GetPRStatus(ctx, cwd); prErr == nil && pr != nil {
				if n, ok := pr["number"].(int); ok {
					prNumber = n
				}
			}
		}

		items, truncated, timelineErr := workspace.PullRequestTimeline(
			ctx, workspace.DetectForge(ctx, cwd), cwd, prNumber, 50)
		var timelineErrObj any
		if timelineErr != nil {
			timelineErrObj = checkoutErr(timelineErr.Error())
			items = []map[string]any{}
		} else if items == nil {
			items = []map[string]any{}
		}
		var prNumberPayload any
		if prNumber > 0 {
			prNumberPayload = prNumber
		}
		prAuthState := workspace.ProbeForgeAuth(cwd, workspace.DetectForge(ctx, cwd))
		_ = sendSessionMsg(ctx, sink, "pull_request_timeline_response", map[string]any{
			"cwd":       cwd,
			"prNumber":  prNumberPayload,
			"items":     items,
			"truncated": truncated,
			"error":     timelineErrObj,
			"requestId": base.RequestID,
			// The legacy boolean is derived from the richer state rather than hardcoded: a client at the
			// compat floor reads it, and `true` while unauthenticated sends it down a path that fails.
			"githubFeaturesEnabled": prAuthState == workspace.ForgeAuthAuthenticated,
			"authState":             string(prAuthState),
		})

	case "checkout.forge.set_auto_merge.request", "checkout.github.set_auto_merge.request":
		// `mergeMethod` is optional in the protocol; without it a squash-only repo rejects
		// the merge because this defaulted to --merge.
		var autoMergeReq struct {
			MergeMethod string `json:"mergeMethod"`
		}
		_ = json.Unmarshal(raw, &autoMergeReq)
		err := workspace.SetAutoMerge(ctx, base.Cwd, base.Enabled, autoMergeReq.MergeMethod)
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
		var checkReq struct {
			CheckRunID int `json:"checkRunId"`
		}
		_ = json.Unmarshal(raw, &checkReq)

		// Without this the only thing visible on a failing check is "it failed", which does
		// not say what broke.
		details, checkErr := workspace.CheckDetails(
			ctx, workspace.DetectForge(ctx, base.Cwd), base.Cwd, checkReq.CheckRunID)
		var checkErrObj any
		success := checkErr == nil
		if checkErr != nil {
			checkErrObj = checkoutErr(checkErr.Error())
			details = nil
		}
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"cwd":       base.Cwd,
			"success":   success,
			"details":   details,
			"error":     checkErrObj,
			"requestId": base.RequestID,
		})

	case "forge.search.request", "github_search_request":
		var forgeSearchReq struct {
			RequestID string   `json:"requestId"`
			Cwd       string   `json:"cwd"`
			Query     string   `json:"query"`
			Kinds     []string `json:"kinds"`
			Limit     int      `json:"limit"`
		}
		_ = json.Unmarshal(raw, &forgeSearchReq)
		wantKinds := map[string]bool{}
		for _, k := range forgeSearchReq.Kinds {
			wantKinds[strings.ToLower(k)] = true
		}
		// The panel's search box calls this; answering with a fixed empty list made search look
		// broken. Query the repository's forge and report failures instead of hiding them.
		items, searchErr := workspace.SearchIssuesAndPullRequests(
			ctx, forgeSearchReq.Cwd, forgeSearchReq.Query, forgeSearchReq.Limit, forgeSearchReq.Kinds)
		var searchErrText any
		if searchErr != nil {
			searchErrText = searchErr.Error()
			items = []workspace.ForgeSearchItem{}
		}
		searchAuthState := workspace.ProbeForgeAuth(forgeSearchReq.Cwd, workspace.DetectForge(ctx, forgeSearchReq.Cwd))
		searchPayload := map[string]any{
			"items": items,
			// The legacy boolean is derived from the richer state rather than hardcoded: a client at the
			// compat floor reads it, and `true` while unauthenticated sends it down a path that fails.
			"githubFeaturesEnabled": searchAuthState == workspace.ForgeAuthAuthenticated,
			"authState":             string(searchAuthState),
			"error":                 searchErrText,
			"requestId":             base.RequestID,
		}
		// 两个响应类型分别出现，而不是用 respType 变量派生：静态对账工具要看得见。
		if msgType == "github_search_request" {
			_ = sendSessionMsg(ctx, sink, "github_search_response", searchPayload)
		} else {
			_ = sendSessionMsg(ctx, sink, "forge.search.response", searchPayload)
		}

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
		// `owner/repo` needs a protocol to become a URL; a full remote URL is used as-is.
		// Reading only the repo meant an owner/repo name was passed to git verbatim, which
		// git cannot clone, and the target directory fell back to a daemon-owned path.
		cloneURL, cloneErr := resolveCloneURL(base.Repo, base.CloneProtocol)
		if cloneErr != nil {
			_ = sendSessionMsg(ctx, sink, "project.github.clone.response", map[string]any{
				"requestId":    base.RequestID,
				"repo":         base.Repo,
				"checkoutPath": nil,
				"project":      nil,
				"error":        cloneErr.Error(),
			})
			return
		}
		repo := cloneURL
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
		// Cloning registers a project; Node does not open a workspace for it either.
		prj, err := s.store.FindOrCreateProjectForDirectory(dst)
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
		// `unsubscribe_terminals_request` (plural) drops every subscription for this socket;
		// `unsubscribe_terminal_request` names one terminal.
		var unsubReq struct {
			TerminalID string `json:"terminalId"`
			// The plural form drops every subscription for a workspace or directory, which is what
			// a closing panel needs — it does not track individual terminal ids.
			Cwd         string `json:"cwd"`
			WorkspaceID string `json:"workspaceId"`
		}
		_ = json.Unmarshal(raw, &unsubReq)
		if msgType == "unsubscribe_terminals_request" {
			// Scoped when the client names a workspace or directory: a panel closing should not
			// unsubscribe terminals in a panel that is still open.
			if unsubReq.WorkspaceID != "" || unsubReq.Cwd != "" {
				s.releaseTerminalSubscriptionsForScope(sink, unsubReq.WorkspaceID, unsubReq.Cwd)
			} else {
				s.releaseTerminalSubscriptions(sink, "")
			}
		} else {
			s.releaseTerminalSubscriptions(sink, unsubReq.TerminalID)
		}
		return

	case "terminal_input":
		// The wire shape is `{terminalId, message: {type, data|rows/cols|row/col/...}}` — the
		// payload is a nested client message, not a flat `data`. Reading it flat meant every
		// keystroke, resize and mouse event was silently dropped.
		var req struct {
			TerminalID string `json:"terminalId"`
			Message    *struct {
				Type   string `json:"type"`
				Data   string `json:"data"`
				Rows   uint16 `json:"rows"`
				Cols   uint16 `json:"cols"`
				Row    int    `json:"row"`
				Col    int    `json:"col"`
				Button int    `json:"button"`
				Action string `json:"action"`
				Intent string `json:"intent"`
			} `json:"message"`
			// Older clients sent a flat `data`; a cached bundle that predates the nested
			// shape must still type into the terminal.
			Data string `json:"data"`
		}
		_ = json.Unmarshal(raw, &req)
		s.mu.Lock()
		slot, ok := s.terminalSlotsByID[req.TerminalID]
		var sess = s.terminals[slot]
		s.mu.Unlock()
		if ok && sess != nil && req.Message == nil && req.Data != "" {
			_ = sess.WriteInput([]byte(req.Data))
			return
		}
		if ok && sess != nil && req.Message != nil {
			switch req.Message.Type {
			case "input":
				_ = sess.WriteInput([]byte(req.Message.Data))
			case "resize":
				// Ownership matters when two clients watch one terminal: without it, opening
				// the session on a phone shrinks the desktop shell to phone width.
				owner := sinkOwnerToken(sink)
				intent := terminal.SizeIntent(req.Message.Intent)
				terminal.ApplySize(sess, owner, req.Message.Rows, req.Message.Cols, intent)
			case "mouse":
				// Mouse reporting is opt-in per application; forward as an SGR report so tools
				// that enabled `?1000h`/`?1006h` receive clicks.
				seq := fmt.Sprintf("\x1b[<%d;%d;%d%s", req.Message.Button, req.Message.Col+1, req.Message.Row+1,
					map[string]string{"down": "M", "up": "m", "move": "M"}[req.Message.Action])
				_ = sess.WriteInput([]byte(seq))
			}
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
		allLines := []string{}
		if ok && sess != nil {
			if res := sess.ResumeSince(0); res != nil && res.Data != "" {
				allLines = strings.Split(strings.TrimRight(res.Data, "\r\n"), "\n")
			}
		}
		// Start/end accept negative indices counted from the end, and are clamped rather than
		// erroring: a caller asking for the last 100 lines of a 10-line screen wants the 10.
		stripAnsi := true
		if capReq.StripAnsi != nil {
			stripAnsi = *capReq.StripAnsi
		}
		captured := terminal.CaptureLines(allLines, terminal.CaptureOptions{
			Start:     capReq.Start,
			End:       capReq.End,
			StripANSI: stripAnsi,
		})
		_ = sendSessionMsg(ctx, sink, "capture_terminal_response", map[string]any{
			"terminalId": capReq.TerminalID,
			"lines":      captured.Lines,
			"totalLines": captured.TotalLines,
			"requestId":  capReq.RequestID,
		})

	case "terminal.rename.request":
		// Without reading the name there is nothing to rename to; the response claimed success
		// while the title stayed as it was.
		var renameReq struct {
			TerminalID string `json:"terminalId"`
			Title      string `json:"title"`
		}
		_ = json.Unmarshal(raw, &renameReq)
		name := strings.TrimSpace(renameReq.Title)
		found := false
		cwd, workspaceID := "", ""
		if name != "" {
			s.mu.Lock()
			if slot, ok := s.terminalSlotsByID[renameReq.TerminalID]; ok {
				if session := s.terminals[slot]; session != nil {
					// The title, not the name: `name` is the shell the terminal runs, and the
					// picker still needs it after a rename.
					session.SetTitle(name)
					found = true
					cwd, workspaceID = session.Cwd, session.WorkspaceID
				}
			}
			s.mu.Unlock()
		}
		status := map[string]any{
			"requestId": base.RequestID,
			"success":   found,
			"error":     nil,
		}
		if name == "" {
			status["error"] = "Title is required"
		} else if !found {
			status["error"] = "Terminal not found"
		}
		// Every client renders the tab label from the title, so the rename has to be broadcast
		// rather than only answered — the caller is not necessarily the one showing the tab.
		if found {
			s.broadcastTerminalsChanged(cwd, workspaceID)
		}
		_ = sendSessionMsg(ctx, sink, "terminal.rename.response", status)
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

		// One id or a list; the response echoes the same shape and carries the updated
		// snapshots so the client does not need a follow-up fetch to lose the badge.
		var agentIDs []string
		switch v := req.AgentID.(type) {
		case string:
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				agentIDs = []string{trimmed}
			}
		case []any:
			for _, item := range v {
				if str, ok := item.(string); ok && strings.TrimSpace(str) != "" {
					agentIDs = append(agentIDs, strings.TrimSpace(str))
				}
			}
		}

		agentsPayload := make([]any, 0, len(agentIDs))
		for _, id := range agentIDs {
			s.clearAgentAttention(id)
			if rec, err := s.store.GetAgent(id); err == nil && rec != nil {
				agentsPayload = append(agentsPayload, s.buildAgentSnapshotPayload(*rec))
			}
		}
		_ = sendSessionMsg(ctx, sink, "clear_agent_attention_response", map[string]any{
			"requestId": req.RequestID,
			"agentId":   req.AgentID,
			"agents":    agentsPayload,
		})

	case "refresh_agent_request":
		// Refreshing is the client's "reload this agent from disk" call. Two things the Node daemon
		// did here and this port dropped, both of which the restore flow depends on:
		//
		//   - An archived agent is unarchived first. Restore calls refresh after recreating the
		//     workspace, and the agent was archived together with it; without this the record stays
		//     archived and the row the user just restored is still history.
		//   - Failures are reported. The old code returned silently, so a client waiting for
		//     agent_refreshed hung until its own timeout and the cause never reached the log.
		if unarchived, archiveErr := s.store.UnarchiveAgent(base.AgentID); archiveErr == nil && unarchived != nil {
			s.broadcastAgentUpdate(*unarchived)
		}
		mp, err := s.ensureAgentLoaded(base.AgentID)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "rpc_error", map[string]any{
				"requestId":   base.RequestID,
				"requestType": "refresh_agent_request",
				"error":       err.Error(),
				"code":        "agent_refresh_failed",
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":       "agent_refreshed",
			"agentId":      base.AgentID,
			"requestId":    base.RequestID,
			"timelineSize": len(mp.session.Timeline()),
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
				archived := store.BuildArchivedAgentRecord(*rec, now)
				_ = s.store.UpsertAgent(archived)
				// Closing a tab is an archive: other clients prune the same tab from this update, and a
				// silent store write left the conversation open on every socket but the one that asked.
				s.broadcastAgentUpdate(archived)
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
		// Detaching is a label write, not a field write: the client derives a child's parent from
		// `byspace.parent-agent-id`, so clearing the record field alone left the row in the track.
		// The open-tab markers go too — they exist to keep a child out of its parent's archive
		// cascade, and a detached agent has no parent to be cascaded from.
		if rec, _ := s.store.GetAgent(base.AgentID); rec != nil {
			rec.ParentAgentID = nil
			rec.Labels = mergeLabelPatch(rec.Labels, detachedLabelPatch(rec.Labels))
			rec.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_ = s.store.UpsertAgent(*rec)
			s.broadcastAgentUpdate(*rec)
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
			Mode      string `json:"mode"` // "conversation" | "files" | "both"
			MessageID string `json:"messageId"`
			Seq       int    `json:"seq"`
		}
		_ = json.Unmarshal(raw, &req)
		var rewindErr error
		if mp, err := s.ensureAgentLoaded(req.AgentID); err != nil {
			rewindErr = err
		} else {
			// Files rewind restores the working tree; conversation rewind moves the provider's
			// own conversation branch. Truncating only the in-memory timeline (the previous
			// behaviour) changes nothing in the provider and is lost on the next hydration.
			// The wire mode is "files", matching AgentRewindModeSchema; checking a "code" value
			// the protocol never sends made a files-only rewind a silent no-op that still
			// reported ok.
			if req.Mode == "files" || req.Mode == "both" {
				if err := workspace.DiscardChanges(ctx, mp.record.Cwd); err != nil {
					rewindErr = err
				}
			}
			if rewindErr == nil && (req.Mode == "conversation" || req.Mode == "both") {
				target := strings.TrimSpace(req.MessageID)
				if target == "" && req.Seq > 0 {
					// Older clients send a cursor; map it to the message at that position.
					tl := dedupeSubmittedPrompts(mp.session.Timeline())
					for i := len(tl) - 1; i >= 0; i-- {
						if tl[i].Seq <= req.Seq && tl[i].Item.Type == "user_message" {
							target = tl[i].Item.Text
							break
						}
					}
				}
				if target == "" {
					rewindErr = fmt.Errorf("rewind needs a message id")
				} else if s.isUnacknowledgedSubmittedPrompt(mp.session, mp.record.ID, target) {
					// The daemon wrote this row when the prompt was submitted; the provider has not
					// echoed it back, so it has no checkpoint for the turn. Node refuses with this exact
					// wording, and the client shows it as-is.
					rewindErr = fmt.Errorf("Cannot rewind before the provider acknowledges the submitted prompt")
				} else if err := s.rewindConversation(ctx, mp, target); err != nil {
					rewindErr = err
				}
			}
		}
		var errText any
		ok := rewindErr == nil
		if rewindErr != nil {
			errText = rewindErr.Error()
		}
		_ = sendSessionMsg(ctx, sink, "agent.rewind.response", map[string]any{
			"requestId": base.RequestID,
			"agentId":   base.AgentID,
			"ok":        ok,
			"error":     errText,
		})

	case "agent.fork_context.request":
		var forkReq struct {
			RequestID         string `json:"requestId"`
			AgentID           string `json:"agentId"`
			BoundaryMessageID string `json:"boundaryMessageId"`
			BoundaryCursor    *struct {
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
				"boundaryCursor":    nil,
				"error":             err.Error(),
			})
			return
		}
		// The boundary the client sends came from fetch_agent_timeline_response, which stamps cursors
		// with s.epoch — not currentTimelineEpoch(), a separate field with a different value. Validating
		// against the wrong one would reject every boundary as stale.
		agentTitle := ""
		if mp.record.Title != nil {
			agentTitle = *mp.record.Title
		}
		var cursor *forkCursorBoundary
		if forkReq.BoundaryCursor != nil {
			cursor = &forkCursorBoundary{Epoch: forkReq.BoundaryCursor.Epoch, Seq: forkReq.BoundaryCursor.Seq}
		}
		result, forkErr := buildForkContextAttachment(mp.session.Timeline(), cursor, forkReq.BoundaryMessageID, s.epoch, agentTitle, mp.record.Cwd)
		if forkErr != nil {
			_ = sendSessionMsg(ctx, sink, "agent.fork_context.response", map[string]any{
				"requestId":         base.RequestID,
				"agentId":           base.AgentID,
				"attachment":        nil,
				"itemCount":         0,
				"boundaryMessageId": nil,
				"boundaryCursor":    nil,
				"error":             forkErr.Error(),
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "agent.fork_context.response", map[string]any{
			"requestId":         base.RequestID,
			"agentId":           base.AgentID,
			"attachment":        result.Attachment,
			"itemCount":         result.ItemCount,
			"boundaryMessageId": result.BoundaryMessageID,
			"boundaryCursor":    result.BoundaryCursor,
			"error":             nil,
		})

	case "agent.timeline.list_prompts.request":
		mp, err := s.ensureAgentLoaded(base.AgentID)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "agent.timeline.list_prompts.response", map[string]any{
				"requestId": base.RequestID,
				"agentId":   base.AgentID,
				"epoch":     s.currentTimelineEpoch(),
				"prompts":   []any{},
				"error":     err.Error(),
			})
			return
		}
		tl := dedupeSubmittedPrompts(mp.session.Timeline())
		prompts := make([]map[string]any, 0)
		for _, e := range tl {
			if e.Item.Type == "user_message" {
				prompts = append(prompts, map[string]any{
					"seq":       e.Seq,
					"timestamp": e.Timestamp,
					"preview":   promptPreview(e.Item.Text),
				})
			}
		}
		_ = sendSessionMsg(ctx, sink, "agent.timeline.list_prompts.response", map[string]any{
			"requestId": base.RequestID,
			"agentId":   base.AgentID,
			"epoch":     s.currentTimelineEpoch(),
			"prompts":   prompts,
			"error":     nil,
		})

	case "agent.timeline.append.request":
		// The only thing this message can carry is `item.type: "plugin"` — the plugin system was
		// retired by decision (issue 025, a5c6bb6588), so there is nothing to append. The fields
		// are parsed anyway: an old client sending this must get a well-formed answer rather than
		// a dropped message, and seq 0 with the current epoch says plainly that nothing was added.
		var appendReq struct {
			RequestID string          `json:"requestId"`
			AgentID   string          `json:"agentId"`
			Item      json.RawMessage `json:"item"`
		}
		_ = json.Unmarshal(raw, &appendReq)
		epoch := s.currentTimelineEpoch()
		seq := 0
		if record := s.findAgentRecord(appendReq.AgentID); record != nil {
			seq = s.timelineHeadSeq(appendReq.AgentID)
		}
		_ = sendSessionMsg(ctx, sink, "agent.timeline.append.response", map[string]any{
			"requestId": appendReq.RequestID,
			"seq":       seq,
			"epoch":     epoch,
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
		sourceDir := resolveSkillsSourceDir()
		userHome, homeErr := os.UserHomeDir()
		if homeErr != nil {
			userHome = ""
		}
		status := getSkillsStatus(sourceDir, userHome, sel, targets)
		var applyErr any
		if msgType != "agent.skills.get_status.request" {
			// A failed install must reach the user: the status below would otherwise describe
			// a selection the disk does not have, and the UI would show "up to date".
			if err := applySkillsStatus(sourceDir, userHome, status); err != nil {
				applyErr = err.Error()
			}
			status = getSkillsStatus(sourceDir, userHome, sel, targets)
		}
		respType := strings.TrimSuffix(msgType, ".request") + ".response"
		_ = sendSessionMsg(ctx, sink, respType, map[string]any{
			"requestId":      base.RequestID,
			"state":          status.State,
			"ops":            status.Ops,
			"available":      status.Available,
			"installed":      status.Installed,
			"selection":      sel,
			"targets":        status.Targets,
			"selectionSaved": ok,
			"error":          applyErr,
		})

	case "agent.skills.save_selection.request":
		var req struct {
			RequestID string         `json:"requestId"`
			Selection map[string]any `json:"selection"`
			Targets   []string       `json:"targets"`
			// ConfirmedRemovals is what the user agreed to delete. A save that would remove managed
			// directories the request did not name is refused with the list, so the question and the
			// deletion cannot drift apart.
			ConfirmedRemovals []string `json:"confirmedRemovals"`
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
		sourceDir := resolveSkillsSourceDir()
		userHome, _ := os.UserHomeDir()

		// Narrowing the install targets deletes the copies in the dropped homes. Ask first: the directories can
		// contain files the user put there, and the client can only show the question if the daemon names the
		// skills. Answering with a plan means nothing is deleted yet.
		pending := getSkillsStatus(sourceDir, userHome, sel, targets)
		if removals := unconfirmedRemovals(pending.Ops, req.ConfirmedRemovals); len(removals) > 0 {
			_ = sendSessionMsg(ctx, sink, "agent.skills.save_selection.response", map[string]any{
				"requestId":            req.RequestID,
				"state":                pending.State,
				"ops":                  pending.Ops,
				"available":            pending.Available,
				"installed":            pending.Installed,
				"selection":            sel,
				"targets":              pending.Targets,
				"selectionSaved":       true,
				"confirmationRequired": map[string]any{"removals": removals},
				"error":                nil,
			})
			return
		}

		// Copy first, record second. A failure after the record was written would leave the daemon advertising a
		// selection it never installed — and the client renders that record back as the current choice.
		if err := applySkillsStatus(sourceDir, userHome, pending); err != nil {
			// The save failed, so the request failed. A response carrying an `error` field would look like
			// success to the client — it resolves on the response type and never reads the field, so the
			// failure would surface as a silently unchanged selection. `rpc_error` is what makes the caller's
			// promise reject, which is how node's HTTP failure reaches the UI.
			_ = sendSessionMsg(ctx, sink, "rpc_error", map[string]any{
				"requestId":   req.RequestID,
				"requestType": "agent.skills.save_selection.request",
				"error":       err.Error(),
				"code":        "skills_save_failed",
			})
			return
		}
		_ = s.store.SaveDaemonConfig(map[string]any{
			"skillsSelection": sel,
			"skillTargets":    targets,
		})
		status := getSkillsStatus(sourceDir, userHome, sel, targets)
		_ = sendSessionMsg(ctx, sink, "agent.skills.save_selection.response", map[string]any{
			"requestId":            req.RequestID,
			"state":                status.State,
			"ops":                  status.Ops,
			"available":            status.Available,
			"installed":            status.Installed,
			"selection":            sel,
			"targets":              status.Targets,
			"selectionSaved":       true,
			"confirmationRequired": nil,
		})

	case "agent.skills.import_legacy_selection.request":
		var req struct {
			RequestID string         `json:"requestId"`
			Selection map[string]any `json:"selection"`
			// Targets absent means "keep the current ones", so an app that predates target selection cannot
			// silently narrow an install. Present means the user changed where copies go.
			Targets           *[]string `json:"targets"`
			ConfirmedRemovals []string  `json:"confirmedRemovals"`
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
		// An empty array made the Usage page look like "you have no quotas"; a provider that
		// cannot be read reports "unavailable" so the two cases stay distinguishable.
		providers := quota.FetchAll(ctx)
		_ = sendSessionMsg(ctx, sink, "provider.usage.list.response", map[string]any{
			"requestId": base.RequestID,
			"fetchedAt": time.Now().UTC().Format(time.RFC3339Nano),
			"providers": providers,
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
		// The wire carries the plaintext password and reads back a derived boolean; the file
		// carries the bcrypt hash. Translating here keeps the two apart — persisting the plaintext
		// would leave the password in a readable file, and echoing the hash would hand every
		// client a copy of it.
		passwordHash, applyAuth, hashErr := takeDaemonAuthPatch(req.Config)
		// Validated on write so a malformed entry is reported next to the edit that caused it,
		// rather than failing later where the message says nothing about the settings.
		if hashErr != nil {
			_ = sendSessionMsg(ctx, sink, "set_daemon_config_response", map[string]any{
				"requestId": req.RequestID,
				"config":    s.store.LoadDaemonConfig(),
				"error":     hashErr.Error(),
			})
			return
		}
		if validationErr := store.ValidateDaemonConfigForProviders(req.Config, providers.ServedProviderIDs()); validationErr != nil {
			fmt.Fprintf(os.Stderr, "daemon config rejected: %v\n", validationErr)
			_ = sendSessionMsg(ctx, sink, "set_daemon_config_response", map[string]any{
				"requestId": req.RequestID,
				"config":    s.store.LoadDaemonConfig(),
				"error":     validationErr.Error(),
			})
			return
		}
		if applyAuth {
			if err := s.store.SetDaemonPasswordHash(passwordHash); err != nil {
				fmt.Fprintf(os.Stderr, "daemon config rejected: %v\n", err)
				_ = sendSessionMsg(ctx, sink, "set_daemon_config_response", map[string]any{
					"requestId": req.RequestID,
					"config":    s.store.LoadDaemonConfig(),
					"error":     err.Error(),
				})
				return
			}
		}
		updated := s.store.SaveDaemonConfig(req.Config)
		_ = sendSessionMsg(ctx, sink, "set_daemon_config_response", map[string]any{
			"requestId": req.RequestID,
			"config":    updated,
		})
		// Every other open client has to learn about the edit: Node broadcasts a
		// `status: daemon_config_changed` frame from its config-apply path. Without it a page
		// that was loaded before the write keeps rendering the settings it read once — the
		// new-workspace launch menu kept offering a terminal profile another client had just
		// deleted, and the settings sheet showed edits that never happened.
		s.broadcastSessionMsg("status", map[string]any{
			"status": "daemon_config_changed",
			"config": updated,
		})
		// A providers edit changes the catalog every open settings sheet renders. Node pushes the
		// rebuilt snapshot from its config-apply listeners; without it the removed provider stays
		// on screen until the next manual refresh.
		if patchTouchesProviders(req.Config) {
			// A providers edit invalidates every scope, not just the host catalog: the same entry
			// decides availability in each workspace catalog too, and those carry their own cache.
			s.invalidateProviderCatalogs()
			s.pushProviderSnapshot(ctx, updated, nil, "")
		}

	case "daemon.config.reload.request":
		// Report what actually took effect. Three empty lists told the settings page nothing:
		// it could not distinguish "applied", "needs a restart" and "the environment owns
		// this setting, your edit is ignored".
		next := s.daemonConfigSnapshot()
		changed := diffConfigPaths(s.lastConfigSnapshot, next)
		s.lastConfigSnapshot = next
		report := configReloadReport(s.lastConfigSnapshot, next, changed)
		// Settings that drive live behaviour are re-read from disk on each use, so a reload
		// only needs to drop the caches that memoise them.
		s.corsMu.Lock()
		s.corsCache = nil
		s.corsMu.Unlock()
		s.mu.Lock()
		s.allowedHostnames = resolveAllowedHostnames(s.store)
		s.mu.Unlock()
		// The relay is the one setting that must actually act on change: it holds a live
		// connection, and reporting "applied" without connecting would be a lie.
		s.ApplyRelayConfig(ctx)
		_ = sendSessionMsg(ctx, sink, "daemon.config.reload.response", map[string]any{
			"requestId":               base.RequestID,
			"appliedPaths":            report["appliedPaths"],
			"restartRequiredPaths":    report["restartRequiredPaths"],
			"overrideControlledPaths": report["overrideControlledPaths"],
		})

	case "daemon.update.request":
		s.handleDaemonUpdate(ctx, sink, raw)

	case "restart_server_request", "shutdown_server_request":
		// The reason is what the daemon logs before exiting. It used to be dropped along with the
		// whole request: the client showed no reaction at all, so restarting from the app looked
		// broken.
		var controlReq struct {
			RequestID string `json:"requestId"`
			Reason    string `json:"reason"`
		}
		_ = json.Unmarshal(raw, &controlReq)
		reason := controlReq.Reason
		if reason == "" {
			reason = "requested by a client"
		}
		fmt.Fprintf(os.Stderr, "daemon control: %s\n", reason)
		s.requestShutdown(reason)
		return

	case "tunnel.list.request":
		s.handleTunnelList(ctx, sink, base.RequestID)

	case "tunnel.open.request":
		s.handleTunnelOpen(ctx, sink, raw)

	case "tunnel.close.request":
		s.handleTunnelClose(ctx, sink, raw)

	case "tunnel.stats.request":
		s.handleTunnelStats(ctx, sink, base.RequestID)

	case "tunnel.create.request":
		s.handleTunnelCreate(ctx, sink, raw)

	case "tunnel.remove.request":
		s.handleTunnelRemove(ctx, sink, raw)

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
		// Hub 远程托管尚未实现：如实报告未连接，不伪造已连状态。
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
			// The client distinguishes "this build has no voice" from "retry might work" and
			// lists which models are missing, so the refusal has to carry all three.
			"reasonCode":      "voice_unsupported",
			"retryable":       false,
			"missingModelIds": []string{},
			"error":           "Voice mode is not enabled",
		})

	case "dictation_stream_start",
		"dictation_stream_chunk",
		"dictation_stream_finish",
		"dictation_stream_cancel",
		"voice_audio_chunk",
		"audio_played":
		// The client reports that it finished playing a spoken reply. Voice was removed by
		// decision (issue 025, 8d96875115), so nothing is recorded — but the id is logged, which
		// is the only honest use of it: it confirms the client and daemon agree on the protocol
		// version, and it is where a future voice feature would pick up.
		var audioReq struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &audioReq)
		fmt.Fprintf(os.Stderr, "audio_played id=%s (voice is not implemented in this build)\n", audioReq.ID)
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

// rewindConversation asks the provider to move its conversation branch back to a message.
//
// The client identifies the message by text or id; pi navigates by its own tree entry id, which
// the integration extension captured. Returns a clear error when the mapping is missing rather
// than silently doing nothing.
func (s *Server) rewindConversation(ctx context.Context, mp *managedPi, target string) error {
	rw, ok := mp.session.(interface {
		RewindConversation(context.Context, string) error
		TreeEntryForMessage(string) (string, bool)
	})
	if !ok {
		return fmt.Errorf("provider %s does not support conversation rewind", mp.record.Provider)
	}
	entryID := target
	if resolved, found := rw.TreeEntryForMessage(target); found {
		entryID = resolved
	}
	if err := rw.RewindConversation(ctx, entryID); err != nil {
		return err
	}
	// The provider owns its timeline: RewindConversation already dropped the rows after the target,
	// so there is nothing to reconcile here beyond telling clients the history moved.
	// A rewind rewrites history: everything after the target is gone and the rows that follow carry
	// seq numbers that no longer continue the client's cursor. A client that keeps its cursor would
	// treat every later row as a gap, drop it, and leave the prompt it just sent without a messageId
	// — so the rewind trigger never appears on it. Node broadcasts agent.timeline.replacement for
	// exactly this case; the client answers by refetching the tail.
	s.broadcastSessionMsg("agent.timeline.replacement", map[string]any{
		"agentId": mp.record.ID,
		"epoch":   s.epoch,
	})
	return nil
}

// validRepoSegment matches a GitHub owner or repository name.
var validRepoSegment = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// resolveCloneURL turns the request's `repo` into something git can clone.
//
// Ported from resolveGithubCloneTarget in session.ts. An `owner/repo` shorthand has no scheme,
// so it needs the chosen protocol; a full remote URL is already complete. Validating the
// segments matters because the value is interpolated into a URL passed to git.
func resolveCloneURL(rawRepo, protocol string) (string, error) {
	trimmed := strings.TrimSpace(rawRepo)
	if trimmed == "" {
		return "", fmt.Errorf("repository is required")
	}
	// A remote URL (https://…, git@host:…, ssh://…) is used verbatim.
	if strings.Contains(trimmed, "://") || strings.HasPrefix(trimmed, "git@") {
		return trimmed, nil
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 {
		return "", fmt.Errorf("repository must use owner/repo format or be a git remote URL")
	}
	owner := parts[0]
	name := strings.TrimSuffix(parts[1], ".git")
	if !validRepoSegment.MatchString(owner) || !validRepoSegment.MatchString(name) {
		return "", fmt.Errorf("repository contains invalid characters")
	}
	switch protocol {
	case "ssh":
		return fmt.Sprintf("git@github.com:%s/%s.git", owner, name), nil
	case "https":
		return fmt.Sprintf("https://github.com/%s/%s.git", owner, name), nil
	default:
		// The client always sends one; refusing keeps an ambiguous name from becoming a path.
		return "", fmt.Errorf("clone protocol is required for owner/repo repository names")
	}
}

// sinkOwnerToken identifies the connection that owns a terminal's size.
//
// The sink itself is the natural token: it is unique per connection and stable for its
// lifetime, so "the client that claimed this terminal" survives multiple resize updates from
// that same client.
func sinkOwnerToken(sink frameSink) string {
	return fmt.Sprintf("sink:%p", sink)
}

// listLocalBranches returns the repository's local branch names.
func listLocalBranches(ctx context.Context, cwd string) []string {
	branches := workspace.ListBranches(ctx, cwd)
	if branches == nil {
		return []string{}
	}
	return branches
}

// currentTimelineEpoch returns the process-level timeline epoch.
//
// The epoch changes on every daemon start, which is how a client knows its cached sequence numbers
// are stale: sequences restart at zero with the process. It is set once at construction and never
// mutated, so reading it needs no lock — which also makes this safe to call from a handler that
// already holds s.mu.
func (s *Server) currentTimelineEpoch() string {
	return s.epoch
}

// timelineHeadSeq reports the next sequence a timeline would assign.
//
// Zero for an unknown agent rather than a guess: a fabricated head would make the client believe it
// had a position it does not.
func (s *Server) timelineHeadSeq(agentID string) int {
	s.mu.Lock()
	mp := s.agents[agentID]
	s.mu.Unlock()
	if mp == nil || mp.session == nil {
		return 0
	}
	return len(mp.session.Timeline())
}

// findAgentRecord reads an agent record without loading its runtime.
func (s *Server) findAgentRecord(agentID string) *store.AgentRecord {
	record, err := s.store.GetAgent(agentID)
	if err != nil {
		return nil
	}
	return record
}

// filterBranches applies the picker's query and limit.
//
// Matching is case-insensitive substring on the branch name, which is what a user expects when
// typing "feat" or "log". An empty query keeps everything; a non-positive limit means no cap.
func filterBranches(branches []string, query string, limit int) []string {
	needle := strings.ToLower(strings.TrimSpace(query))
	out := make([]string, 0, len(branches))
	for _, branch := range branches {
		if needle != "" && !strings.Contains(strings.ToLower(branch), needle) {
			continue
		}
		out = append(out, branch)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// promptPreviewMaxLen mirrors node's PROMPT_PREVIEW_MAX_LENGTH.
const promptPreviewMaxLen = 120

// promptPreview collapses a prompt to one line for the chat outline rail, matching node's
// timeline-prompt-index: whitespace runs fold to a single space, the result trims, and anything over
// 120 characters is cut to 119 with an ellipsis. Counting runes rather than bytes keeps a multibyte
// character from being sliced in half at the boundary.
func promptPreview(text string) string {
	collapsed := strings.Join(strings.Fields(text), " ")
	runes := []rune(collapsed)
	if len(runes) <= promptPreviewMaxLen {
		return collapsed
	}
	return string(runes[:promptPreviewMaxLen-1]) + "…"
}
