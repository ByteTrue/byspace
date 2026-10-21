package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/jsonl"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// ClaudeSession hosts a local `claude` CLI process in `--output-format stream-json --input-format stream-json` mode.
type ClaudeSession struct {
	proc *jsonl.Process

	mu                 sync.Mutex
	status             string
	sessionID          string
	sessionFile        string
	model              string
	modeID             string
	thinking           string
	turnCounter        int
	activeTurnID       string
	timeline           []sdk.TimelineEntry
	toolIndexByID      map[string]int
	toolArgsByID       map[string]any
	pendingPermissions map[string]map[string]any
	subagents          map[string]sdk.SubagentDescriptor
	finishWaiters      []chan error
	eventSubscribers   map[int]func(map[string]any)
	nextSubID          int
}

// StartClaudeSession launches a Claude Code stream-json subprocess.
func StartClaudeSession(cfg LaunchConfig, cmdOverride string) (*ClaudeSession, error) {
	bin := strings.TrimSpace(cmdOverride)
	if bin == "" {
		bin = "claude"
	}
	args := []string{
		"-p",
		"--output-format", "stream-json",
		"--input-format", "stream-json",
		"--verbose",
	}
	if cfg.Model != "" && cfg.Model != "default" {
		args = append(args, "--model", cfg.Model)
	}
	if cfg.ModeID != "" {
		args = append(args, "--permission-mode", cfg.ModeID)
	}
	if cfg.SessionHandle != "" && !strings.HasSuffix(cfg.SessionHandle, ".jsonl") {
		args = append(args, "--resume", cfg.SessionHandle)
	}

	proc, err := jsonl.Start(jsonl.LaunchConfig{
		Command: bin,
		Args:    args,
		Cwd:     cfg.Cwd,
		Env:     cfg.Env,
	})
	if err != nil {
		return nil, err
	}

	s := &ClaudeSession{
		proc:               proc,
		status:             "idle",
		model:              cfg.Model,
		modeID:             cfg.ModeID,
		thinking:           cfg.ThinkingOptionID,
		toolIndexByID:      make(map[string]int),
		toolArgsByID:       make(map[string]any),
		pendingPermissions: make(map[string]map[string]any),
		subagents:          make(map[string]sdk.SubagentDescriptor),
		eventSubscribers:   make(map[int]func(map[string]any)),
	}
	if strings.HasSuffix(cfg.SessionHandle, ".jsonl") {
		s.sessionFile = cfg.SessionHandle
		if entries, loadErr := LoadClaudeTimelineFromJSONL(cfg.SessionHandle); loadErr == nil && len(entries) > 0 {
			s.timeline = entries
		}
	}
	proc.OnEvent(s.handleRawEvent)
	return s, nil
}

func (s *ClaudeSession) handleRawEvent(ev map[string]any) {
	evType, _ := ev["type"].(string)
	var extraEvents []map[string]any

	s.mu.Lock()
	switch evType {
	case "system":
		if sid, ok := ev["session_id"].(string); ok && sid != "" {
			s.sessionID = sid
		}

	case "assistant":
		if s.status != "running" {
			s.status = "running"
		}
		if msg, ok := ev["message"].(map[string]any); ok {
			if content, ok := msg["content"].([]any); ok {
				for _, rawBlock := range content {
					block, ok := rawBlock.(map[string]any)
					if !ok {
						continue
					}
					bType, _ := block["type"].(string)
					switch bType {
					case "thinking":
						if th, _ := block["thinking"].(string); th != "" {
							s.appendItemLocked(sdk.TimelineItem{
								Type: "reasoning",
								Text: th,
							})
						}
					case "text":
						if txt, _ := block["text"].(string); txt != "" {
							s.appendItemLocked(sdk.TimelineItem{
								Type: "assistant_message",
								Text: txt,
							})
							extraEvents = append(extraEvents, map[string]any{"type": "message_end"})
						}
					case "tool_use":
						callID, _ := block["id"].(string)
						name, _ := block["name"].(string)
						input := block["input"]
						normName := strings.ToLower(name)
						s.toolArgsByID[callID] = input
						idx := s.appendItemLocked(sdk.TimelineItem{
							Type:   "tool_call",
							CallID: callID,
							Name:   name,
							Status: "running",
							Detail: sdk.BuildToolCallDetail(normName, input, nil),
							Error:  nil,
						})
						if callID != "" {
							s.toolIndexByID[callID] = idx
						}
						extraEvents = append(extraEvents, map[string]any{
							"type":       "tool_execution_start",
							"toolCallId": callID,
							"toolName":   name,
						})
						if strings.EqualFold(name, "Task") {
							now := time.Now().UTC().Format(time.RFC3339Nano)
							title := "Subagent"
							desc := ""
							if m, ok := input.(map[string]any); ok {
								if d, ok := m["description"].(string); ok && d != "" {
									title = d
								}
								if p, ok := m["prompt"].(string); ok {
									desc = p
								}
							}
							tcCopy := callID
							s.subagents[callID] = sdk.SubagentDescriptor{
								ID:          callID,
								Provider:    "claude",
								Status:      "running",
								Title:       &title,
								Description: &desc,
								ToolCallID:  &tcCopy,
								CreatedAt:   now,
								UpdatedAt:   now,
							}
						}
					}
				}
			}
		}

	case "user":
		if msg, ok := ev["message"].(map[string]any); ok {
			if content, ok := msg["content"].([]any); ok {
				for _, rawBlock := range content {
					block, ok := rawBlock.(map[string]any)
					if !ok || block["type"] != "tool_result" {
						continue
					}
					callID, _ := block["tool_use_id"].(string)
					isErr, _ := block["is_error"].(bool)
					status := "completed"
					if isErr {
						status = "failed"
					}
					if idx, ok := s.toolIndexByID[callID]; ok && idx >= 0 && idx < len(s.timeline) {
						tName := strings.ToLower(s.timeline[idx].Item.Name)
						s.timeline[idx].Item.Status = status
						s.timeline[idx].Item.Detail = sdk.BuildToolCallDetail(tName, s.toolArgsByID[callID], block["content"])
						if isErr {
							s.timeline[idx].Item.Error = fmt.Sprint(block["content"])
						}
					}
					if sub, exists := s.subagents[callID]; exists {
						sub.Status = status
						sub.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
						s.subagents[callID] = sub
					}
					extraEvents = append(extraEvents, map[string]any{
						"type":       "tool_execution_end",
						"toolCallId": callID,
					})
				}
			}
		}

	case "control_request":
		reqID, _ := ev["request_id"].(string)
		if reqObj, ok := ev["request"].(map[string]any); ok {
			toolName, _ := reqObj["tool_name"].(string)
			if toolName == "" {
				toolName = "Tool Approval"
			}
			perm := map[string]any{
				"id":       reqID,
				"provider": "claude",
				"name":     toolName,
				"kind":     "tool",
				"title":    "Allow " + toolName + "?",
				"input":    reqObj["input"],
			}
			if reqID != "" {
				s.pendingPermissions[reqID] = perm
				extraEvents = append(extraEvents, map[string]any{
					"type":    "extension_ui_request",
					"id":      reqID,
					"method":  "confirm",
					"title":   "Allow " + toolName + "?",
					"message": "Claude requested permission to run " + toolName,
				})
			}
		}

	case "result":
		if sid, ok := ev["session_id"].(string); ok && sid != "" {
			s.sessionID = sid
		}
		if resTxt, ok := ev["result"].(string); ok && resTxt != "" && s.lastAssistantTextLocked() == "" {
			s.appendItemLocked(sdk.TimelineItem{
				Type: "assistant_message",
				Text: resTxt,
			})
			extraEvents = append(extraEvents, map[string]any{"type": "message_end"})
		}
		s.status = "idle"
		s.activeTurnID = ""
		s.notifyFinishLocked(nil)
		extraEvents = append(extraEvents, map[string]any{"type": "agent_end"})

	case "process_exit":
		s.status = "closed"
		s.notifyFinishLocked(fmt.Errorf("claude process exited"))
	}

	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	for _, fn := range subs {
		fn(ev)
		for _, ex := range extraEvents {
			fn(ex)
		}
	}
}

func (s *ClaudeSession) appendItemLocked(item sdk.TimelineItem) int {
	seq := len(s.timeline) + 1
	s.timeline = append(s.timeline, sdk.TimelineEntry{
		Seq:       seq,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      item,
	})
	return len(s.timeline) - 1
}

func (s *ClaudeSession) lastAssistantTextLocked() string {
	for i := len(s.timeline) - 1; i >= 0; i-- {
		if s.timeline[i].Item.Type == "assistant_message" {
			return s.timeline[i].Item.Text
		}
	}
	return ""
}

func (s *ClaudeSession) notifyFinishLocked(err error) {
	waiters := s.finishWaiters
	s.finishWaiters = nil
	for _, ch := range waiters {
		ch <- err
		close(ch)
	}
}

func (s *ClaudeSession) Status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *ClaudeSession) Timeline() []sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *ClaudeSession) SeedTimeline(entries []sdk.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]sdk.TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

func (s *ClaudeSession) LastAssistantText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastAssistantTextLocked()
}

func (s *ClaudeSession) SetNextClientMessageID(_ string) {}

func (s *ClaudeSession) LastError() string {
	return ""
}

// TurnToken returns "" for providers without an explicit turn token; the daemon then relies
// on its own turn id comparison.
func (s *ClaudeSession) TurnToken() string { return "" }

// Usage reports token/cost accounting when the provider exposes it.
func (s *ClaudeSession) Usage(_ context.Context) *sdk.AgentUsage {
	return nil
}

func (s *ClaudeSession) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.timeline)
}

func (s *ClaudeSession) ActiveTurn() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != "running" {
		return "", ""
	}
	return s.activeTurnID, ""
}

func (s *ClaudeSession) Prompt(_ context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.status = "running"
	s.appendItemLocked(sdk.TimelineItem{
		Type: "user_message",
		Text: message,
	})
	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	for _, fn := range subs {
		fn(map[string]any{"type": "turn_start"})
	}

	content := []map[string]any{{"type": "text", "text": message}}
	content = append(content, imageBlocksForClaude(images)...)
	return s.proc.SendRaw(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": content,
		},
	})
}

func (s *ClaudeSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	return s.Prompt(ctx, message, images)
}

func (s *ClaudeSession) Abort(_ context.Context) error {
	_ = s.proc.SendRaw(map[string]any{
		"type": "control_request",
		"request": map[string]any{
			"subtype": "interrupt",
		},
	})
	s.mu.Lock()
	s.status = "idle"
	s.notifyFinishLocked(nil)
	s.mu.Unlock()
	return nil
}

func (s *ClaudeSession) WaitForFinish(ctx context.Context) error {
	s.mu.Lock()
	if s.status != "running" {
		s.mu.Unlock()
		return nil
	}
	ch := make(chan error, 1)
	s.finishWaiters = append(s.finishWaiters, ch)
	s.mu.Unlock()

	select {
	case err := <-ch:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *ClaudeSession) GetState(_ context.Context) (*sdk.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &sdk.SessionState{
		SessionID:     s.sessionID,
		SessionFile:   s.sessionFile,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}, nil
}

func (s *ClaudeSession) SetModel(_ context.Context, provider, modelID string) (*sdk.Model, error) {
	s.mu.Lock()
	s.model = modelID
	s.mu.Unlock()
	return &sdk.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *ClaudeSession) SetThinkingLevel(_ context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

func (s *ClaudeSession) GetCommands(_ context.Context) ([]sdk.SlashCommand, error) {
	return []sdk.SlashCommand{
		{Name: "compact", Description: "Compact conversation history", Source: "builtin"},
		{Name: "clear", Description: "Clear conversation context", Source: "builtin"},
	}, nil
}

func (s *ClaudeSession) PendingPermissions() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]map[string]any, 0, len(s.pendingPermissions))
	for _, p := range s.pendingPermissions {
		out = append(out, p)
	}
	return out
}

func (s *ClaudeSession) RespondToPermission(requestID string, resp map[string]any) error {
	s.mu.Lock()
	delete(s.pendingPermissions, requestID)
	s.mu.Unlock()

	behavior, _ := resp["behavior"].(string)
	if behavior == "" {
		behavior = "allow"
	}
	return s.proc.SendRaw(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": requestID,
			"response": map[string]any{
				"behavior": behavior,
			},
		},
	})
}

func (s *ClaudeSession) ListSubagents(parentAgentID string) []sdk.SubagentDescriptor {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.SubagentDescriptor, 0, len(s.subagents))
	for _, sub := range s.subagents {
		sub.ParentAgentID = parentAgentID
		out = append(out, sub)
	}
	return out
}

func (s *ClaudeSession) GetSubagent(parentAgentID, subagentID string) (sdk.SubagentDescriptor, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub, ok := s.subagents[subagentID]
	if ok {
		sub.ParentAgentID = parentAgentID
	}
	return sub, ok
}

func (s *ClaudeSession) OnEvent(fn func(map[string]any)) func() {
	s.mu.Lock()
	id := s.nextSubID
	s.nextSubID++
	s.eventSubscribers[id] = fn
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.eventSubscribers, id)
		s.mu.Unlock()
	}
}

func (s *ClaudeSession) Close() error {
	return s.proc.Close()
}

// ListClaudeSessions discovers importable ~/.claude/projects/**/*.jsonl transcripts.
func ListClaudeSessions(claudeDirOverride, cwdFilter string, limit int) ([]sdk.ImportableSession, error) {
	root := strings.TrimSpace(claudeDirOverride)
	if root == "" {
		root = strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR"))
	}
	if root == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return []sdk.ImportableSession{}, nil
		}
		root = filepath.Join(h, ".claude")
	}
	projectsDir := filepath.Join(root, "projects")
	if _, err := os.Stat(projectsDir); err != nil {
		return []sdk.ImportableSession{}, nil
	}
	if limit <= 0 {
		limit = 50
	}

	type cand struct {
		path  string
		mtime time.Time
	}
	var files []cand
	_ = filepath.WalkDir(projectsDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		if info, statErr := d.Info(); statErr == nil && info.Size() > 0 {
			files = append(files, cand{path: p, mtime: info.ModTime()})
		}
		return nil
	})
	sort.Slice(files, func(i, j int) bool {
		return files[i].mtime.After(files[j].mtime)
	})

	out := make([]sdk.ImportableSession, 0, limit)
	for _, f := range files {
		if len(out) >= limit {
			break
		}
		entries, cwd, title := parseClaudeJSONLMeta(f.path, f.mtime)
		if len(entries) == 0 {
			continue
		}
		if cwdFilter != "" && cwd != "" && cwd != cwdFilter {
			continue
		}
		if title == "" {
			title = "Claude Session"
		}
		titleCopy := title
		out = append(out, sdk.ImportableSession{
			Provider:         "claude",
			ProviderLabel:    "Claude Code",
			ProviderHandleID: f.path,
			Cwd:              cwd,
			Title:            titleCopy,
			LastActivityAt:   f.mtime.UTC().Format(time.RFC3339Nano),
		})
	}
	return out, nil
}

// LoadClaudeTimelineFromJSONL parses a Claude Code transcript file into TimelineEntry items.
func LoadClaudeTimelineFromJSONL(filePath string) ([]sdk.TimelineEntry, error) {
	entries, _, _ := parseClaudeJSONLMeta(filePath, time.Now())
	return entries, nil
}

func parseClaudeJSONLMeta(filePath string, fallbackTime time.Time) ([]sdk.TimelineEntry, string, string) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, "", ""
	}
	defer f.Close()

	var entries []sdk.TimelineEntry
	var cwd, title string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var row map[string]any
		if json.Unmarshal(sc.Bytes(), &row) != nil {
			continue
		}
		if c, ok := row["cwd"].(string); ok && c != "" && cwd == "" {
			cwd = c
		}
		ts, _ := row["timestamp"].(string)
		if ts == "" {
			ts = fallbackTime.UTC().Format(time.RFC3339Nano)
		}
		rType, _ := row["type"].(string)
		msg, _ := row["message"].(map[string]any)
		if msg == nil {
			continue
		}
		switch rType {
		case "user":
			if txt, ok := msg["content"].(string); ok && txt != "" {
				if title == "" {
					title = txt
				}
				entries = append(entries, sdk.TimelineEntry{
					Seq:       len(entries) + 1,
					Timestamp: ts,
					Item:      sdk.TimelineItem{Type: "user_message", Text: txt},
				})
			}
		case "assistant":
			if blocks, ok := msg["content"].([]any); ok {
				for _, bRaw := range blocks {
					b, ok := bRaw.(map[string]any)
					if !ok {
						continue
					}
					if b["type"] == "text" {
						if t, _ := b["text"].(string); t != "" {
							entries = append(entries, sdk.TimelineEntry{
								Seq:       len(entries) + 1,
								Timestamp: ts,
								Item:      sdk.TimelineItem{Type: "assistant_message", Text: t},
							})
						}
					}
				}
			}
		}
	}
	return entries, cwd, title
}
