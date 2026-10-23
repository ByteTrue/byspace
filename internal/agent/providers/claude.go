package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/activity"
	"github.com/ByteTrue/byspace/internal/agent/imageout"
	"github.com/ByteTrue/byspace/internal/agent/jsonl"
	"github.com/ByteTrue/byspace/internal/agent/replaytime"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/agent/subagentlog"
	"github.com/ByteTrue/byspace/internal/agent/tasknotify"
	"github.com/ByteTrue/byspace/internal/agent/taskstate"
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
	// taskState accumulates Claude's task-list tools into the plan panel's todo item. Kept per session
	// because the Task* family addresses tasks by id across turns.
	taskState *taskstate.State
	// subagentLogs holds the activity trace each delegated task shows in its parent's card.
	subagentLogs *subagentlog.Tracker
	// homeDir is where materialised provider images land. Empty disables image output.
	homeDir   string
	nextSubID int
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
		taskState:          taskstate.New(),
		subagentLogs:       subagentlog.New(),
		toolArgsByID:       make(map[string]any),
		pendingPermissions: make(map[string]map[string]any),
		subagents:          make(map[string]sdk.SubagentDescriptor),
		eventSubscribers:   make(map[int]func(map[string]any)),
		homeDir:            cfg.HomeDir,
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
		if parent := parentToolUseID(ev); parent != "" {
			// A message from inside a subagent. Its tool calls belong to that subagent's
			// timeline, not to the conversation the user is reading — mixing them made a
			// delegated task look like the parent agent had gone off and done unrelated work.
			//
			// Inlined rather than extracted: this function holds s.mu, and a helper that took it
			// again would deadlock the read loop (see notes/013).
			if sub := s.markSubagentActiveLocked(parent); sub != nil {
				extraEvents = append(extraEvents, map[string]any{
					"type":      "agent.provider_subagents.update",
					"kind":      "upsert",
					"subagent":  *sub,
					"updatedAt": time.Now().UTC().Format(time.RFC3339Nano),
				})
			}
			break
		}
		if s.status != "running" {
			s.status = "running"
		}
		// A background task's completion arrives as a USER message carrying a `<task-notification>` envelope, not
		// as a tool result. Rendering it here is what makes the task visible; skipping it means the transcript
		// simply stops where the user launched it.
		if msg, ok := ev["message"].(map[string]any); ok {
			if card := tasknotify.Map(msg["content"]); card != nil {
				detail := card.Detail
				detail["metadata"] = card.Metadata
				idx := s.appendItemLocked(sdk.TimelineItem{
					Type:   "tool_call",
					CallID: card.CallID,
					Name:   card.Name,
					Status: card.Status,
					Detail: detail,
					Error:  card.Error,
				})
				extraEvents = append(extraEvents, map[string]any{
					"type":   "byspace_stream_timeline",
					"seq":    s.timeline[idx].SeqEnd,
					"turnId": s.activeTurnID,
					"item":   s.timeline[idx].Item,
				})
				break
			}
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
						// Claude's task-list tools update the plan panel. Observed here because TodoWrite
						// carries the whole list in its input, so the panel can move before the tool
						// finishes; the Task* family reports in its result instead.
						if snapshot := s.taskState.ObserveCall(callID, name, toArgMap(input)); snapshot != nil {
							extraEvents = append(extraEvents, s.todoTimelineEvent(snapshot)...)
						}
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
							descriptor := sdk.SubagentDescriptor{
								ID:          callID,
								Provider:    "claude",
								Status:      "running",
								Title:       &title,
								Description: &desc,
								ToolCallID:  &tcCopy,
								CreatedAt:   now,
								UpdatedAt:   now,
							}
							sdk.RefreshSubagentSubtitle(&descriptor)
							s.subagents[callID] = descriptor
							extraEvents = append(extraEvents, map[string]any{
								"type":      "agent.provider_subagents.update",
								"kind":      "upsert",
								"subagent":  descriptor,
								"updatedAt": now,
							})
						}
					}
				}
			}
		}

	case "user":
		if parent := parentToolUseID(ev); parent != "" {
			if sub := s.markSubagentActiveLocked(parent); sub != nil {
				extraEvents = append(extraEvents, map[string]any{
					"type":      "agent.provider_subagents.update",
					"kind":      "upsert",
					"subagent":  *sub,
					"updatedAt": time.Now().UTC().Format(time.RFC3339Nano),
				})
			}
			// Record what the child is doing on its parent's card. Without this the Task card shows
			// nothing but the final result, and a delegated task that runs for a minute looks stuck.
			extraEvents = append(extraEvents, s.subagentActivityEventsLocked(parent, ev)...)
			break
		}
		if msg, ok := ev["message"].(map[string]any); ok {
			if content, ok := msg["content"].([]any); ok {
				for _, rawBlock := range content {
					block, ok := rawBlock.(map[string]any)
					if !ok {
						continue
					}
					if block["type"] == "image" {
						// A provider image arrives inline as base64. The conversation renders an
						// image by path, so it is written out and shown as markdown — otherwise
						// the model's image output is received and never displayed.
						if markdown := s.materializeImageBlockLocked(block); markdown != "" {
							s.appendItemLocked(sdk.TimelineItem{
								Type: "assistant_message",
								Text: markdown,
							})
						}
						continue
					}
					if block["type"] != "tool_result" {
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
					// The Task* family reports the resulting state in a structured field, not in the
					// text content. Applied after the call's own bookkeeping so a failed call leaves
					// the list alone.
					if !isErr {
						if snapshot := s.taskState.ObserveResult(callID, claudeStructuredToolResult(msg)); snapshot != nil {
							extraEvents = append(extraEvents, s.todoTimelineEvent(snapshot)...)
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

// AppendTimelineItem stores one item in the session's own timeline and returns the entry.
//
// It does not broadcast: the daemon emits the timeline event itself, so a provider cannot re-enter
// its own event loop. The entry deliberately carries no turn id — the daemon uses this for rows that
// belong to no turn, such as the system-error row a failed turn leaves behind.
func (s *ClaudeSession) AppendTimelineItem(item sdk.TimelineItem) sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := sdk.TimelineEntry{
		Seq:       len(s.timeline) + 1,
		SeqEnd:    len(s.timeline) + 1,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      sdk.LimitTimelineItemContent(item),
	}
	s.timeline = append(s.timeline, entry)
	return entry
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

	// A cwd filter can be answered by reading exactly one project directory: the SDK names it after the
	// path, and ClaudeProjectDir reproduces that encoding. Falling back to the walk when the directory
	// is absent keeps a filter from hiding sessions whose project dir was named by an older SDK.
	searchRoots := []string{projectsDir}
	if strings.TrimSpace(cwdFilter) != "" {
		if encoded := ClaudeProjectDir(cwdFilter, root); encoded != projectsDir {
			if _, statErr := os.Stat(encoded); statErr == nil {
				searchRoots = []string{encoded}
			}
		}
	}
	if limit <= 0 {
		limit = 50
	}

	type cand struct {
		path  string
		mtime time.Time
	}
	var files []cand
	for _, searchRoot := range searchRoots {
		_ = filepath.WalkDir(searchRoot, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
				return nil
			}
			if info, statErr := d.Info(); statErr == nil && info.Size() > 0 {
				files = append(files, cand{path: p, mtime: info.ModTime()})
			}
			return nil
		})
	}
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
		// The timestamp is not always a string: some transcripts carry an epoch number, and an
		// unparseable one used to be dropped silently — every message then got the same fallback time
		// and the imported transcript had no ordering.
		ts := replaytime.Normalize(row["timestamp"])
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

// parentToolUseID returns the subagent a message came from, or "".
//
// Claude's stream-json marks every message produced inside a subagent with the id of the Task
// call that spawned it. The node implementation routes those through a sidechain tracker for
// exactly this reason: without the marker they look like ordinary turns and the user sees a
// delegated task as the parent agent doing unrelated work.
func parentToolUseID(ev map[string]any) string {
	if raw, ok := ev["parent_tool_use_id"]; ok {
		if parent, isString := raw.(string); isString {
			return strings.TrimSpace(parent)
		}
	}
	// The field also appears inside the message body depending on the CLI version.
	if msg, ok := ev["message"].(map[string]any); ok {
		if parent, isString := msg["parent_tool_use_id"].(string); isString {
			return strings.TrimSpace(parent)
		}
	}
	return ""
}

// markSubagentActiveLocked keeps a subagent's status current without touching the main
// timeline. The caller holds s.mu.
//
// The Subagents panel needs to know the delegated task is still working; the conversation needs
// to not show it.
func (s *ClaudeSession) markSubagentActiveLocked(parentToolUseID string) *sdk.SubagentDescriptor {
	sub, exists := s.subagents[parentToolUseID]
	if !exists {
		// A subagent whose Task call we never saw start: record it so its activity is not lost,
		// with a placeholder title until something better arrives.
		title := "Subagent"
		sub = sdk.SubagentDescriptor{
			ID: parentToolUseID, Provider: "claude", Status: "running", Title: &title,
		}
	}
	if sub.Status != "running" {
		sub.Status = "running"
	}
	// The subtitle is rebuilt on every activity so it fills in as the subagent reports its model
	// and token usage; the first upsert only knows the title.
	sdk.RefreshSubagentSubtitle(&sub)
	s.subagents[parentToolUseID] = sub
	descriptor := sub
	return &descriptor
}

// materializeImageBlockLocked writes an inline provider image and returns markdown for it.
// The caller holds s.mu.
//
// Returns "" when the block is not a usable image: a broken block must not stop the turn, and an
// empty markdown image would render as a broken picture.
func (s *ClaudeSession) materializeImageBlockLocked(block map[string]any) string {
	source, _ := block["source"].(map[string]any)
	data, _ := source["data"].(string)
	mimeType, _ := source["media_type"].(string)
	// The renderer is shared with the other providers so the markdown escaping and the disk materialization
	// cannot drift between them — this code used to hand-roll both.
	markdown, ok := imageout.RenderAsMarkdown(imageout.ProviderImage{
		Data:     data,
		MimeType: mimeType,
		AltText:  imageAltText(mimeType),
	}, s.homeDir)
	if !ok {
		return ""
	}
	return markdown
}

// toArgMap reads a tool input as a map.
//
// Claude sends `input` as a JSON object; anything else (a null, a string) means the tool has no
// structured arguments, and the task-state observer simply sees an empty map.
func toArgMap(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

// todoTimelineEvent records a task-list snapshot in the timeline and returns the event to broadcast.
//
// A snapshot replaces the previous one rather than appending: the panel shows one list, and a run of
// TodoWrite calls would otherwise leave a stack of stale lists in the transcript.
func (s *ClaudeSession) todoTimelineEvent(snapshot *taskstate.Snapshot) []map[string]any {
	items := make([]sdk.TaskItem, 0, len(snapshot.Items))
	for _, item := range snapshot.Items {
		items = append(items, sdk.TaskItem{
			Text:       item.Text,
			Completed:  item.Completed,
			ID:         item.ID,
			Status:     item.Status,
			ActiveForm: item.ActiveForm,
		})
	}

	index := len(s.timeline) - 1
	if index < 0 || s.timeline[index].Item.Type != "todo" {
		index = s.appendItemLocked(sdk.TimelineItem{Type: "todo", Items: items})
	} else {
		s.timeline[index].Item.Items = items
	}
	entry := s.timeline[index]
	return []map[string]any{{
		"type": "timeline",
		// The protocol's todo branch carries `items`, not a nested `detail`. Sending detail made the
		// item fail validation, which drops the whole timeline response rather than just this row.
		"item": map[string]any{
			"type":      "todo",
			"items":     items,
			"seq":       entry.Seq,
			"turnId":    entry.TurnID,
			"timestamp": entry.Timestamp,
		},
	}}
}

// claudeStructuredToolResult reads the structured result Claude attaches to a tool_result message.
//
// `toolUseResult` (and the snake_case spelling in older transcripts) carries the task tools' parsed
// output; the text content of the block is the human-readable form and has no ids in it.
func claudeStructuredToolResult(row map[string]any) map[string]any {
	for _, key := range []string{"toolUseResult", "tool_use_result"} {
		if record, ok := row[key].(map[string]any); ok {
			return record
		}
	}
	return map[string]any{}
}

// subagentActivityEventsLocked turns a sub-agent message into activity lines and card updates.
//
// Ported from the sidechain tracker's handleMessage. Only the tool-using parts become lines: a child's
// assistant prose is not an action, and printing it would fill the log with the model's narration.
func (s *ClaudeSession) subagentActivityEventsLocked(parentToolUseID string, ev map[string]any) []map[string]any {
	msg, ok := ev["message"].(map[string]any)
	if !ok {
		return nil
	}
	content, ok := msg["content"].([]any)
	if !ok {
		return nil
	}

	var events []map[string]any
	for _, rawBlock := range content {
		block, ok := rawBlock.(map[string]any)
		if !ok {
			continue
		}
		if block["type"] == "tool_result" {
			continue
		}
		if block["type"] != "tool_use" {
			continue
		}
		name, _ := block["name"].(string)
		input, _ := block["input"].(map[string]any)
		// The same display model the parent's own cards use, so the trace reads consistently.
		display := activity.BuildDisplayModel(name, sdk.BuildToolCallDetail(name, input, nil), nil)
		summary := ""
		if display.HasSummary {
			summary = display.Summary
			// The parent card is not the tool card: it is a compact list of what the child did. A long
			// command or path would dominate it.
			if len(summary) > 120 {
				summary = summary[:117] + "..."
			}
		}
		log := s.subagentLogs.AppendTool(parentToolUseID, display.DisplayName, summary)
		events = append(events, s.subagentCardEventsLocked(parentToolUseID, log)...)
	}
	return events
}

// subagentCardEventsLocked updates the parent's Task card with the current log.
func (s *ClaudeSession) subagentCardEventsLocked(parentToolUseID, log string) []map[string]any {
	idx, ok := s.toolIndexByID[parentToolUseID]
	if !ok || idx < 0 || idx >= len(s.timeline) {
		return nil
	}
	item := &s.timeline[idx].Item
	detail, ok := item.Detail.(map[string]any)
	if !ok || detail == nil {
		detail = map[string]any{"type": "sub_agent"}
	}
	detail["log"] = log
	item.Detail = detail
	return []map[string]any{{
		"type": "timeline",
		"item": map[string]any{
			"type":      "tool_call",
			"name":      item.Name,
			"callId":    item.CallID,
			"status":    item.Status,
			"detail":    detail,
			"seq":       s.timeline[idx].Seq,
			"turnId":    s.timeline[idx].TurnID,
			"timestamp": s.timeline[idx].Timestamp,
		},
	}}
}

// imageAltText names an image for its alt text.
//
// The media type makes the alt useful to a screen reader and to a client that cannot load the image: "Generated png
// image" says more than "Generated image".
func imageAltText(mimeType string) string {
	if trimmed := strings.TrimSpace(strings.TrimPrefix(mimeType, "image/")); trimmed != "" && trimmed != mimeType {
		return "Generated " + trimmed + " image"
	}
	return "Generated image"
}

// RewindCapabilities reports what this provider can rewind.
//
// Claude can restore files through the SDK's `rewindFiles` checkpoints, which Go does not have, so only the conversation
// is offered — and a client that only gets `Conversation` renders the conversation-only control.
func (s *ClaudeSession) RewindCapabilities() RewindCapabilities {
	return RewindCapabilities{Conversation: true}
}

// RewindConversation forks the transcript up to a message and continues in the fork.
//
// Ported from claude/rewind.ts, but implemented at the file level: the SDK's `forkSession` is a JS function, not a daemon
// call, and the CLI protocol has no equivalent. What the function actually does is read the transcript, keep the entries
// up to the message, give each a fresh uuid, and write a new file — all of which is available here.
//
// The session id changes, because Claude identifies a conversation by its transcript file. Handing the client the new id
// is what makes the next prompt continue in the fork instead of appending to the original.
func (s *ClaudeSession) RewindConversation(ctx context.Context, messageID string) error {
	trimmed := strings.TrimSpace(messageID)
	if trimmed == "" {
		return errors.New("rewind needs a message id")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	s.mu.Lock()
	sessionID := s.sessionID
	s.mu.Unlock()
	// The config directory comes from the environment (CLAUDE_CONFIG_DIR) or the default location; keeping it out of
	// the session struct means a user who moves their config does not need a new session to rewind.
	configDir := resolveClaudeConfigDir("")

	if sessionID == "" {
		return errors.New("Claude session is not ready for rewind")
	}
	forkedID, err := ForkClaudeSession(configDir, sessionID, trimmed)
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.sessionID = forkedID
	s.status = "idle"
	s.mu.Unlock()
	return nil
}

// TreeEntryForMessage maps a message id to the provider's own reference.
//
// Claude addresses messages by uuid directly, so the mapping is the identity.
func (s *ClaudeSession) TreeEntryForMessage(messageID string) (string, bool) {
	trimmed := strings.TrimSpace(messageID)
	return trimmed, trimmed != ""
}
