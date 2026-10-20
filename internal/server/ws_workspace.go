package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
	}
	_ = json.Unmarshal(raw, &req)

	sessions, _ := pi.ListImportableSessions(pi.HistoryOptions{
		SessionDir: s.piSessionDir,
		Cwd:        req.Cwd,
		Limit:      req.Limit,
		Since:      req.Since,
	})

	entries := make([]map[string]any, 0, len(sessions))
	for _, sess := range sessions {
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
	})
}

func (s *Server) handleImportAgent(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID        string         `json:"requestId"`
		Provider         string         `json:"provider"`
		ProviderHandleID string         `json:"providerHandleId"`
		Handle           string         `json:"handle"`
		Overrides        map[string]any `json:"overrides"`
		Cwd              string         `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &req)

	if strings.TrimSpace(req.ProviderHandleID) == "" {
		req.ProviderHandleID = req.Handle
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
		Labels:      map[string]string{},
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
		RequestID   string   `json:"requestId"`
		Cwd         string   `json:"cwd"`
		WorkspaceID string   `json:"workspaceId"`
		Name        string   `json:"name"`
		Command     string   `json:"command"`
		Args        []string `json:"args"`
		Size        *struct {
			Rows uint16 `json:"rows"`
			Cols uint16 `json:"cols"`
		} `json:"size"`
	}
	_ = json.Unmarshal(raw, &req)

	cwd := strings.TrimSpace(req.Cwd)
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
	s.mu.Lock()
	list := make([]map[string]any, 0, len(s.terminals))
	for _, t := range s.terminals {
		if req.WorkspaceID != "" && t.WorkspaceID != "" && t.WorkspaceID != req.WorkspaceID {
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
	s.mu.Unlock()

	payload := map[string]any{
		"terminals": list,
		"requestId": req.RequestID,
	}
	if req.Cwd != "" {
		payload["cwd"] = req.Cwd
	}
	_ = sendSessionMsg(ctx, sink, "list_terminals_response", payload)
}

func (s *Server) handleSubscribeTerminal(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID       string `json:"requestId"`
		TerminalID      string `json:"terminalId"`
		InitialSnapshot string `json:"initialSnapshot"`
		Restore         *bool  `json:"restore"`
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

	if sess.VT() != nil {
		_, snapFrame := sess.VT().Snapshot(slot)
		_ = sink.SendBinary(ctx, snapFrame)
	}
	var replay strings.Builder
	if sess.VT() != nil {
		replay.WriteString(sess.VT().ReplayPreamble())
	}
	if res := sess.ResumeSince(0); res != nil && res.Data != "" {
		replay.WriteString(res.Data)
	}
	if replay.Len() > 0 {
		_ = sink.SendBinary(ctx, terminal.EncodeFrame(terminal.OpcodeOutput, slot, []byte(replay.String())))
	}

	sess.Subscribe(func(ev terminal.OutputEvent) {
		outFrame := terminal.EncodeFrame(terminal.OpcodeOutput, slot, ev.Data)
		_ = sink.SendBinary(context.Background(), outFrame)
	})
}
