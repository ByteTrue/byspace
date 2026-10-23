package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/terminal"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func (s *Server) handleFileExplorer(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID    string `json:"requestId"`
		Cwd          string `json:"cwd"`
		Path         string `json:"path"`
		Mode         string `json:"mode"` // "list" | "file"
		AcceptBinary bool   `json:"acceptBinary"`
		MaxBytes     int    `json:"maxBytes"`
	}
	_ = json.Unmarshal(raw, &req)

	relPath := req.Path
	if strings.TrimSpace(relPath) == "" {
		relPath = "."
	}
	cwd := strings.TrimSpace(req.Cwd)
	if cwd == "" {
		_ = sendSessionMsg(ctx, sink, "file_explorer_response", map[string]any{
			"cwd":       req.Cwd,
			"path":      relPath,
			"mode":      req.Mode,
			"directory": nil,
			"file":      nil,
			"error":     "cwd is required",
			"requestId": req.RequestID,
		})
		return
	}

	if req.Mode == "list" {
		dir, err := workspace.ListDirectory(cwd, relPath)
		if err != nil {
			_ = sendSessionMsg(ctx, sink, "file_explorer_response", map[string]any{
				"cwd":       cwd,
				"path":      relPath,
				"mode":      req.Mode,
				"directory": nil,
				"file":      nil,
				"error":     err.Error(),
				"requestId": req.RequestID,
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "file_explorer_response", map[string]any{
			"cwd":       cwd,
			"path":      dir.Path,
			"mode":      req.Mode,
			"directory": dir,
			"file":      nil,
			"error":     nil,
			"requestId": req.RequestID,
		})
		return
	}

	if req.MaxBytes > 0 {
		if info, statErr := os.Stat(filepath.Join(cwd, relPath)); statErr == nil && info.Size() > int64(req.MaxBytes) {
			_ = sendSessionMsg(ctx, sink, "file_explorer_response", map[string]any{
				"cwd":       cwd,
				"path":      relPath,
				"mode":      req.Mode,
				"directory": nil,
				"file":      nil,
				"error":     "file exceeds maxBytes",
				"errorCode": "file_too_large",
				"requestId": req.RequestID,
			})
			return
		}
	}
	fc, err := workspace.ReadFile(cwd, relPath)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "file_explorer_response", map[string]any{
			"cwd":       cwd,
			"path":      relPath,
			"mode":      req.Mode,
			"directory": nil,
			"file":      nil,
			"error":     err.Error(),
			"requestId": req.RequestID,
		})
		return
	}
	// acceptBinary=false means the client cannot render raw bytes: report it as binary
	// without shipping a payload it would choke on.
	if fc.Kind == "binary" && !req.AcceptBinary {
		fc.Content = ""
		fc.Encoding = "none"
	}
	_ = sendSessionMsg(ctx, sink, "file_explorer_response", map[string]any{
		"cwd":       cwd,
		"path":      fc.Path,
		"mode":      req.Mode,
		"directory": nil,
		"file":      fc,
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleFileSubscribe(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID      string `json:"requestId"`
		SubscriptionID string `json:"subscriptionId"`
		Cwd            string `json:"cwd"`
		Path           string `json:"path"`
	}
	_ = json.Unmarshal(raw, &req)
	ver := workspace.StatFileVersion(req.Cwd, req.Path)
	s.RegisterFileSubscription(req.SubscriptionID, sink, req.Cwd, req.Path, ver.Revision)
	_ = sendSessionMsg(ctx, sink, "fs.file.subscribe.response", map[string]any{
		"subscriptionId": req.SubscriptionID,
		"initial":        ver,
		"requestId":      req.RequestID,
	})
}

func (s *Server) handleFileUnsubscribe(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID      string `json:"requestId"`
		SubscriptionID string `json:"subscriptionId"`
	}
	_ = json.Unmarshal(raw, &req)
	s.UnregisterFileSubscription(req.SubscriptionID)
	_ = sendSessionMsg(ctx, sink, "fs.file.unsubscribe.response", map[string]any{
		"subscriptionId": req.SubscriptionID,
		"requestId":      req.RequestID,
	})
}

func (s *Server) handleFileWrite(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID          string `json:"requestId"`
		Cwd                string `json:"cwd"`
		Path               string `json:"path"`
		Content            string `json:"content"`
		ExpectedModifiedAt string `json:"expectedModifiedAt"`
		ExpectedRevision   string `json:"expectedRevision"`
	}
	_ = json.Unmarshal(raw, &req)
	res := workspace.WriteFile(req.Cwd, req.Path, req.Content, req.ExpectedModifiedAt, req.ExpectedRevision)
	_ = sendSessionMsg(ctx, sink, "fs.file.write.response", map[string]any{
		"result":    res,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleFileEntryCreate(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID  string `json:"requestId"`
		Cwd        string `json:"cwd"`
		ParentPath string `json:"parentPath"`
		Name       string `json:"name"`
		Kind       string `json:"kind"`
	}
	_ = json.Unmarshal(raw, &req)
	createdPath, err := workspace.CreateEntry(req.Cwd, req.ParentPath, req.Name, req.Kind)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "fs.entry.create.response", map[string]any{
			"cwd":        req.Cwd,
			"parentPath": req.ParentPath,
			"path":       nil,
			"success":    false,
			"error":      err.Error(),
			"requestId":  req.RequestID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "fs.entry.create.response", map[string]any{
		"cwd":        req.Cwd,
		"parentPath": req.ParentPath,
		"path":       createdPath,
		"success":    true,
		"error":      nil,
		"requestId":  req.RequestID,
	})
}

func (s *Server) handleFileEntryRename(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
		Path      string `json:"path"`
		Name      string `json:"name"`
	}
	_ = json.Unmarshal(raw, &req)
	renamed, err := workspace.RenameEntry(req.Cwd, req.Path, req.Name)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "fs.entry.rename.response", map[string]any{
			"cwd":         req.Cwd,
			"path":        req.Path,
			"renamedPath": nil,
			"success":     false,
			"error":       err.Error(),
			"requestId":   req.RequestID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "fs.entry.rename.response", map[string]any{
		"cwd":         req.Cwd,
		"path":        req.Path,
		"renamedPath": renamed,
		"success":     true,
		"error":       nil,
		"requestId":   req.RequestID,
	})
}

func (s *Server) handleFileEntryDelete(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
		Path      string `json:"path"`
	}
	_ = json.Unmarshal(raw, &req)
	if err := workspace.DeleteEntry(req.Cwd, req.Path); err != nil {
		_ = sendSessionMsg(ctx, sink, "fs.entry.delete.response", map[string]any{
			"cwd":       req.Cwd,
			"path":      req.Path,
			"success":   false,
			"error":     err.Error(),
			"requestId": req.RequestID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "fs.entry.delete.response", map[string]any{
		"cwd":       req.Cwd,
		"path":      req.Path,
		"success":   true,
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleCheckoutStatus(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &req)
	st := workspace.GetCheckoutStatus(ctx, req.Cwd, req.RequestID)
	_ = sendSessionMsg(ctx, sink, "checkout_status_response", st)
}

func (s *Server) handleCheckoutCommitsList(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		Cwd       string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &req)
	baseRef, commits, err := workspace.ListCommits(ctx, req.Cwd, 30)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "checkout.commits.list.response", map[string]any{
			"cwd":       req.Cwd,
			"baseRef":   nil,
			"commits":   []any{},
			"error":     map[string]any{"code": "git_error", "message": err.Error()},
			"requestId": req.RequestID,
		})
		return
	}
	_ = sendSessionMsg(ctx, sink, "checkout.commits.list.response", map[string]any{
		"cwd":       req.Cwd,
		"baseRef":   baseRef,
		"commits":   commits,
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleFetchRecentProviderSessions(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string   `json:"requestId"`
		Cwd       string   `json:"cwd"`
		Limit     int      `json:"limit"`
		Since     string   `json:"since"`
		Providers []string `json:"providers"`
		// Query filters by session title or first message. The import dialog has a search box, and
		// without it every keystroke re-lists everything.
		Query string `json:"query"`
	}
	_ = json.Unmarshal(raw, &req)

	// A provider filter is honoured before listing: asking for claude sessions and getting pi
	// ones is worse than getting nothing.
	if len(req.Providers) > 0 && !containsString(req.Providers, "pi") {
		_ = sendSessionMsg(ctx, sink, "fetch_recent_provider_sessions_response", map[string]any{
			"requestId": req.RequestID,
			"entries":   []any{},
			"error":     nil,
		})
		return
	}

	// A search scans deeper than the page it returns: filtering happens after listing, so scanning
	// only `limit` sessions means a match on the 21st is never found and the search looks broken.
	// 500 is the node daemon's bound — large enough to cover a real history, small enough not to
	// read a directory of thousands of files on every keystroke.
	listLimit := req.Limit
	if strings.TrimSpace(req.Query) != "" && listLimit < importSessionSearchScanLimit {
		listLimit = importSessionSearchScanLimit
	}
	sessions, _ := pi.ListImportableSessions(pi.HistoryOptions{
		SessionDir: s.piSessionDir,
		Cwd:        req.Cwd,
		Limit:      listLimit,
		Since:      req.Since,
	})
	if query := strings.ToLower(strings.TrimSpace(req.Query)); query != "" {
		filtered := sessions[:0]
		for _, session := range sessions {
			if matchesSessionQuery(session, query) {
				filtered = append(filtered, session)
			}
		}
		sessions = filtered
	}

	// A session that is already imported must not appear again: the picker would offer a row that
	// fails (or silently duplicates) when clicked. The count of what was hidden is reported so the
	// user knows the list is filtered rather than short.
	importedHandles, importedErr := s.importedProviderHandles()
	if importedErr != nil {
		importedHandles = map[string]bool{}
	}
	filteredCount := 0

	entries := make([]map[string]any, 0, len(sessions))
	for _, sess := range sessions {
		if importedHandles["pi:"+sess.ProviderHandleID] {
			filteredCount++
			continue
		}
		entries = append(entries, map[string]any{
			"providerId":         "pi",
			"provider":           "pi",
			"providerLabel":      "Pi",
			"providerHandleId":   sess.ProviderHandleID,
			"cwd":                sess.Cwd,
			"title":              sess.Title,
			"firstPromptPreview": sess.FirstPromptPreview,
			"lastPromptPreview":  sess.LastPromptPreview,
			"lastActivityAt":     sess.LastActivityAt,
		})
	}

	if claudeSessions, err := providers.ListClaudeSessions("", req.Cwd, req.Limit); err == nil {
		for _, cs := range claudeSessions {
			if importedHandles["claude:"+cs.ProviderHandleID] {
				filteredCount++
				continue
			}
			entries = append(entries, map[string]any{
				"providerId":         "claude",
				"provider":           "claude",
				"providerLabel":      "Claude Code",
				"providerHandleId":   cs.ProviderHandleID,
				"cwd":                cs.Cwd,
				"title":              cs.Title,
				"firstPromptPreview": cs.FirstPromptPreview,
				"lastPromptPreview":  cs.LastPromptPreview,
				"lastActivityAt":     cs.LastActivityAt,
			})
		}
	}

	_ = sendSessionMsg(ctx, sink, "fetch_recent_provider_sessions_response", map[string]any{
		"requestId": req.RequestID,
		"entries":   entries,
		// The import picker shows "N already imported" beside the list; it was hardcoded to 0 and
		// nothing was filtered, so every previously imported session was offered again.
		"filteredAlreadyImportedCount": filteredCount,
		"providerErrors":               []any{},
		"error":                        nil,
	})
}

func (s *Server) handleImportAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		// `providerId` is the protocol field; `provider` was my own name, so an imported
		// session was always attributed to whatever the daemon defaults to.
		ProviderId string `json:"providerId"`
		Provider   string `json:"provider"`
		// `workspaceId` places the imported agent in the workspace the user picked; dropping it
		// left the agent unattached.
		WorkspaceID      string         `json:"workspaceId"`
		ProviderHandleID string         `json:"providerHandleId"`
		Handle           string         `json:"handle"`
		SessionID        string         `json:"sessionId"`
		Overrides        map[string]any `json:"overrides"`
		Cwd              string         `json:"cwd"`
		// Labels carry relationships the imported session already had — a parent agent id, a
		// role. Dropping them imports the transcript but loses the structure around it, so a
		// subagent comes back as a top-level agent.
		Labels map[string]any `json:"labels"`
	}
	_ = json.Unmarshal(raw, &req)
	if strings.TrimSpace(req.Provider) == "" {
		req.Provider = req.ProviderId
	}

	if strings.TrimSpace(req.ProviderHandleID) == "" {
		req.ProviderHandleID = req.Handle
	}
	if strings.TrimSpace(req.ProviderHandleID) == "" {
		req.ProviderHandleID = req.SessionID
	}
	sessionFile := strings.TrimSpace(req.ProviderHandleID)
	desc, err := pi.ParseSessionFile(sessionFile, time.Now())
	if err != nil || desc == nil {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_create_failed",
			"requestId": req.RequestID,
			"error":     "invalid or missing Pi session file",
		})
		return
	}

	cwd := strings.TrimSpace(req.Cwd)
	if cwd == "" {
		cwd = desc.Cwd
	}
	_, ws, err := s.store.EnsureWorkspaceForCwd(cwd)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_create_failed",
			"requestId": req.RequestID,
			"error":     err.Error(),
		})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	agentID := newAgentID()
	rec := store.AgentRecord{
		ID:          agentID,
		Provider:    "pi",
		Cwd:         cwd,
		WorkspaceID: ws.WorkspaceID,
		CreatedAt:   now,
		UpdatedAt:   desc.LastActivityAt,
		Title:       desc.Title,
		Labels:      importLabels(req.Labels),
		LastStatus:  "idle",
		Config: &store.AgentConfig{
			Model:            desc.Model,
			ThinkingOptionID: desc.ThinkingOptionID,
		},
		Persistence: &store.AgentPersistenceHandle{
			Provider:     "pi",
			SessionID:    sessionFile,
			NativeHandle: sessionFile,
		},
	}

	mp, err := s.startOrGetPiAgent(rec)
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "status", map[string]any{
			"status":    "agent_create_failed",
			"requestId": req.RequestID,
			"error":     err.Error(),
		})
		return
	}

	if historyEntries, err := pi.LoadTimelineFromJSONL(sessionFile); err == nil && len(historyEntries) > 0 {
		mp.session.SeedTimeline(historyEntries)
	}
	_ = s.store.UpsertAgent(mp.record)

	_ = sendSessionMsg(ctx, sink, "status", map[string]any{
		"status":    "agent_created",
		"agentId":   agentID,
		"requestId": req.RequestID,
		"agent":     s.buildAgentSnapshotPayload(mp.record),
	})
}

func (s *Server) handleCreateTerminal(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		Cwd         string `json:"cwd"`
		WorkspaceID string `json:"workspaceId"`
		// AgentID: a terminal opened "for this agent" must start in that agent's cwd, not the
		// daemon's. The client sends it whenever a session tab opens a shell.
		AgentID string   `json:"agentId"`
		Name    string   `json:"name"`
		Command string   `json:"command"`
		Args    []string `json:"args"`
		Size    *struct {
			Rows uint16 `json:"rows"`
			Cols uint16 `json:"cols"`
		} `json:"size"`
	}
	_ = json.Unmarshal(raw, &req)

	cwd := strings.TrimSpace(req.Cwd)
	if cwd == "" && strings.TrimSpace(req.AgentID) != "" {
		if rec, err := s.store.GetAgent(req.AgentID); err == nil && rec != nil {
			cwd = rec.Cwd
		}
	}
	if cwd == "" && strings.TrimSpace(req.WorkspaceID) != "" {
		workspaces, _ := s.store.ListWorkspaces()
		for _, ws := range workspaces {
			if ws.WorkspaceID == req.WorkspaceID {
				cwd = ws.Cwd
				break
			}
		}
	}
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	if abs, err := filepath.Abs(cwd); err == nil {
		cwd = abs
	}

	var rows, cols uint16 = 24, 80
	if req.Size != nil {
		if req.Size.Rows > 0 {
			rows = req.Size.Rows
		}
		if req.Size.Cols > 0 {
			cols = req.Size.Cols
		}
	}

	var b [6]byte
	_, _ = rand.Read(b[:])
	termID := "term_" + hex.EncodeToString(b[:])
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Terminal"
	}

	sess, err := terminal.StartSession(terminal.StartOptions{
		ID:          termID,
		Name:        name,
		Cwd:         cwd,
		WorkspaceID: req.WorkspaceID,
		Command:     req.Command,
		Args:        req.Args,
		Rows:        rows,
		Cols:        cols,
		// Without this the running indicator never moves: the state was tracked but nothing
		// broadcast it, so the sidebar showed every terminal as idle forever.
		//
		// Activity travels inside terminals_changed rather than as its own message, because the
		// client already replaces its terminal list from that payload — a separate event would
		// need a second reducer and could disagree with the list.
		OnActivityChange: func(_state, _attentionReason string) {
			s.broadcastTerminalsChanged(cwd, req.WorkspaceID)
		},
	})
	if err != nil {
		_ = sendSessionMsg(ctx, sink, "create_terminal_response", map[string]any{
			"terminal":  nil,
			"error":     err.Error(),
			"requestId": req.RequestID,
		})
		return
	}

	s.mu.Lock()
	slot := uint8(len(s.terminals))
	s.terminals[slot] = sess
	s.terminalSlotsByID[termID] = slot
	s.mu.Unlock()

	// Persist the tab list so a restart can recreate it, and let other clients see the new tab.
	s.broadcastTerminalsChanged(sess.Cwd, sess.WorkspaceID)

	nowMs := time.Now().UnixMilli()
	_ = sendSessionMsg(ctx, sink, "create_terminal_response", map[string]any{
		"terminal": map[string]any{
			"id":          sess.ID,
			"name":        sess.Name,
			"cwd":         sess.Cwd,
			"workspaceId": sess.WorkspaceID,
			"activity":    map[string]any{"state": sess.Activity(), "changedAt": nowMs},
		},
		"error":     nil,
		"requestId": req.RequestID,
	})
}

func (s *Server) handleListTerminals(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID   string `json:"requestId"`
		Cwd         string `json:"cwd"`
		WorkspaceID string `json:"workspaceId"`
	}
	_ = json.Unmarshal(raw, &req)

	nowMs := time.Now().UnixMilli()
	// Snapshot the list under the lock, then filter outside it: the scope check reads the store.
	s.mu.Lock()
	all := make([]*terminal.Session, 0, len(s.terminals))
	for _, t := range s.terminals {
		all = append(all, t)
	}
	s.mu.Unlock()

	list := make([]map[string]any, 0, len(all))
	for _, t := range all {
		if !s.terminalInScope(t, req.Cwd, req.WorkspaceID) {
			continue
		}
		list = append(list, map[string]any{
			"id":          t.ID,
			"name":        t.Name,
			"cwd":         t.Cwd,
			"workspaceId": t.WorkspaceID,
			"activity":    map[string]any{"state": t.Activity(), "changedAt": nowMs},
		})
	}

	payload := map[string]any{
		"terminals": list,
		"requestId": req.RequestID,
	}
	if req.Cwd != "" {
		payload["cwd"] = req.Cwd
	}
	_ = sendSessionMsg(ctx, sink, "list_terminals_response", payload)
}

// terminalInScope reports whether a terminal belongs to the workspace the caller asked about.
//
// Filtering on workspaceId alone is not enough: unscoped terminals, and ones an older client
// created under a plain cwd, would leak into every list. A workspace owns the terminals whose cwd
// sits at or below its root, and the terminal's own workspaceId must agree when both sides know it.
func (s *Server) terminalInScope(t *terminal.Session, cwd, workspaceID string) bool {
	if workspaceID != "" && t.WorkspaceID != "" && t.WorkspaceID != workspaceID {
		return false
	}
	root := cwd
	if workspaceID != "" {
		if workspaces, err := s.store.ListWorkspaces(); err == nil {
			for _, ws := range workspaces {
				if ws.WorkspaceID == workspaceID {
					root = ws.Cwd
					break
				}
			}
		}
	}
	if root == "" {
		return true
	}
	return pathWithinRoot(root, t.Cwd)
}

// pathWithinRoot reports whether candidate is root or lives below it.
//
// A plain prefix test would treat a repository and the worktree checked out under it as the same
// root, and each would list the other's terminals.
func pathWithinRoot(root, candidate string) bool {
	if root == "" || candidate == "" {
		return false
	}
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func (s *Server) handleSubscribeTerminal(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID       string `json:"requestId"`
		TerminalID      string `json:"terminalId"`
		InitialSnapshot string `json:"initialSnapshot"`
		// `restore` selects how the client catches up: replaying bytes is cheap but can be huge;
		// a snapshot is bounded. Ignoring it meant every reconnect got both.
		Restore *struct {
			Mode            string `json:"mode"` // "live" | "visible-snapshot" | "full-snapshot"
			Resume          *bool  `json:"resume"`
			ScrollbackLines *int   `json:"scrollbackLines"`
			Size            *struct {
				Rows int `json:"rows"`
				Cols int `json:"cols"`
			} `json:"size"`
		} `json:"restore"`
	}
	_ = json.Unmarshal(raw, &req)

	s.mu.Lock()
	slot, ok := s.terminalSlotsByID[req.TerminalID]
	var sess *terminal.Session
	if ok {
		sess = s.terminals[slot]
	}
	s.mu.Unlock()

	if sess == nil {
		_ = sendSessionMsg(ctx, sink, "subscribe_terminal_response", map[string]any{
			"terminalId": req.TerminalID,
			"error":      "Terminal not found",
			"requestId":  req.RequestID,
		})
		return
	}

	_ = sendSessionMsg(ctx, sink, "subscribe_terminal_response", map[string]any{
		"terminalId": req.TerminalID,
		"slot":       slot,
		"error":      nil,
		"requestId":  req.RequestID,
	})

	// Restore mode decides what the client receives; see restorePlan below.
	plan := planTerminalRestore(req.Restore)

	// A client that says it still holds the grid only wants the bytes it missed. Answering with a
	// snapshot would reset the terminal it was trying to keep, which is what `resume` exists to
	// avoid: the client prepends a reset when it renders a snapshot, so a resume that ships one
	// looks identical to a fresh mount.
	if restoreResumes(req.Restore) {
		if delivered, ok := s.terminalDeliveredRevision(sink, req.TerminalID); ok {
			if res := sess.ResumeSince(delivered); res != nil {
				if res.Data != "" {
					_ = sink.SendBinary(ctx, terminal.EncodeFrame(terminal.OpcodeOutput, slot, []byte(res.Data)))
				}
				s.markTerminalDelivered(sink, req.TerminalID, res.Revision)
				plan = terminalRestorePlan{}
			}
		}
	}

	if plan.sendSnapshot && sess.VT() != nil {
		if plan.scrollbackLines > 0 {
			_, snapFrame := sess.VT().SnapshotWithScrollback(slot, plan.scrollbackLines)
			_ = sink.SendBinary(ctx, snapFrame)
		} else {
			_, snapFrame := sess.VT().Snapshot(slot)
			_ = sink.SendBinary(ctx, snapFrame)
		}
	}
	if plan.sendReplay {
		var replay strings.Builder
		if sess.VT() != nil {
			replay.WriteString(sess.VT().ReplayPreamble())
		}
		// A "live" restore resumes from the client's cursor when it has one; otherwise the
		// whole backlog is replayed.
		var res *terminal.Resumption
		if plan.resumeFromRevision > 0 {
			res = sess.ResumeSince(plan.resumeFromRevision)
		} else {
			res = sess.ResumeSince(0)
		}
		if res != nil {
			replay.WriteString(res.Data)
		}
		if replay.Len() > 0 {
			_ = sink.SendBinary(ctx, terminal.EncodeFrame(terminal.OpcodeOutput, slot, []byte(replay.String())))
		}
	}

	// Subscribe returns an unsubscribe func; dropping it is why unsubscribe requests did
	// nothing: every subscribe added another permanent callback, so reopening a terminal
	// doubled its output and a closed one kept receiving frames forever.
	//
	// Output is buffered until the restore frames above have been written by the single sender
	// below: the session's publishers run on their own goroutines, so writing straight from the
	// callback lets a live chunk overtake the backlog it follows.
	var bufMu sync.Mutex
	var buffered []terminal.OutputEvent
	signal := make(chan struct{}, 1)
	unsubscribe, currentRevision := sess.Subscribe(func(ev terminal.OutputEvent) {
		bufMu.Lock()
		buffered = append(buffered, ev)
		bufMu.Unlock()
		select {
		case signal <- struct{}{}:
		default:
		}
	})
	s.markTerminalDelivered(sink, req.TerminalID, currentRevision)
	go func() {
		for range signal {
			for {
				bufMu.Lock()
				batch := buffered
				buffered = nil
				bufMu.Unlock()
				if len(batch) == 0 {
					break
				}
				for _, ev := range batch {
					_ = sink.SendBinary(context.Background(), terminal.EncodeFrame(terminal.OpcodeOutput, slot, ev.Data))
					s.markTerminalDelivered(sink, req.TerminalID, ev.Revision)
				}
			}
		}
	}()
	s.registerTerminalSubscription(sink, req.TerminalID, func() {
		unsubscribe()
		close(signal)
	})
}

// registerTerminalSubscription records how to detach a sink from a terminal's output.
//
// Keyed by sink and terminal id: the same socket may subscribe to the same terminal twice (a
// reconnect before the old one is torn down), and both callbacks must be removable.
func (s *Server) registerTerminalSubscription(sink frameSink, terminalID string, unsubscribe func()) {
	if unsubscribe == nil {
		return
	}
	s.mu.Lock()
	if s.terminalUnsubscribers == nil {
		s.terminalUnsubscribers = make(map[frameSink]map[string][]func())
	}
	byTerminal := s.terminalUnsubscribers[sink]
	if byTerminal == nil {
		byTerminal = make(map[string][]func())
		s.terminalUnsubscribers[sink] = byTerminal
	}
	byTerminal[terminalID] = append(byTerminal[terminalID], unsubscribe)
	s.mu.Unlock()
}

// releaseTerminalSubscriptions detaches a sink from one terminal, or from all when terminalID
// is empty (which is what socket teardown needs).
func (s *Server) releaseTerminalSubscriptions(sink frameSink, terminalID string) {
	s.mu.Lock()
	byTerminal := s.terminalUnsubscribers[sink]
	var toRun []func()
	if terminalID == "" {
		for _, fns := range byTerminal {
			toRun = append(toRun, fns...)
		}
		delete(s.terminalUnsubscribers, sink)
	} else if fns, ok := byTerminal[terminalID]; ok {
		toRun = append(toRun, fns...)
		delete(byTerminal, terminalID)
	}
	s.mu.Unlock()

	for _, fn := range toRun {
		fn()
	}
}

// restoreResumes reports whether the client asked to keep its grid and take only new bytes.
func restoreResumes(restore *struct {
	Mode            string `json:"mode"`
	Resume          *bool  `json:"resume"`
	ScrollbackLines *int   `json:"scrollbackLines"`
	Size            *struct {
		Rows int `json:"rows"`
		Cols int `json:"cols"`
	} `json:"size"`
}) bool {
	return restore != nil && restore.Resume != nil && *restore.Resume
}

// terminalDeliveredRevision reports the last output revision this socket has been sent.
func (s *Server) terminalDeliveredRevision(sink frameSink, terminalID string) (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	revision, ok := s.terminalDelivered[sink][terminalID]
	return revision, ok && revision > 0
}

// markTerminalDelivered records how far this socket has caught up on a terminal.
//
// The cursor outlives the subscription so a reconnect can resume instead of resetting: the
// client keeps its grid across a workspace switch, and a snapshot would clear it.
func (s *Server) markTerminalDelivered(sink frameSink, terminalID string, revision int64) {
	s.mu.Lock()
	if s.terminalDelivered == nil {
		s.terminalDelivered = make(map[frameSink]map[string]int64)
	}
	byTerminal := s.terminalDelivered[sink]
	if byTerminal == nil {
		byTerminal = make(map[string]int64)
		s.terminalDelivered[sink] = byTerminal
	}
	byTerminal[terminalID] = revision
	s.mu.Unlock()
}

// terminalRestorePlan is what a subscribe should deliver.
type terminalRestorePlan struct {
	sendSnapshot       bool
	scrollbackLines    int
	sendReplay         bool
	resumeFromRevision int64
}

// planTerminalRestore applies the protocol's restore modes.
//
// Ported from terminal-restore.ts. The three modes exist because catching up is a trade:
// replaying bytes is exact but unbounded, a snapshot is bounded but loses scrollback fidelity.
//
//	live             — replay bytes only (cheapest; the client already has the grid)
//	visible-snapshot — snapshot bounded to scrollbackLines, plus preamble
//	full-snapshot    — full snapshot plus preamble
//
// No restore field means the historical behaviour: snapshot then replay, which the app used
// for a first mount.
func planTerminalRestore(restore *struct {
	Mode            string `json:"mode"`
	Resume          *bool  `json:"resume"`
	ScrollbackLines *int   `json:"scrollbackLines"`
	Size            *struct {
		Rows int `json:"rows"`
		Cols int `json:"cols"`
	} `json:"size"`
}) terminalRestorePlan {
	if restore == nil {
		return terminalRestorePlan{sendSnapshot: true, sendReplay: true}
	}
	switch restore.Mode {
	case "live":
		// Replay only. `resume` is handled by the caller's cursor; without one the full
		// backlog is replayed, which is still cheaper than snapshot + replay.
		return terminalRestorePlan{sendReplay: true}
	case "visible-snapshot":
		lines := 200
		if restore.ScrollbackLines != nil {
			lines = *restore.ScrollbackLines
			if lines < 0 {
				lines = 0
			}
			if lines > 1000 {
				lines = 1000
			}
		}
		return terminalRestorePlan{sendSnapshot: true, scrollbackLines: lines, sendReplay: true}
	default: // "full-snapshot" or an unknown mode
		return terminalRestorePlan{sendSnapshot: true, sendReplay: true}
	}
}

// importLabels coerces a request's label map.
//
// Values are strings on the wire; anything else is dropped rather than stringified, because a
// non-string label would be a client bug and inventing a representation for it makes the record
// harder to reason about.
func importLabels(raw map[string]any) map[string]string {
	labels := make(map[string]string, len(raw))
	for key, value := range raw {
		if text, ok := value.(string); ok && strings.TrimSpace(key) != "" {
			labels[key] = text
		}
	}
	return labels
}

// releaseTerminalSubscriptionsForScope drops subscriptions whose terminal belongs to a workspace
// or directory.
//
// The plural request carries a scope rather than ids: a closing panel knows which workspace it was
// showing, not which terminal ids it had subscribed to.
func (s *Server) releaseTerminalSubscriptionsForScope(sink frameSink, workspaceID, cwd string) {
	if workspaceID == "" && cwd == "" {
		s.releaseTerminalSubscriptions(sink, "")
		return
	}

	// Collect the terminal ids that belong to the scope, then release those.
	s.mu.Lock()
	var scoped []string
	for _, term := range s.terminals {
		if workspaceID != "" && term.WorkspaceID != workspaceID {
			continue
		}
		if cwd != "" && term.Cwd != cwd {
			continue
		}
		scoped = append(scoped, term.ID)
	}
	s.mu.Unlock()

	for _, id := range scoped {
		s.releaseTerminalSubscriptions(sink, id)
	}
}

// matchesSessionQuery tests a session against a lowercased search term.
//
// The title and both prompt previews are checked: a user searching for a session remembers either
// what they called it or what they asked in it, and checking only the title misses the second.
func matchesSessionQuery(session pi.ImportableSession, query string) bool {
	candidates := []*string{session.Title, session.FirstPromptPreview, session.LastPromptPreview}
	for _, candidate := range candidates {
		if candidate != nil && strings.Contains(strings.ToLower(*candidate), query) {
			return true
		}
	}
	return false
}

// importedProviderHandles returns the set of `provider:handle` pairs that are already imported.
//
// Read from the agent records rather than from a separate table: an imported session becomes an agent
// whose persistence handle records where it came from, so the records are the authority and cannot
// drift from an index.
func (s *Server) importedProviderHandles() (map[string]bool, error) {
	agents, err := s.store.ListAgents()
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(agents))
	for _, agent := range agents {
		if agent.Persistence == nil {
			continue
		}
		handle := strings.TrimSpace(agent.Persistence.SessionID)
		if handle == "" {
			continue
		}
		provider := agent.Provider
		if secret := agent.Persistence.Provider; strings.TrimSpace(secret) != "" {
			provider = secret
		}
		out[provider+":"+handle] = true
		// The native handle records the provider's own id, which is what the picker lists. Both are
		// recorded because a resumed session and an imported one identify the session differently.
		out[provider+":"+fmt.Sprint(agent.Persistence.NativeHandle)] = true
	}
	return out, nil
}

// importSessionSearchScanLimit is how far a session search scans before filtering.
//
// Ported from IMPORT_SESSION_SEARCH_SCAN_LIMIT.
const importSessionSearchScanLimit = 500
