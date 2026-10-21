package pi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/activity"
	"github.com/ByteTrue/byspace/internal/agent/jsonl"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
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

// The agent-facing types live in internal/agent/sdk so every provider shares one definition;
// these aliases keep the pi-local spelling for call sites that predate the move.
type (
	ImageContent       = sdk.ImageContent
	PromptImage        = sdk.PromptImage
	Model              = sdk.Model
	SessionState       = sdk.SessionState
	SessionStats       = sdk.SessionStats
	AgentUsage         = sdk.AgentUsage
	SlashCommand       = sdk.SlashCommand
	TimelineItem       = sdk.TimelineItem
	TimelineEntry      = sdk.TimelineEntry
	SubagentDescriptor = sdk.SubagentDescriptor
)

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
	// AppendSystemPrompt is omp's `--append-system-prompt`. pi injects the prompt through the
	// integration extension instead; the two providers do not offer the same mechanism.
	AppendSystemPrompt string
	// NoApprove suppresses the `--approve` flag for providers that do not have it. omp rejects
	// unknown flags outright, so sending pi's flags made it exit immediately.
	NoApprove bool
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
	if prompt := strings.TrimSpace(opts.AppendSystemPrompt); prompt != "" {
		argv = append(argv, "--append-system-prompt", prompt)
	}
	if !opts.NoApprove && !hasApproveFlag(argv) {
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
	turnToken           string
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
	commandWaiters      map[string]chan commandResult
	treeEntries         map[string]string
	ready               bool
	cleanup             func()
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
		commandWaiters:     make(map[string]chan commandResult),
		treeEntries:        make(map[string]string),
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
		// omp wraps some calls in `xdev` and names the real tool in the result. Resolving it before the
		// detail is built is what makes the card show the command or file rather than a generic row.
		resolvedName := resolveWrappedToolName(toolName, ev["result"])
		detail := BuildToolCallDetail(resolvedName, args, ev["result"])
		// A command's stdout is whatever it printed — a build log, a minified bundle, a `cat` of a
		// large file — and it travels to every client on every timeline fetch. Capping it here means
		// the oversized body never reaches the transcript, so it is not re-sent on every fetch.
		limitedDetail, limitedError := limitToolCall(detail, status, ev["result"], isErr)
		detail = limitedDetail
		s.streamSeq++
		var targetIdx int
		if idx, ok := s.toolIndexByID[callID]; ok && idx >= 0 && idx < len(s.timeline) {
			s.timeline[idx].Item.Status = status
			s.timeline[idx].Item.Detail = detail
			if resolvedName != "" && resolvedName != toolName {
				s.timeline[idx].Item.Name = resolvedName
			}
			s.timeline[idx].SeqEnd = s.streamSeq
			if isErr {
				s.timeline[idx].Item.Error = limitedError
			}
			targetIdx = idx
		} else {
			var errVal any
			if isErr {
				errVal = limitedError
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
		// `ctx.ui.notify` is how an extension reports data back to its host: the integration
		// extension uses it to deliver entry captures and tree-navigation results. Those are
		// ours to consume, not user-facing UI requests.
		if method, _ := ev["method"].(string); method == "notify" {
			if message, _ := ev["message"].(string); message != "" {
				s.handleExtensionNotification(message)
			}
			break
		}
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
				// The token lets the daemon drop a completion that arrives after a newer
				// turn has already started.
				"turnToken": s.turnToken,
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
		Seq:    seq,
		SeqEnd: seq,
		TurnID: s.activeTurnID,
		// Bound tool output on the way in: the row is stored and re-sent on every timeline
		// fetch, so an unbounded `cat` result makes every later refresh multi-megabyte.
		Item:      sdk.LimitTimelineItemContent(item),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
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

// LastError returns the provider's last fatal error message, if any.
func (s *Session) LastError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastError
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

// TurnToken identifies the turn that currently owns the session.
//
// The daemon compares it against the token on a completion event: a completion that carries a
// token from an older turn must not flip the newer turn to idle.
func (s *Session) TurnToken() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turnToken
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
	// A turn token makes a late event from the previous turn identifiable. Pi emits one
	// `turn_end` per model step, and a second prompt can start before the first turn's
	// completion event is fully processed; without a token, the stale completion would flip
	// the new turn to idle and the UI would stop showing it as running.
	s.turnToken = fmt.Sprintf("tok_%d", s.turnCounter)
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
// errSessionClosed is what a waiter receives when the agent is closed mid-turn.
var errSessionClosed = errors.New("agent closed")

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
// Ready reports whether pi has finished starting up.
//
// pi does not answer get_state until its runtime is listening, and a request sent earlier sits
// unread: the daemon's startup persistence sync ran ahead of the first prompt and left the stdio
// queue stuck, so the agent accepted an initialPrompt and then produced nothing.
func (s *Session) Ready() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ready
}

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

// GetSessionStats queries token and cost accounting for the session.
// Older pi builds lack this command; callers fall back to GetState.
func (s *Session) GetSessionStats(ctx context.Context) (*SessionStats, error) {
	raw, err := s.proc.Request(ctx, map[string]any{"type": "get_session_stats"})
	if err != nil {
		return nil, err
	}
	var stats *SessionStats
	if err := json.Unmarshal(raw, &stats); err != nil {
		return nil, err
	}
	return stats, nil
}

// Usage returns the composer-facing usage snapshot for this session.
func (s *Session) Usage(ctx context.Context) *AgentUsage {
	stats, err := s.GetSessionStats(ctx)
	if err != nil {
		return nil
	}
	return usageFromStats(stats)
}

// usageFromStats converts session stats into the shape the composer renders, or nil when
// there is nothing to show. Mirrors toAgentUsage in archive/.../pi/usage-poller.ts.
func usageFromStats(st *SessionStats) *AgentUsage {
	if st == nil {
		return nil
	}
	usage := AgentUsage{
		InputTokens:       st.Tokens["input"],
		CachedInputTokens: st.Tokens["cacheRead"],
		OutputTokens:      st.Tokens["output"],
		TotalCostUSD:      st.Cost,
	}
	if st.ContextUsage != nil {
		usage.ContextWindowMaxTokens = st.ContextUsage.ContextWindow
		usage.ContextWindowUsedTokens = st.ContextUsage.Tokens
	}
	if usage.InputTokens == 0 && usage.CachedInputTokens == 0 && usage.OutputTokens == 0 &&
		usage.TotalCostUSD == 0 && usage.ContextWindowMaxTokens == nil && usage.ContextWindowUsedTokens == nil {
		return nil
	}
	return &usage
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
	// The protocol requires description and argumentHint on every command, and pi sends neither. An
	// empty value fails the whole list_commands_response, which empties the palette for every provider
	// rather than for one — so the defaults are filled here rather than left to the client.
	for index := range wrapper.Commands {
		command := &wrapper.Commands[index]
		if strings.TrimSpace(command.Name) == "" {
			continue
		}
		if strings.TrimSpace(command.Description) == "" {
			command.Description = command.Name
		}
		if command.ArgumentHint == "" {
			command.ArgumentHint = ""
		}
		if strings.TrimSpace(command.Kind) == "" {
			command.Kind = "command"
		}
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
	// Wake every wait_for_finish waiter before tearing down: a close mid-turn would otherwise
	// leave `byspace wait` blocked until its own timeout, long after the agent is gone.
	s.mu.Lock()
	if s.status == "running" {
		s.status = "idle"
	}
	waiters := s.finishWaiters
	s.finishWaiters = nil
	s.mu.Unlock()
	for _, ch := range waiters {
		select {
		case ch <- errSessionClosed:
		default:
		}
	}

	err := s.proc.Close()
	// The generated extension lives in a temp dir; leaving it behind leaks one directory per
	// agent over a long-running daemon.
	s.mu.Lock()
	cleanup := s.cleanup
	s.cleanup = nil
	s.mu.Unlock()
	if cleanup != nil {
		cleanup()
	}
	return err
}

// readyTimeout bounds how long StartSession waits for pi's startup sequence. A cold start with
// several extensions loading takes a moment; a minute is generous without hanging a request.
const readyTimeout = 60 * time.Second

// waitForReady blocks until pi has started its session.
func (s *Session) waitForReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		ready := s.ready
		closed := s.status == "closed"
		s.mu.Unlock()
		if ready {
			return nil
		}
		if closed {
			return fmt.Errorf("pi exited during startup")
		}
		time.Sleep(20 * time.Millisecond)
	}
	return fmt.Errorf("pi did not finish starting within %s", timeout)
}

// limitToolCall applies the timeline content limits to a freshly built tool call.
//
// The whole item goes through the limiter, not just the detail: a failed shell call keeps its stderr
// in the item's error field, and that is the field with the largest realistic body — a failing build
// writes everything there. Capping only the detail would bound stdout and leave stderr unbounded.
//
// Returns the detail and the error text, both possibly truncated.
func limitToolCall(detail map[string]any, status string, result any, failed bool) (map[string]any, any) {
	errorText := ""
	if failed {
		errorText = extractResultText(result)
	}
	if detail == nil {
		return nil, errorText
	}

	item := map[string]any{"type": "tool_call", "detail": detail, "status": status}
	if errorText != "" {
		// The one error shape the limiter knows: an object with a content string, which is what a
		// failed shell call produces.
		item["error"] = map[string]any{"content": errorText}
	}
	limited := activity.LimitTimelineItemContent(item)

	limitedDetail, ok := limited["detail"].(map[string]any)
	if !ok {
		limitedDetail = detail
	}
	if record, ok := limited["error"].(map[string]any); ok {
		if content, ok := record["content"].(string); ok {
			errorText = content
		}
	}
	return limitedDetail, errorText
}

// SetHostTools declares the daemon's orchestration tools to a provider that hosts them itself.
//
// omp has no MCP client in the modes BySpace uses, so the tools reach it through its RPC host-tool
// channel. Returns the tool names the provider accepted, which is the authoritative list — omp may refuse
// one whose schema it cannot parse, and silently assuming all of them are live means the model calls a
// tool that does not exist.
func (s *Session) SetHostTools(ctx context.Context, tools []map[string]any) ([]string, error) {
	if len(tools) == 0 {
		return nil, nil
	}
	raw, err := s.proc.Request(ctx, map[string]any{"type": "set_host_tools", "tools": tools})
	if err != nil {
		return nil, err
	}
	var wrapper struct {
		ToolNames []string `json:"toolNames"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.ToolNames, nil
}

// SendHostToolResult answers a host_tool_call.
//
// A result for a call the provider is not waiting on makes it report a protocol error, so the caller is
// responsible for only answering calls it parsed.
func (s *Session) SendHostToolResult(callID, output string, failed bool) error {
	message := map[string]any{
		"type":    "host_tool_result",
		"callId":  callID,
		"content": output,
	}
	if failed {
		message["isError"] = true
	}
	return s.proc.SendRaw(message)
}

// resolveWrappedToolName unwraps a tool whose real name arrives in its result.
//
// omp's `xdev` does this: the outer call is generic and `details.xdev.tool` names what actually ran. A
// resolver function is injected rather than imported to keep this package free of provider specifics; the
// providers package sets it at init.
var resolveWrappedToolName = func(toolName string, result any) string { return toolName }

// SetWrappedToolNameResolver installs the provider-specific unwrapper.
//
// Called once during package setup. It is a variable rather than an interface so the hot path — one call
// per tool result — does not pay for a dynamic dispatch.
func SetWrappedToolNameResolver(resolver func(toolName string, result any) string) {
	if resolver != nil {
		resolveWrappedToolName = resolver
	}
}
