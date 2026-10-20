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

var leadingMagicTagRe = regexp.MustCompile(`^§[0-9]+§[ \t]*`)

// stripLeadingSectionTag removes a leading "§<digits>§ " prefix if present.
// It returns (cleaned, true) only while s is still an unclosed prefix like "§" or "§12".
func stripLeadingSectionTag(s string) (string, bool) {
	const prefix = "§"
	if !strings.HasPrefix(s, prefix) {
		return s, false
	}
	rest := s[len(prefix):]
	if rest == "" {
		return "", true
	}
	i := 0
	for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
		i++
	}
	if i == 0 {
		return s, false
	}
	if i == len(rest) {
		return "", true
	}
	if !strings.HasPrefix(rest[i:], prefix) {
		return s, false
	}
	after := rest[i+len(prefix):]
	if len(after) > 0 && after[0] == ' ' {
		after = after[1:]
	}
	return after, false
}

// PromptImage is a base64 image payload attached to a prompt.
type PromptImage struct {
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

// ImageContent represents a base64 image block passed to Pi RPC prompt/steer.
type ImageContent struct {
	Type     string `json:"type"`
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

// Model describes a Pi model entry returned by get_available_models or get_state.
type Model struct {
	Provider         string             `json:"provider"`
	ID               string             `json:"id"`
	Name             string             `json:"name,omitempty"`
	Reasoning        bool               `json:"reasoning,omitempty"`
	ThinkingLevelMap map[string]*string `json:"thinkingLevelMap,omitempty"`
	ContextWindow    int                `json:"contextWindow,omitempty"`
	MaxTokens        int                `json:"maxTokens,omitempty"`
	API              string             `json:"api,omitempty"`
	BaseURL          string             `json:"baseUrl,omitempty"`
	Cost             map[string]any     `json:"cost,omitempty"`
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
	Type            string `json:"type"`
	Text            string `json:"text,omitempty"`
	MessageID       string `json:"messageId,omitempty"`
	ClientMessageID string `json:"clientMessageId,omitempty"`
	CallID          string `json:"callId,omitempty"`
	Name            string `json:"name,omitempty"`
	Status          string `json:"status,omitempty"`
	Detail          any    `json:"detail,omitempty"`
	Error           any    `json:"error,omitempty"`
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
	m := map[string]any{
		"type": i.Type,
		"text": i.Text,
	}
	if i.MessageID != "" {
		m["messageId"] = i.MessageID
	}
	if i.ClientMessageID != "" {
		m["clientMessageId"] = i.ClientMessageID
	}
	return json.Marshal(m)
}

// TimelineEntry wraps a TimelineItem with sequence and timestamp metadata.
type TimelineEntry struct {
	Seq       int          `json:"seq"`
	SeqEnd    int          `json:"seqEnd,omitempty"`
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

	mu                  sync.Mutex
	status              string // "idle" | "running" | "error" | "closed"
	lastError           string
	turnCounter         int
	streamSeq           int
	activeTurnID        string
	turnStartedAt       string
	activeMessageID     string
	nextClientMessageID string
	streamedInTurn      bool
	timeline            []TimelineEntry
	activeTextIdx       int
	activeThinkIdx      int
	toolIndexByID       map[string]int
	toolArgsByID        map[string]any
	pendingPermissions  map[string]map[string]any
	subagents           map[string]SubagentDescriptor
	finishWaiters       []chan error
	eventSubscribers    map[int]func(map[string]any)
	nextSubID           int
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
	var extraEvents []map[string]any

	s.mu.Lock()
	switch evType {
	case "agent_start", "turn_start":
		s.status = "running"
		if s.activeTurnID == "" {
			s.turnCounter++
			s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
		}

	case "message_start":
		if msg, ok := ev["message"].(map[string]any); ok {
			if role, _ := msg["role"].(string); role == "assistant" {
				s.activeTextIdx = -1
				s.activeThinkIdx = -1
				s.streamedInTurn = false
				s.activeMessageID = fmt.Sprintf("msg_%d_%d", s.turnCounter, len(s.timeline)+1)
			}
		}

	case "message_update":
		if ame, ok := ev["assistantMessageEvent"].(map[string]any); ok {
			ameType, _ := ame["type"].(string)
			delta, _ := ame["delta"].(string)
			switch ameType {
			case "text_delta":
				if delta != "" {
					if s.activeMessageID == "" {
						s.activeMessageID = fmt.Sprintf("msg_%d_%d", s.turnCounter, len(s.timeline)+1)
					}
					if s.activeTextIdx < 0 || s.activeTextIdx >= len(s.timeline) {
						s.activeTextIdx = s.appendItemWithSeqLocked(0, TimelineItem{
							Type:      "assistant_message",
							Text:      "",
							MessageID: s.activeMessageID,
						})
					}
					var emitDelta string
					if !s.streamedInTurn {
						combined := s.timeline[s.activeTextIdx].Item.Text + delta
						cleaned, incomplete := stripLeadingSectionTag(combined)
						if incomplete {
							s.timeline[s.activeTextIdx].Item.Text = combined
							break
						}
						s.timeline[s.activeTextIdx].Item.Text = cleaned
						emitDelta = cleaned
						if cleaned != "" {
							s.streamedInTurn = true
						}
					} else {
						if s.timeline[s.activeTextIdx].Item.Text == "" && strings.HasPrefix(delta, " ") {
							delta = delta[1:]
						}
						s.timeline[s.activeTextIdx].Item.Text += delta
						emitDelta = delta
					}
					if emitDelta != "" {
						s.streamSeq++
						seq := s.streamSeq
						if s.timeline[s.activeTextIdx].Seq == 0 {
							s.timeline[s.activeTextIdx].Seq = seq
						}
						s.timeline[s.activeTextIdx].SeqEnd = seq
						extraEvents = append(extraEvents, map[string]any{
							"type":   "byspace_stream_timeline",
							"seq":    seq,
							"turnId": s.activeTurnID,
							"item": TimelineItem{
								Type:      "assistant_message",
								Text:      emitDelta,
								MessageID: s.activeMessageID,
							},
						})
					}
				}
			case "thinking_delta":
				if delta != "" {
					s.streamSeq++
					seq := s.streamSeq
					if s.activeThinkIdx < 0 || s.activeThinkIdx >= len(s.timeline) {
						s.activeThinkIdx = s.appendItemWithSeqLocked(seq, TimelineItem{
							Type: "reasoning",
							Text: delta,
						})
					} else {
						s.timeline[s.activeThinkIdx].Item.Text += delta
						s.timeline[s.activeThinkIdx].SeqEnd = seq
					}
					extraEvents = append(extraEvents, map[string]any{
						"type":   "byspace_stream_timeline",
						"seq":    seq,
						"turnId": s.activeTurnID,
						"item": TimelineItem{
							Type: "reasoning",
							Text: delta,
						},
					})
				}
			}
		}

	case "message_end":
		// Only handle assistant message_end; ignore user message_end so previous turns never leak.
		if msg, ok := ev["message"].(map[string]any); ok {
			role, _ := msg["role"].(string)
			if role == "assistant" {
				if !s.streamedInTurn {
					rawText := extractAssistantText(msg)
					cleaned, _ := stripLeadingSectionTag(rawText)
					if cleaned != "" {
						msgID := s.activeMessageID
						if msgID == "" {
							msgID = fmt.Sprintf("msg_%d_%d", s.turnCounter, len(s.timeline)+1)
						}
						s.streamSeq++
						if s.activeTextIdx >= 0 && s.activeTextIdx < len(s.timeline) {
							s.timeline[s.activeTextIdx].Item.Text = cleaned
							s.timeline[s.activeTextIdx].Seq = s.streamSeq
							s.timeline[s.activeTextIdx].SeqEnd = s.streamSeq
							extraEvents = append(extraEvents, map[string]any{
								"type":   "byspace_stream_timeline",
								"seq":    s.streamSeq,
								"turnId": s.activeTurnID,
								"item":   s.timeline[s.activeTextIdx].Item,
							})
						} else {
							idx := s.appendItemWithSeqLocked(s.streamSeq, TimelineItem{
								Type:      "assistant_message",
								Text:      cleaned,
								MessageID: msgID,
							})
							extraEvents = append(extraEvents, map[string]any{
								"type":   "byspace_stream_timeline",
								"seq":    s.timeline[idx].SeqEnd,
								"turnId": s.activeTurnID,
								"item":   s.timeline[idx].Item,
							})
						}
					}
				}
				s.activeTextIdx = -1
				s.activeThinkIdx = -1
				s.activeMessageID = ""
				s.streamedInTurn = false
			}
		}

	case "tool_execution_start":
		callID, _ := ev["toolCallId"].(string)
		toolName, _ := ev["toolName"].(string)
		if callID != "" {
			s.toolArgsByID[callID] = ev["args"]
		}
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		s.activeMessageID = ""
		s.streamSeq++
		idx := s.appendItemWithSeqLocked(s.streamSeq, TimelineItem{
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
		extraEvents = append(extraEvents, map[string]any{
			"type":   "byspace_stream_timeline",
			"seq":    s.timeline[idx].SeqEnd,
			"turnId": s.activeTurnID,
			"item":   s.timeline[idx].Item,
		})

	case "tool_execution_update":
		callID, _ := ev["toolCallId"].(string)
		toolName, _ := ev["toolName"].(string)
		if idx, ok := s.toolIndexByID[callID]; ok && idx >= 0 && idx < len(s.timeline) {
			args := s.toolArgsByID[callID]
			s.timeline[idx].Item.Detail = BuildToolCallDetail(toolName, args, ev["partialResult"])
			s.streamSeq++
			s.timeline[idx].SeqEnd = s.streamSeq
			extraEvents = append(extraEvents, map[string]any{
				"type":   "byspace_stream_timeline",
				"seq":    s.streamSeq,
				"turnId": s.activeTurnID,
				"item":   s.timeline[idx].Item,
			})
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
		s.streamSeq++
		var targetIdx int
		if idx, ok := s.toolIndexByID[callID]; ok && idx >= 0 && idx < len(s.timeline) {
			s.timeline[idx].Item.Status = status
			s.timeline[idx].Item.Detail = detail
			s.timeline[idx].SeqEnd = s.streamSeq
			if isErr {
				s.timeline[idx].Item.Error = extractResultText(ev["result"])
			}
			targetIdx = idx
		} else {
			var errVal any
			if isErr {
				errVal = extractResultText(ev["result"])
			}
			targetIdx = s.appendItemWithSeqLocked(s.streamSeq, TimelineItem{
				Type:   "tool_call",
				CallID: callID,
				Name:   toolName,
				Status: status,
				Detail: detail,
				Error:  errVal,
			})
		}
		extraEvents = append(extraEvents, map[string]any{
			"type":   "byspace_stream_timeline",
			"seq":    s.streamSeq,
			"turnId": s.activeTurnID,
			"item":   s.timeline[targetIdx].Item,
		})
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
		if !willRetry && s.status == "running" {
			finishedTurnID := s.activeTurnID
			s.status = "idle"
			s.activeTurnID = ""
			s.turnStartedAt = ""
			s.activeTextIdx = -1
			s.activeThinkIdx = -1
			s.activeMessageID = ""
			s.streamedInTurn = false
			s.notifyFinishLocked(nil)
			extraEvents = append(extraEvents, map[string]any{
				"type":   "byspace_turn_completed",
				"turnId": finishedTurnID,
			})
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
		for _, ex := range extraEvents {
			fn(ex)
		}
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
	s.streamSeq++
	return s.appendItemWithSeqLocked(s.streamSeq, item)
}

func (s *Session) appendItemWithSeqLocked(seq int, item TimelineItem) int {
	entry := TimelineEntry{
		Seq:       seq,
		SeqEnd:    seq,
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
	maxSeq := 0
	for i := range s.timeline {
		if s.timeline[i].SeqEnd < s.timeline[i].Seq {
			s.timeline[i].SeqEnd = s.timeline[i].Seq
		}
		if s.timeline[i].SeqEnd > maxSeq {
			maxSeq = s.timeline[i].SeqEnd
		}
		if s.timeline[i].Item.Type == "user_message" {
			s.turnCounter++
		}
	}
	s.streamSeq = maxSeq
}

// StreamSeq returns the highest emitted sequence number.
func (s *Session) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streamSeq
}

// ActiveTurn returns the active turnId and startedAt ISO timestamp when status is "running".
func (s *Session) ActiveTurn() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != "running" || s.activeTurnID == "" {
		return "", ""
	}
	return s.activeTurnID, s.turnStartedAt
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

// SetNextClientMessageID records the client-supplied message ID for deduplicating the next user prompt.
func (s *Session) SetNextClientMessageID(id string) {
	s.mu.Lock()
	s.nextClientMessageID = strings.TrimSpace(id)
	s.mu.Unlock()
}

// Prompt sends a user prompt to Pi and appends the user_message to the timeline.
func (s *Session) Prompt(ctx context.Context, message string, images []ImageContent) error {
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.turnStartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.activeMessageID = ""
	s.streamedInTurn = false
	s.status = "running"

	clientMsgID := s.nextClientMessageID
	s.nextClientMessageID = ""
	msgID := clientMsgID
	if msgID == "" {
		msgID = fmt.Sprintf("user_%d_%d", s.turnCounter, len(s.timeline)+1)
	}
	userItem := TimelineItem{
		Type:            "user_message",
		Text:            message,
		MessageID:       msgID,
		ClientMessageID: clientMsgID,
	}
	idx := s.appendItemLocked(userItem)
	seq := s.timeline[idx].SeqEnd
	turnID := s.activeTurnID

	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	for _, fn := range subs {
		fn(map[string]any{
			"type":   "byspace_turn_started",
			"turnId": turnID,
		})
		fn(map[string]any{
			"type":   "byspace_stream_timeline",
			"seq":    seq,
			"turnId": turnID,
			"item":   userItem,
		})
	}

	cmd := map[string]any{
		"type":    "prompt",
		"message": message,
	}
	if len(images) > 0 {
		blocks := make([]map[string]any, 0, len(images))
		for _, img := range images {
			if img.Data == "" {
				continue
			}
			mimeType := img.MimeType
			if mimeType == "" {
				mimeType = "image/png"
			}
			blocks = append(blocks, map[string]any{
				"type":     "image",
				"data":     img.Data,
				"mimeType": mimeType,
			})
		}
		if len(blocks) > 0 {
			cmd["images"] = blocks
		}
	}
	go func() {
		rctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if _, err := s.proc.Request(rctx, cmd); err != nil {
			s.mu.Lock()
			if s.status == "running" {
				s.status = "idle"
				s.activeTurnID = ""
				s.notifyFinishLocked(err)
			}
			s.mu.Unlock()
		}
	}()
	_ = ctx
	return nil
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
