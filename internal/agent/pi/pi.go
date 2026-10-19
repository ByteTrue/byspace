package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/jsonl"
)

var leadingMagicTagRe = regexp.MustCompile(`^§\d+§\s*`)

// ImageContent represents a base64 image block passed to Pi RPC prompt/steer.
type ImageContent struct {
	Type     string `json:"type"`
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

// Model describes a Pi model entry returned by get_available_models or get_state.
type Model struct {
	Provider      string         `json:"provider"`
	ID            string         `json:"id"`
	Name          string         `json:"name,omitempty"`
	Reasoning     bool           `json:"reasoning,omitempty"`
	ContextWindow int            `json:"contextWindow,omitempty"`
	MaxTokens     int            `json:"maxTokens,omitempty"`
	API           string         `json:"api,omitempty"`
	BaseURL       string         `json:"baseUrl,omitempty"`
	Cost          map[string]any `json:"cost,omitempty"`
}

// SessionState mirrors PiSessionState in packages/server/src/server/agent/providers/pi/rpc-types.ts.
type SessionState struct {
	Model                 *Model `json:"model,omitempty"`
	ThinkingLevel         string `json:"thinkingLevel"`
	IsStreaming           bool   `json:"isStreaming"`
	IsCompacting          bool   `json:"isCompacting"`
	AutoCompactionEnabled bool   `json:"autoCompactionEnabled,omitempty"`
	SessionFile           string `json:"sessionFile,omitempty"`
	SessionID             string `json:"sessionId"`
	SessionName           string `json:"sessionName,omitempty"`
	MessageCount          int    `json:"messageCount"`
	PendingMessageCount   int    `json:"pendingMessageCount"`
}

// SessionStats mirrors PiSessionStats.
type SessionStats struct {
	Tokens map[string]int `json:"tokens,omitempty"`
	Cost   float64        `json:"cost,omitempty"`
}

// SlashCommand mirrors PiRpcSlashCommand.
type SlashCommand struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
}

// TimelineItem represents a normalized BySpace timeline item (user_message, assistant_message, reasoning, tool_call).
type TimelineItem struct {
	Type   string `json:"type"`
	Text   string `json:"text,omitempty"`
	CallID string `json:"callId,omitempty"`
	Name   string `json:"name,omitempty"`
	Status string `json:"status,omitempty"`
	Detail any    `json:"detail,omitempty"`
	Error  any    `json:"error,omitempty"`
}

// MarshalJSON ensures tool_call items always serialize "error": null when Error is nil,
// matching ToolCallRunningPayloadSchema / ToolCallCompletedPayloadSchema in @bytetrue/protocol.
func (i TimelineItem) MarshalJSON() ([]byte, error) {
	if i.Type == "tool_call" {
		return json.Marshal(map[string]any{
			"type":   i.Type,
			"callId": i.CallID,
			"name":   i.Name,
			"status": i.Status,
			"detail": i.Detail,
			"error":  i.Error,
		})
	}
	return json.Marshal(map[string]any{
		"type": i.Type,
		"text": i.Text,
	})
}

// TimelineEntry wraps a TimelineItem with sequence and timestamp metadata.
type TimelineEntry struct {
	Seq       int          `json:"seq"`
	TurnID    string       `json:"turnId,omitempty"`
	Timestamp string       `json:"timestamp"`
	Item      TimelineItem `json:"item"`
}

// LaunchOptions configures how the Pi subprocess is started.
type LaunchOptions struct {
	Command          string
	Args             []string
	Cwd              string
	Env              []string
	ProtocolMode     string // "rpc" (default) or "rpc-ui"
	Model            string
	ThinkingOptionID string
	Session          string
	NoSession        bool
	ExtensionPaths   []string
	ExtraArgs        []string
}

// BuildLaunchArgs constructs the command and argument slice matching buildPiLaunch in runtime.ts.
func BuildLaunchArgs(opts LaunchOptions) (string, []string) {
	cmd := strings.TrimSpace(opts.Command)
	if cmd == "" {
		cmd = strings.TrimSpace(os.Getenv("PI_COMMAND"))
	}
	if cmd == "" {
		cmd = strings.TrimSpace(os.Getenv("PI_ACP_PI_COMMAND"))
	}
	if cmd == "" {
		cmd = "pi"
	}

	argv := append([]string(nil), opts.Args...)
	mode := opts.ProtocolMode
	if mode == "" {
		mode = "rpc"
	}
	if !hasModeFlag(argv) {
		argv = append(argv, "--mode", mode)
	}
	if len(opts.ExtraArgs) > 0 {
		argv = append(argv, opts.ExtraArgs...)
	}
	if opts.Model != "" && opts.Model != "default" {
		argv = append(argv, "--model", opts.Model)
	}
	if opts.ThinkingOptionID != "" {
		argv = append(argv, "--thinking", opts.ThinkingOptionID)
	}
	if opts.NoSession {
		argv = append(argv, "--no-session")
	} else if opts.Session != "" {
		argv = append(argv, "--session", opts.Session)
	}
	for _, ext := range opts.ExtensionPaths {
		if ext != "" {
			argv = append(argv, "--extension", ext)
		}
	}
	if !hasApproveFlag(argv) {
		argv = append(argv, "--approve")
	}
	return cmd, argv
}

func hasModeFlag(argv []string) bool {
	for _, a := range argv {
		if a == "--mode" || strings.HasPrefix(a, "--mode=") {
			return true
		}
	}
	return false
}

func hasApproveFlag(argv []string) bool {
	for _, a := range argv {
		switch a {
		case "--approve", "-a", "--no-approve", "-na":
			return true
		}
	}
	return false
}

// Session wraps a running Pi RPC process and tracks its live timeline and run state.
type Session struct {
	proc *jsonl.Process

	mu                 sync.Mutex
	status             string // "idle" | "running" | "error" | "closed"
	lastError          string
	turnCounter        int
	activeTurnID       string
	timeline           []TimelineEntry
	activeTextIdx      int
	activeThinkIdx     int
	toolIndexByID      map[string]int
	toolArgsByID       map[string]any
	pendingPermissions map[string]map[string]any
	subagents          map[string]SubagentDescriptor
	finishWaiters      []chan error
	eventSubscribers   map[int]func(map[string]any)
	nextSubID          int
}

// StartSession launches a Pi RPC subprocess and initializes timeline tracking.
func StartSession(opts LaunchOptions) (*Session, error) {
	cmd, argv := BuildLaunchArgs(opts)
	proc, err := jsonl.Start(jsonl.LaunchConfig{
		Command: cmd,
		Args:    argv,
		Cwd:     opts.Cwd,
		Env:     opts.Env,
	})
	if err != nil {
		return nil, err
	}

	s := &Session{
		proc:               proc,
		status:             "idle",
		activeTextIdx:      -1,
		activeThinkIdx:     -1,
		toolIndexByID:      make(map[string]int),
		toolArgsByID:       make(map[string]any),
		pendingPermissions: make(map[string]map[string]any),
		subagents:          make(map[string]SubagentDescriptor),
		eventSubscribers:   make(map[int]func(map[string]any)),
	}
	proc.OnEvent(s.handleRawEvent)
	return s, nil
}

func (s *Session) handleRawEvent(ev map[string]any) {
	evType, _ := ev["type"].(string)

	s.mu.Lock()
	switch evType {
	case "agent_start", "turn_start":
		s.status = "running"
		if s.activeTurnID == "" {
			s.turnCounter++
			s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
		}

	case "message_start":
		s.activeTextIdx = -1
		s.activeThinkIdx = -1

	case "message_update":
		if ame, ok := ev["assistantMessageEvent"].(map[string]any); ok {
			ameType, _ := ame["type"].(string)
			delta, _ := ame["delta"].(string)
			switch ameType {
			case "text_delta":
				if delta != "" {
					if s.activeTextIdx < 0 || s.activeTextIdx >= len(s.timeline) {
						s.activeTextIdx = s.appendItemLocked(TimelineItem{
							Type: "assistant_message",
							Text: leadingMagicTagRe.ReplaceAllString(delta, ""),
						})
					} else {
						combined := s.timeline[s.activeTextIdx].Item.Text + delta
						s.timeline[s.activeTextIdx].Item.Text = leadingMagicTagRe.ReplaceAllString(combined, "")
					}
				}
			case "thinking_delta":
				if delta != "" {
					if s.activeThinkIdx < 0 || s.activeThinkIdx >= len(s.timeline) {
						s.activeThinkIdx = s.appendItemLocked(TimelineItem{
							Type: "reasoning",
							Text: delta,
						})
					} else {
						s.timeline[s.activeThinkIdx].Item.Text += delta
					}
				}
			}
		}

	case "message_end":
		// If the assistant message finished without streaming deltas (e.g. single block),
		// ensure its final text is captured.
		if msg, ok := ev["message"].(map[string]any); ok {
			role, _ := msg["role"].(string)
			if role == "assistant" && s.activeTextIdx < 0 {
				if text := extractAssistantText(msg); text != "" {
					s.activeTextIdx = s.appendItemLocked(TimelineItem{
						Type: "assistant_message",
						Text: text,
					})
				}
			}
		}
		s.activeTextIdx = -1
		s.activeThinkIdx = -1

	case "tool_execution_start":
		callID, _ := ev["toolCallId"].(string)
		toolName, _ := ev["toolName"].(string)
		if callID != "" {
			s.toolArgsByID[callID] = ev["args"]
		}
		idx := s.appendItemLocked(TimelineItem{
			Type:   "tool_call",
			CallID: callID,
			Name:   toolName,
			Status: "running",
			Detail: BuildToolCallDetail(toolName, ev["args"], nil),
			Error:  nil,
		})
		if callID != "" {
			s.toolIndexByID[callID] = idx
		}

	case "tool_execution_end":
		callID, _ := ev["toolCallId"].(string)
		toolName, _ := ev["toolName"].(string)
		isErr, _ := ev["isError"].(bool)
		status := "completed"
		if isErr {
			status = "failed"
		}
		args := s.toolArgsByID[callID]
		detail := BuildToolCallDetail(toolName, args, ev["result"])
		if idx, ok := s.toolIndexByID[callID]; ok && idx >= 0 && idx < len(s.timeline) {
			s.timeline[idx].Item.Status = status
			s.timeline[idx].Item.Detail = detail
			if isErr {
				s.timeline[idx].Item.Error = extractResultText(ev["result"])
			}
		} else {
			var errVal any
			if isErr {
				errVal = extractResultText(ev["result"])
			}
			s.appendItemLocked(TimelineItem{
				Type:   "tool_call",
				CallID: callID,
				Name:   toolName,
				Status: status,
				Detail: detail,
				Error:  errVal,
			})
		}
		if strings.HasPrefix(toolName, "subagent") {
			for _, sub := range ParseSubagentDetails(callID, args, ev["result"]) {
				s.upsertSubagentLocked(sub)
			}
		}

	case "extension_ui_request":
		if perm := MapExtensionUIRequestToPermission(ev); perm != nil {
			if id, _ := perm["id"].(string); id != "" {
				s.pendingPermissions[id] = perm
			}
		}

	case "agent_end", "agent_settled":
		willRetry, _ := ev["willRetry"].(bool)
		if !willRetry {
			s.status = "idle"
			s.activeTurnID = ""
			s.activeTextIdx = -1
			s.activeThinkIdx = -1
			s.notifyFinishLocked(nil)
		}

	case "process_exit":
		errMsg, _ := ev["error"].(string)
		s.status = "closed"
		s.lastError = errMsg
		s.activeTurnID = ""
		s.notifyFinishLocked(fmt.Errorf("pi process exited: %s", errMsg))
	}

	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	for _, fn := range subs {
		fn(ev)
	}
}

func extractAssistantText(msg map[string]any) string {
	content, ok := msg["content"].([]any)
	if !ok {
		return ""
	}
	var parts []string
	for _, item := range content {
		if block, ok := item.(map[string]any); ok {
			if block["type"] == "text" {
				if t, ok := block["text"].(string); ok && t != "" {
					parts = append(parts, t)
				}
			}
		}
	}
	return strings.Join(parts, "")
}

func (s *Session) appendItemLocked(item TimelineItem) int {
	seq := len(s.timeline) + 1
	entry := TimelineEntry{
		Seq:       seq,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      item,
	}
	s.timeline = append(s.timeline, entry)
	return len(s.timeline) - 1
}

func (s *Session) notifyFinishLocked(err error) {
	waiters := s.finishWaiters
	s.finishWaiters = nil
	for _, ch := range waiters {
		ch <- err
		close(ch)
	}
}

// OnEvent subscribes to raw Pi runtime events.
func (s *Session) OnEvent(fn func(map[string]any)) func() {
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

// Status returns the current lifecycle state ("idle", "running", "closed").
func (s *Session) Status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Timeline returns a snapshot copy of the accumulated timeline entries.
func (s *Session) Timeline() []TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

// SeedTimeline populates the session timeline from a restored .jsonl history file.
func (s *Session) SeedTimeline(entries []TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

// LastAssistantText returns the text of the most recent assistant_message in the timeline.
func (s *Session) LastAssistantText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.timeline) - 1; i >= 0; i-- {
		if s.timeline[i].Item.Type == "assistant_message" {
			return s.timeline[i].Item.Text
		}
	}
	return ""
}

// Prompt sends a user prompt to Pi and appends the user_message to the timeline.
func (s *Session) Prompt(ctx context.Context, message string, images []ImageContent) error {
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.status = "running"
	s.appendItemLocked(TimelineItem{
		Type: "user_message",
		Text: message,
	})
	s.mu.Unlock()

	cmd := map[string]any{
		"type":    "prompt",
		"message": message,
	}
	if len(images) > 0 {
		cmd["images"] = images
	}
	_, err := s.proc.Request(ctx, cmd)
	return err
}

// Steer sends a steering message during an active turn.
func (s *Session) Steer(ctx context.Context, message string, images []ImageContent) error {
	cmd := map[string]any{
		"type":    "steer",
		"message": message,
	}
	if len(images) > 0 {
		cmd["images"] = images
	}
	_, err := s.proc.Request(ctx, cmd)
	return err
}

// Abort cancels the active Pi turn.
func (s *Session) Abort(ctx context.Context) error {
	_, err := s.proc.Request(ctx, map[string]any{"type": "abort"})
	return err
}

// WaitForFinish blocks until the current turn settles (status becomes "idle") or ctx expires.
func (s *Session) WaitForFinish(ctx context.Context) error {
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

// GetState queries Pi's current session state.
func (s *Session) GetState(ctx context.Context) (*SessionState, error) {
	raw, err := s.proc.Request(ctx, map[string]any{"type": "get_state"})
	if err != nil {
		return nil, err
	}
	var st SessionState
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

// GetAvailableModels queries Pi's model catalog.
func (s *Session) GetAvailableModels(ctx context.Context) ([]Model, error) {
	raw, err := s.proc.Request(ctx, map[string]any{"type": "get_available_models"})
	if err != nil {
		return nil, err
	}
	var wrapper struct {
		Models []Model `json:"models"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Models, nil
}

// SetModel changes Pi's active provider and model.
func (s *Session) SetModel(ctx context.Context, provider, modelID string) (*Model, error) {
	raw, err := s.proc.Request(ctx, map[string]any{
		"type":     "set_model",
		"provider": provider,
		"modelId":  modelID,
	})
	if err != nil {
		return nil, err
	}
	var m Model
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// SetThinkingLevel updates Pi's reasoning effort level.
func (s *Session) SetThinkingLevel(ctx context.Context, level string) error {
	_, err := s.proc.Request(ctx, map[string]any{
		"type":  "set_thinking_level",
		"level": level,
	})
	return err
}

// GetCommands lists Pi's available slash commands and skills.
func (s *Session) GetCommands(ctx context.Context) ([]SlashCommand, error) {
	raw, err := s.proc.Request(ctx, map[string]any{"type": "get_commands"})
	if err != nil {
		return nil, err
	}
	var wrapper struct {
		Commands []SlashCommand `json:"commands"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Commands, nil
}

func (s *Session) upsertSubagentLocked(sub SubagentDescriptor) {
	if existing, ok := s.subagents[sub.ID]; ok {
		sub.CreatedAt = existing.CreatedAt
		if sub.Title == nil {
			sub.Title = existing.Title
		}
		if sub.Description == nil {
			sub.Description = existing.Description
		}
		if sub.ToolCallID == nil {
			sub.ToolCallID = existing.ToolCallID
		}
		if sub.SessionID == "" {
			sub.SessionID = existing.SessionID
		}
		if sub.SessionFile == "" {
			sub.SessionFile = existing.SessionFile
		}
	}
	s.subagents[sub.ID] = sub
}

// PendingPermissions returns a snapshot of currently pending extension_ui_request permissions.
func (s *Session) PendingPermissions() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]map[string]any, 0, len(s.pendingPermissions))
	for _, p := range s.pendingPermissions {
		out = append(out, p)
	}
	return out
}

// RespondToPermission resolves a pending extension_ui_request and writes extension_ui_response to Pi stdin.
func (s *Session) RespondToPermission(requestID string, resp map[string]any) error {
	s.mu.Lock()
	req, ok := s.pendingPermissions[requestID]
	if ok {
		delete(s.pendingPermissions, requestID)
	}
	s.mu.Unlock()
	if !ok {
		req = map[string]any{"id": requestID}
	}
	uiResp := BuildExtensionUIResponse(requestID, req, resp)
	return s.proc.SendRaw(uiResp)
}

// ListSubagents returns all tracked subagents for this Pi session, stamped with parentAgentID.
func (s *Session) ListSubagents(parentAgentID string) []SubagentDescriptor {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]SubagentDescriptor, 0, len(s.subagents))
	for _, sub := range s.subagents {
		sub.ParentAgentID = parentAgentID
		out = append(out, sub)
	}
	return out
}

// GetSubagent looks up a tracked subagent by ID.
func (s *Session) GetSubagent(parentAgentID, subagentID string) (SubagentDescriptor, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub, ok := s.subagents[subagentID]
	if !ok {
		return SubagentDescriptor{}, false
	}
	sub.ParentAgentID = parentAgentID
	return sub, true
}

// Close shuts down the underlying Pi subprocess.
func (s *Session) Close() error {
	return s.proc.Close()
}
