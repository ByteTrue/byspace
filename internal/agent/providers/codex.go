package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ByteTrue/byspace/internal/agent/pi"
	"io"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// CodexSession hosts a `codex app-server` JSON-RPC 2.0 subprocess.
type CodexSession struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser

	writeMu sync.Mutex
	nextID  atomic.Int64

	// lastUsage is the token accounting from the most recent turn, for the context ring.
	lastUsage *sdk.AgentUsage

	mu           sync.Mutex
	pending      map[int64]chan map[string]any
	status       string
	threadID     string
	cwd          string
	model        string
	thinking     string
	turnCounter  int
	activeTurnID string
	// turnIDs is every turn the thread has run, in order. Rewind works in turns rather than messages, so
	// resolving a message to a turn needs this list.
	turnIDs []string
	// nativeTurnID is Codex's own turn id, which `turn/steer` requires. activeTurnID is ours and
	// means nothing to the provider.
	nativeTurnID       string
	activeTextIdx      int
	activeThinkIdx     int
	timeline           []sdk.TimelineEntry
	toolIndexByID      map[string]int
	pendingPermissions map[string]map[string]any
	permissionRPCIDs   map[string]any
	subagents          map[string]sdk.SubagentDescriptor
	finishWaiters      []chan error
	eventSubscribers   map[int]func(map[string]any)
	nextSubID          int
	closed             bool
}

// StartCodexSession launches `codex app-server` and initializes a thread.
func StartCodexSession(cfg LaunchConfig, cmdOverride string) (*CodexSession, error) {
	bin := strings.TrimSpace(cmdOverride)
	if bin == "" {
		bin = "codex"
	}
	args := []string{"app-server"}
	cmd := exec.Command(bin, args...)
	if cfg.Cwd != "" {
		cmd.Dir = cfg.Cwd
	}
	if len(cfg.Env) > 0 {
		cmd.Env = cfg.Env
	} else {
		cmd.Env = os.Environ()
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	s := &CodexSession{
		cmd:                cmd,
		stdin:              stdin,
		pending:            make(map[int64]chan map[string]any),
		status:             "idle",
		cwd:                cfg.Cwd,
		model:              cfg.Model,
		thinking:           cfg.ThinkingOptionID,
		activeTextIdx:      -1,
		activeThinkIdx:     -1,
		toolIndexByID:      make(map[string]int),
		pendingPermissions: make(map[string]map[string]any),
		permissionRPCIDs:   make(map[string]any),
		subagents:          make(map[string]sdk.SubagentDescriptor),
		eventSubscribers:   make(map[int]func(map[string]any)),
	}
	go s.readLoop(stdout)

	// Best-effort initialize + thread/start handshake
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = s.rpcCall(ctx, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "byspace",
			"version": "0.20.2",
		},
	})
	if cfg.SessionHandle != "" {
		s.threadID = cfg.SessionHandle
		_, _ = s.rpcCall(ctx, "thread/resume", map[string]any{
			"threadId": cfg.SessionHandle,
		})
	} else {
		startParams := map[string]any{
			"cwd":   cfg.Cwd,
			"model": cfg.Model,
		}
		// Codex takes its provider settings and MCP servers as an inner `config` object. Without it a
		// user's sandbox_mode / approval_policy never reached the process, and the BySpace MCP bridge
		// was never registered — so the 37 orchestration tools did not exist for a Codex agent.
		if inner := codexInnerConfig(cfg); len(inner) > 0 {
			startParams["config"] = inner
		}
		res, err := s.rpcCall(ctx, "thread/start", startParams)
		if err == nil {
			if th, ok := res["thread"].(map[string]any); ok {
				if tid, ok := th["id"].(string); ok {
					s.threadID = tid
				}
			}
		}
	}
	if s.threadID == "" {
		s.threadID = "th_codex_1"
	}

	return s, nil
}

func (s *CodexSession) rpcCall(ctx context.Context, method string, params map[string]any) (map[string]any, error) {
	id := s.nextID.Add(1)
	ch := make(chan map[string]any, 1)

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, fmt.Errorf("codex process closed")
	}
	s.pending[id] = ch
	s.mu.Unlock()

	req := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}
	if err := s.sendJSON(req); err != nil {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return nil, err
	}

	select {
	case resp := <-ch:
		if errObj, ok := resp["error"].(map[string]any); ok {
			msg, _ := errObj["message"].(string)
			return nil, fmt.Errorf("codex rpc error: %s", msg)
		}
		res, _ := resp["result"].(map[string]any)
		return res, nil
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return nil, ctx.Err()
	}
}

func (s *CodexSession) sendJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.stdin.Write(b)
	return err
}

func (s *CodexSession) readLoop(stdout io.Reader) {
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var msg map[string]any
		if json.Unmarshal(sc.Bytes(), &msg) != nil {
			continue
		}
		method, hasMethod := msg["method"].(string)
		idVal, hasID := msg["id"]

		if hasID && !hasMethod {
			var numID int64
			switch v := idVal.(type) {
			case float64:
				numID = int64(v)
			case int64:
				numID = v
			}
			s.mu.Lock()
			ch, ok := s.pending[numID]
			if ok {
				delete(s.pending, numID)
			}
			s.mu.Unlock()
			if ok {
				ch <- msg
			}
			continue
		}

		if hasMethod {
			s.handleNotificationOrRequest(method, idVal, msg)
		}
	}

	s.mu.Lock()
	s.closed = true
	s.status = "closed"
	for id, ch := range s.pending {
		delete(s.pending, id)
		ch <- map[string]any{"error": map[string]any{"message": "process exited"}}
	}
	s.notifyFinishLocked(fmt.Errorf("codex process exited"))
	s.mu.Unlock()
}

func (s *CodexSession) handleNotificationOrRequest(method string, rpcID any, msg map[string]any) {
	params, _ := msg["params"].(map[string]any)
	var extraEvents []map[string]any

	s.mu.Lock()
	switch method {
	case "turn/started":
		s.status = "running"
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		// Codex's own turn id, needed by turn/steer. `turn/start` returns it too, but the
		// notification is authoritative and arrives for turns we did not start (a resumed
		// thread, a retry).
		if turn, ok := params["turn"].(map[string]any); ok {
			if id, ok := turn["id"].(string); ok && id != "" {
				s.nativeTurnID = id
				s.recordTurnIDLocked(id)
			}
		}
		if id, ok := params["turnId"].(string); ok && id != "" {
			s.nativeTurnID = id
			s.recordTurnIDLocked(id)
		}
		extraEvents = append(extraEvents, map[string]any{"type": "turn_start"})

	case "item/agentMessage/delta", "codex/event/agent_message_delta":
		delta, _ := params["delta"].(string)
		if delta != "" {
			if s.activeTextIdx < 0 || s.activeTextIdx >= len(s.timeline) {
				s.activeTextIdx = s.appendItemLocked(sdk.TimelineItem{
					Type: "assistant_message",
					Text: delta,
				})
			} else {
				s.timeline[s.activeTextIdx].Item.Text += delta
			}
		}

	case "item/reasoning/summaryTextDelta", "codex/event/reasoning_delta":
		delta, _ := params["delta"].(string)
		if delta != "" {
			if s.activeThinkIdx < 0 || s.activeThinkIdx >= len(s.timeline) {
				s.activeThinkIdx = s.appendItemLocked(sdk.TimelineItem{
					Type: "reasoning",
					Text: delta,
				})
			} else {
				s.timeline[s.activeThinkIdx].Item.Text += delta
			}
		}

	case "item/started":
		if item, ok := params["item"].(map[string]any); ok {
			itemType, _ := item["type"].(string)
			itemID, _ := item["id"].(string)
			if itemType == "commandExecution" {
				cmdStr, _ := item["command"].(string)
				idx := s.appendItemLocked(sdk.TimelineItem{
					Type:   "tool_call",
					CallID: itemID,
					Name:   "bash",
					Status: "running",
					Detail: sdk.BuildToolCallDetail("bash", map[string]any{"command": cmdStr}, nil),
					Error:  nil,
				})
				if itemID != "" {
					s.toolIndexByID[itemID] = idx
				}
				extraEvents = append(extraEvents, map[string]any{
					"type":       "tool_execution_start",
					"toolCallId": itemID,
					"toolName":   "bash",
				})
			}
		}

	case "item/completed":
		if item, ok := params["item"].(map[string]any); ok {
			itemType, _ := item["type"].(string)
			itemID, _ := item["id"].(string)
			switch itemType {
			case "agentMessage":
				txt, _ := item["text"].(string)
				if txt != "" && s.activeTextIdx < 0 {
					s.activeTextIdx = s.appendItemLocked(sdk.TimelineItem{
						Type: "assistant_message",
						Text: txt,
					})
				}
				extraEvents = append(extraEvents, map[string]any{"type": "message_end"})
			case "commandExecution":
				outStr, _ := item["aggregatedOutput"].(string)
				cmdStr, _ := item["command"].(string)
				if idx, ok := s.toolIndexByID[itemID]; ok && idx >= 0 && idx < len(s.timeline) {
					s.timeline[idx].Item.Status = "completed"
					s.timeline[idx].Item.Detail = sdk.BuildToolCallDetail("bash", map[string]any{"command": cmdStr}, outStr)
				}
				extraEvents = append(extraEvents, map[string]any{
					"type":       "tool_execution_end",
					"toolCallId": itemID,
				})
			}
		}

	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		reqID := fmt.Sprintf("codex_perm_%v", rpcID)
		s.permissionRPCIDs[reqID] = rpcID
		perm := map[string]any{
			"id":       reqID,
			"provider": "codex",
			"name":     method,
			"kind":     "tool",
			"title":    "Approve Codex action?",
			"input":    params,
		}
		s.pendingPermissions[reqID] = perm
		extraEvents = append(extraEvents, map[string]any{
			"type":    "extension_ui_request",
			"id":      reqID,
			"method":  "confirm",
			"title":   "Approve Codex action?",
			"message": method,
		})

	case "item/tool/requestUserInput", "tool/requestUserInput", "codex/event/request_user_input":
		// Codex asks the user a structured question and blocks the turn until it is answered.
		// Without handling this the turn stalls: the agent is waiting, nothing is shown, and
		// the only symptom is "it stopped".
		reqID := fmt.Sprintf("codex_question_%v", rpcID)
		s.permissionRPCIDs[reqID] = rpcID

		// The payload is one or more questions, each with a title and optional choices.
		questions := make([]map[string]any, 0, 3)
		rawQuestions, _ := params["questions"].([]any)
		for index, raw := range rawQuestions {
			question, _ := raw.(map[string]any)
			title, _ := question["title"].(string)
			options := make([]map[string]any, 0, 4)
			if rawOptions, ok := question["options"].([]any); ok {
				for _, rawOption := range rawOptions {
					label, _ := rawOption.(string)
					if label != "" {
						options = append(options, map[string]any{"label": label})
					}
				}
			}
			questions = append(questions, map[string]any{
				"id":       fmt.Sprintf("%d", index),
				"header":   fmt.Sprintf("Question %d", index+1),
				"question": title,
				"options":  options,
				// The user can always type something else; a fixed list is a suggestion.
				"isOther": true,
			})
		}

		questionInput := map[string]any{"questions": questions}
		s.pendingPermissions[reqID] = map[string]any{
			"id":       reqID,
			"provider": "codex",
			"name":     "request_user_input_async",
			"kind":     "question",
			"title":    "Question",
			"input":    questionInput,
		}
		extraEvents = append(extraEvents, map[string]any{
			"type":    "extension_ui_request",
			"id":      reqID,
			"method":  "select",
			"title":   "Question",
			"message": firstQuestionTitle(questions),
		})

	case "thread/tokenUsage/updated", "codex/event/token_usage":
		// Ported from toAgentUsage. `last` is the most recent request's usage; the context
		// window is the model's, not the request's.
		if usage := codexAgentUsage(params); usage != nil {
			s.lastUsage = usage
		}

	case "turn/completed", "codex/event/task_complete":
		if s.activeTextIdx >= 0 {
			extraEvents = append(extraEvents, map[string]any{"type": "message_end"})
		}
		s.status = "idle"
		s.activeTurnID = ""
		s.nativeTurnID = ""
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		s.notifyFinishLocked(nil)
		extraEvents = append(extraEvents, map[string]any{"type": "agent_end"})
	}

	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	for _, fn := range subs {
		for _, ex := range extraEvents {
			fn(ex)
		}
	}
}

func (s *CodexSession) appendItemLocked(item sdk.TimelineItem) int {
	seq := len(s.timeline) + 1
	s.timeline = append(s.timeline, sdk.TimelineEntry{
		Seq:       seq,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      item,
	})
	return len(s.timeline) - 1
}

func (s *CodexSession) notifyFinishLocked(err error) {
	waiters := s.finishWaiters
	s.finishWaiters = nil
	for _, ch := range waiters {
		ch <- err
		close(ch)
	}
}

func (s *CodexSession) Status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *CodexSession) Timeline() []sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *CodexSession) SeedTimeline(entries []sdk.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]sdk.TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

func (s *CodexSession) SetNextClientMessageID(_ string) {}

func (s *CodexSession) LastError() string {
	return ""
}

// TurnToken returns "" for providers without an explicit turn token; the daemon then relies
// on its own turn id comparison.
func (s *CodexSession) TurnToken() string { return "" }

// Usage reports the token accounting the app-server most recently announced.
//
// The context-window ring in the composer reads this; without it a Codex agent shows no usage at
// all even though the provider reports it on every turn.
func (s *CodexSession) Usage(_ context.Context) *sdk.AgentUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastUsage == nil {
		return nil
	}
	usage := *s.lastUsage
	return &usage
}

func (s *CodexSession) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.timeline)
}

func (s *CodexSession) ActiveTurn() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != "running" {
		return "", ""
	}
	return s.activeTurnID, ""
}

func (s *CodexSession) LastAssistantText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.timeline) - 1; i >= 0; i-- {
		if s.timeline[i].Item.Type == "assistant_message" {
			return s.timeline[i].Item.Text
		}
	}
	return ""
}

func (s *CodexSession) Prompt(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.status = "running"
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.appendItemLocked(sdk.TimelineItem{
		Type: "user_message",
		Text: message,
	})
	tid := s.threadID
	s.mu.Unlock()

	input := []map[string]any{{"type": "text", "text": message}}
	input = append(input, imageBlocksForCodex(images)...)
	_, err := s.rpcCall(ctx, "turn/start", map[string]any{
		"threadId": tid,
		"input":    input,
	})
	return err
}

// Steer delivers a message into the turn that is already running.
//
// Codex has a dedicated `turn/steer` for this. Falling back to Prompt starts a *new* turn while
// the current one is still going: the user's correction is not applied to the work in progress,
// and two turns write to the same thread.
func (s *CodexSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	running := s.status == "running"
	threadID := s.threadID
	expectedTurnID := s.nativeTurnID
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.appendItemLocked(sdk.TimelineItem{
		Type: "user_message",
		Text: message,
	})
	s.mu.Unlock()

	if !running || expectedTurnID == "" {
		// Nothing to steer: the caller's behavior was "steer", but there is no active turn, so
		// this is an ordinary prompt. Without this the RPC would be rejected and the message lost.
		return s.Prompt(ctx, message, images)
	}

	input := []map[string]any{{"type": "text", "text": message}}
	input = append(input, imageBlocksForCodex(images)...)
	_, err := s.rpcCall(ctx, "turn/steer", map[string]any{
		"threadId":       threadID,
		"expectedTurnId": expectedTurnID,
		"input":          input,
	})
	return err
}

func (s *CodexSession) Abort(ctx context.Context) error {
	s.mu.Lock()
	tid := s.threadID
	s.mu.Unlock()
	_, _ = s.rpcCall(ctx, "turn/interrupt", map[string]any{"threadId": tid})
	return nil
}

func (s *CodexSession) WaitForFinish(ctx context.Context) error {
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

func (s *CodexSession) GetState(_ context.Context) (*sdk.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &sdk.SessionState{
		SessionID:     s.threadID,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}, nil
}

func (s *CodexSession) SetModel(_ context.Context, provider, modelID string) (*sdk.Model, error) {
	s.mu.Lock()
	s.model = modelID
	s.mu.Unlock()
	return &sdk.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *CodexSession) SetThinkingLevel(_ context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

func (s *CodexSession) GetCommands(_ context.Context) ([]sdk.SlashCommand, error) {
	return []sdk.SlashCommand{
		{Name: "compact", Description: "Compact thread context", Source: "builtin"},
	}, nil
}

func (s *CodexSession) PendingPermissions() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]map[string]any, 0, len(s.pendingPermissions))
	for _, p := range s.pendingPermissions {
		out = append(out, p)
	}
	return out
}

func (s *CodexSession) RespondToPermission(requestID string, resp map[string]any) error {
	s.mu.Lock()
	rpcID, ok := s.permissionRPCIDs[requestID]
	pending := s.pendingPermissions[requestID]
	delete(s.permissionRPCIDs, requestID)
	delete(s.pendingPermissions, requestID)
	s.mu.Unlock()
	if !ok {
		return nil
	}

	// A question and an approval are different RPCs: the question expects the answers, the
	// approval expects a decision. Sending `decision` to a question leaves Codex waiting
	// forever on a reply it cannot parse.
	if kind, _ := pending["kind"].(string); kind == "question" {
		return s.sendJSON(map[string]any{
			"jsonrpc": "2.0",
			"id":      rpcID,
			"result": map[string]any{
				"answers": questionAnswersFrom(resp),
			},
		})
	}

	decision := "accept"
	if b, _ := resp["behavior"].(string); b == "deny" {
		decision = "decline"
	}
	return s.sendJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      rpcID,
		"result": map[string]any{
			"decision": decision,
		},
	})
}

// questionAnswersFrom extracts the answers Codex expects: one string per question, in order.
//
// The client sends the answers either as a list or keyed by question id; both are flattened to
// the ordered list the protocol wants.
func questionAnswersFrom(resp map[string]any) []string {
	answers := make([]string, 0, 3)
	if updated, ok := resp["updatedInput"].(map[string]any); ok {
		if raw, ok := updated["answers"]; ok {
			switch value := raw.(type) {
			case []any:
				for _, item := range value {
					if text, isString := item.(string); isString {
						answers = append(answers, text)
					}
				}
			case map[string]any:
				// Ordered by the numeric id so "1" does not sort before "10".
				keys := make([]string, 0, len(value))
				for key := range value {
					keys = append(keys, key)
				}
				sort.Slice(keys, func(i, j int) bool { return numericLess(keys[i], keys[j]) })
				for _, key := range keys {
					if text, isString := value[key].(string); isString {
						answers = append(answers, text)
					}
				}
			case string:
				answers = append(answers, value)
			}
		}
	}
	if len(answers) == 0 {
		if text, ok := resp["answer"].(string); ok && text != "" {
			answers = append(answers, text)
		}
	}
	if len(answers) == 0 {
		// A denied question still needs a reply, or Codex waits forever.
		answers = append(answers, "")
	}
	return answers
}

// numericLess compares two ids numerically when both are numbers, lexically otherwise.
func numericLess(a, b string) bool {
	ai, aErr := strconv.Atoi(a)
	bi, bErr := strconv.Atoi(b)
	if aErr == nil && bErr == nil {
		return ai < bi
	}
	return a < b
}

func (s *CodexSession) ListSubagents(_ string) []sdk.SubagentDescriptor {
	return []sdk.SubagentDescriptor{}
}

func (s *CodexSession) GetSubagent(_, _ string) (sdk.SubagentDescriptor, bool) {
	return sdk.SubagentDescriptor{}, false
}

func (s *CodexSession) OnEvent(fn func(map[string]any)) func() {
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

func (s *CodexSession) Close() error {
	_ = s.stdin.Close()
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return nil
}

// firstQuestionTitle is the question text to show in the notification.
//
// The panel renders the full structured input; the notice has room for one line, and a question
// with no text would show nothing at all.
func firstQuestionTitle(questions []map[string]any) string {
	if len(questions) == 0 {
		return "Codex is waiting for your input"
	}
	if title, ok := questions[0]["question"].(string); ok && title != "" {
		return title
	}
	return "Codex is waiting for your input"
}

// codexAgentUsage maps the app-server's tokenUsage payload onto the protocol's usage shape.
//
// Returns nil when the payload carries nothing usable: an empty usage object must not reset a
// previously reported one to zero.
func codexAgentUsage(params map[string]any) *sdk.AgentUsage {
	raw, _ := params["tokenUsage"].(map[string]any)
	if raw == nil {
		raw = params
	}
	if raw == nil {
		return nil
	}
	last, _ := raw["last"].(map[string]any)

	usage := &sdk.AgentUsage{}
	changed := false
	if last != nil {
		if value, ok := numericParam(last, "inputTokens"); ok {
			usage.InputTokens = value
			changed = true
		}
		if value, ok := numericParam(last, "cachedInputTokens"); ok {
			usage.CachedInputTokens = value
			changed = true
		}
		if value, ok := numericParam(last, "outputTokens"); ok {
			usage.OutputTokens = value
			changed = true
		}
	}
	// The context window is the model's, spelled two ways depending on the app-server version.
	if window, ok := numericParam(raw, "model_context_window"); ok && window > 0 {
		usage.ContextWindowMaxTokens = &window
		changed = true
	} else if window, ok := numericParam(raw, "modelContextWindow"); ok && window > 0 {
		usage.ContextWindowMaxTokens = &window
		changed = true
	}
	if last != nil {
		if used, ok := numericParam(last, "total_tokens"); ok && used > 0 {
			usage.ContextWindowUsedTokens = &used
			changed = true
		} else if used, ok := numericParam(last, "totalTokens"); ok && used > 0 {
			usage.ContextWindowUsedTokens = &used
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return usage
}

// codexInnerConfig assembles the `config` object Codex's thread/start and thread/resume accept.
//
// Ported from buildCodexInnerConfig: the user's provider options, then the MCP servers, then the
// pre-approved tool grants. Order matters — ApplyCodexToolPolicy reads the servers it must annotate, so
// it has to run after they are in place.
func codexInnerConfig(cfg LaunchConfig) map[string]any {
	inner := make(map[string]any, len(cfg.ProviderOptions)+2)
	for key, value := range cfg.ProviderOptions {
		inner[key] = value
	}

	if len(cfg.MCPServers) > 0 {
		servers := make(map[string]any, len(cfg.MCPServers))
		for _, server := range cfg.MCPServers {
			servers[server.Name] = codexMCPServerConfig(server)
		}
		inner["mcp_servers"] = servers
	}

	return ApplyCodexToolPolicy(inner, cfg.PreapprovedTools)
}

// codexMCPServerConfig renders one MCP server the way Codex expects it.
//
// Codex distinguishes a stdio server (a command) from a remote one (a url); sending both keys makes it
// pick the command and ignore the url, so the shape is decided here rather than by whichever field the
// provider happened to set.
func codexMCPServerConfig(server pi.MCPConfig) map[string]any {
	config := map[string]any{}
	if command := strings.TrimSpace(server.Command); command != "" {
		config["command"] = command
		if len(server.Args) > 0 {
			args := make([]any, 0, len(server.Args))
			for _, arg := range server.Args {
				args = append(args, arg)
			}
			config["args"] = args
		}
		return config
	}
	if url := strings.TrimSpace(server.URL); url != "" {
		config["url"] = url
	}
	return config
}

// recordTurnIDLocked appends a turn id once.
//
// Codex announces the same turn from both `turn/started` and the `turn/start` response; recording twice would make
// rewind's turn count wrong and roll back one turn too many.
func (s *CodexSession) recordTurnIDLocked(id string) {
	for _, existing := range s.turnIDs {
		if existing == id {
			return
		}
	}
	s.turnIDs = append(s.turnIDs, id)
}

// RewindCapabilities reports what this provider can rewind.
//
// Codex rolls the thread back; the working tree is untouched, so files are not restored.
func (s *CodexSession) RewindCapabilities() RewindCapabilities {
	return RewindCapabilities{Conversation: true}
}

// Rewind rolls the conversation back to a turn.
//
// Ported from codex/rewind.ts. Codex counts in TURNS, not messages: `thread/rollback` takes how many turns to drop from
// the end. The message id is resolved to its position in `turnIDs`, which is why every turn id is recorded as it
// starts.
func (s *CodexSession) RewindConversation(ctx context.Context, messageID string) error {
	trimmed := strings.TrimSpace(messageID)
	if trimmed == "" {
		return errors.New("rewind needs a message id")
	}

	s.mu.Lock()
	threadID := s.threadID
	turns := append([]string(nil), s.turnIDs...)
	targetIndex := -1
	for index, entry := range s.timeline {
		if entry.Item.MessageID == trimmed && entry.Item.Type == "user_message" {
			// Count the turns that started at or before this message.
			targetIndex = index
			break
		}
	}
	s.mu.Unlock()

	if threadID == "" {
		return errors.New("rewind needs a thread")
	}
	if targetIndex < 0 {
		return fmt.Errorf("no user message with id %q in this thread", trimmed)
	}
	if len(turns) == 0 {
		return errors.New("rewind needs at least one turn")
	}

	// Codex can only drop turns from the end, so a message in the middle asks for everything after it to go.
	dropped := 1
	s.mu.Lock()
	for index, entry := range s.timeline {
		if index <= targetIndex {
			continue
		}
		if entry.Item.Type == "user_message" {
			dropped++
		}
	}
	s.mu.Unlock()
	if dropped > len(turns) {
		dropped = len(turns)
	}

	if _, err := s.rpcCall(ctx, "thread/rollback", map[string]any{
		"threadId": threadID,
		"numTurns": dropped,
	}); err != nil {
		return err
	}

	// The rolled-back turns are gone; the client's transcript is wrong until it is re-read.
	s.mu.Lock()
	s.turnIDs = s.turnIDs[:len(s.turnIDs)-dropped]
	s.status = "idle"
	s.nativeTurnID = ""
	s.mu.Unlock()
	return nil
}

// TreeEntryForMessage maps a message id to the provider's own reference.
//
// Codex addresses turns, resolved inside RewindConversation from the recorded turn list, so the identity mapping is
// correct here too.
func (s *CodexSession) TreeEntryForMessage(messageID string) (string, bool) {
	trimmed := strings.TrimSpace(messageID)
	return trimmed, trimmed != ""
}
