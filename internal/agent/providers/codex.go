package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ByteTrue/byspace/internal/execres"
	"github.com/ByteTrue/byspace/internal/proc"
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
	// lastError is the provider's own text for the most recent failure.
	lastError   string
	terminalErr error

	mu              sync.Mutex
	pending         map[int64]chan map[string]any
	status          string
	threadID        string
	cwd             string
	model           string
	modelProvider   string
	thinking        string
	modeID          string
	featureValues   map[string]any
	providerOptions map[string]any
	systemPrompt    string
	// collaborationModes are Codex's answer to collaborationMode/list. Plan mode and the daemon's
	// system prompt both travel inside a collaboration mode's settings, so without this list there
	// is no way to send either.
	collaborationModes []codexCollaborationMode
	// collabAttempts bounds the retries: a build that never answers the list must not cost a
	// request (or the deadline) before every turn.
	collabAttempts      int
	turnCounter         int
	nextClientMessageID string
	// nextOutputSchema constrains the next turn's reply (turn/start outputSchema), then clears.
	nextOutputSchema map[string]any
	nextInputPrefix  []map[string]any
	innerConfig      map[string]any
	latestPlanText   string
	goalsEnabled     bool
	skills           map[string]codexSkill
	activeTurnID     string
	pendingUserIndex int
	pendingUserText  string
	pendingUserLocal bool
	// turnIDs is every turn the thread has run, in order. Rewind works in turns rather than messages, so
	// resolving a message to a turn needs this list.
	turnIDs []string
	// nativeTurnID is Codex's own turn id, which `turn/steer` requires. activeTurnID is ours and
	// means nothing to the provider.
	nativeTurnID       string
	activeTextIdx      int
	activeThinkIdx     int
	streamSeq          int
	frames             *sdk.StreamFrames
	emitMu             sync.Mutex
	timeline           []sdk.TimelineEntry
	toolIndexByID      map[string]int
	pendingPermissions map[string]map[string]any
	permissionRPCIDs   map[string]any
	subagents          map[string]sdk.SubagentDescriptor
	subagentTimelines  map[string][]sdk.TimelineEntry
	subagentOutputIdx  map[string]int
	finishWaiters      []chan error
	eventSubscribers   map[int]func(map[string]any)
	nextSubID          int
	closed             bool
	delivering         int
	closeRequested     bool
}

// StartCodexSession launches `codex app-server` and initializes a thread.
func StartCodexSession(cfg LaunchConfig, cmdOverride string) (*CodexSession, error) {
	return startCodexSessionWithArgs(cfg, cmdOverride, nil)
}

func startCodexSessionWithArgs(cfg LaunchConfig, cmdOverride string, commandArgs []string) (*CodexSession, error) {
	bin := strings.TrimSpace(cmdOverride)
	if bin == "" {
		bin = "codex"
	}
	goalsEnabled := codexBinarySupportsGoals(bin, commandArgs...)
	args := codexAppServerArgs(commandArgs)
	if goalsEnabled {
		args = append(args, "--enable", "goals")
	}
	cmd := proc.Command(bin, args...)
	if cfg.Cwd != "" {
		cmd.Dir = cfg.Cwd
	}
	if len(cfg.Env) > 0 {
		cmd.Env = cfg.Env
	} else {
		cmd.Env = os.Environ()
	}
	cmd.Env = execres.AppendStandardDirs(cmd.Env)

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
		modelProvider:      cfg.ModelProvider,
		thinking:           cfg.ThinkingOptionID,
		modeID:             cfg.ModeID,
		featureValues:      cfg.FeatureValues,
		providerOptions:    cfg.ProviderOptions,
		systemPrompt:       cfg.SystemPrompt,
		innerConfig:        codexInnerConfig(cfg),
		goalsEnabled:       goalsEnabled,
		activeTextIdx:      -1,
		activeThinkIdx:     -1,
		toolIndexByID:      make(map[string]int),
		pendingPermissions: make(map[string]map[string]any),
		permissionRPCIDs:   make(map[string]any),
		subagents:          make(map[string]sdk.SubagentDescriptor),
		subagentTimelines:  make(map[string][]sdk.TimelineEntry),
		subagentOutputIdx:  make(map[string]int),
		eventSubscribers:   make(map[int]func(map[string]any)),
	}
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	go s.readLoop(stdout)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	failStart := func(err error) (*CodexSession, error) {
		_ = s.Close()
		return nil, err
	}
	if _, err := s.rpcCall(ctx, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "byspace",
			"version": "0.20.2",
		},
		"capabilities": map[string]any{
			"experimentalApi": true, "mcpServerOpenaiFormElicitation": true,
		},
	}); err != nil {
		return failStart(fmt.Errorf("codex initialize: %w", err))
	}
	if cfg.SessionHandle != "" {
		if _, err := s.rpcCall(ctx, "thread/resume", map[string]any{
			"threadId": cfg.SessionHandle,
		}); err != nil {
			return failStart(fmt.Errorf("codex thread/resume: %w", err))
		}
		s.threadID = cfg.SessionHandle
	} else {
		startParams := map[string]any{
			"cwd":   cfg.Cwd,
			"model": cfg.Model,
		}
		if cfg.ModelProvider != "" {
			startParams["modelProvider"] = cfg.ModelProvider
		}
		// Codex takes its provider settings and MCP servers as an inner `config` object. Without it a
		// user's sandbox_mode / approval_policy never reached the process, and the BySpace MCP bridge
		// was never registered — so the 37 orchestration tools did not exist for a Codex agent.
		if inner := codexInnerConfig(cfg); len(inner) > 0 {
			startParams["config"] = inner
		}
		res, err := s.rpcCall(ctx, "thread/start", startParams)
		if err != nil {
			return failStart(fmt.Errorf("codex thread/start: %w", err))
		}
		th, _ := res["thread"].(map[string]any)
		tid, _ := th["id"].(string)
		if tid == "" {
			return failStart(fmt.Errorf("codex thread/start: response has no thread.id"))
		}
		s.threadID = tid
	}
	// Best effort, on its own budget: a slow `thread/start` (Codex starts its own MCP servers
	// first) must not eat the time this call needs, or the session runs without plan mode and
	// without the daemon's system prompt. `ensureCollaborationModes` retries it on a later turn.
	listCtx, listCancel := context.WithTimeout(context.Background(), 3*time.Second)
	s.loadCollaborationModes(listCtx)
	listCancel()

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

	s.flushTailOnExit()
	exitErr := fmt.Errorf("codex process exited")
	if scErr := sc.Err(); scErr != nil {
		exitErr = fmt.Errorf("codex process exited: %w", scErr)
	}
	s.mu.Lock()
	alreadyClosed := s.closed || s.closeRequested
	s.closed = true
	s.status = "closed"
	s.activeTurnID = ""
	s.nativeTurnID = ""
	if !alreadyClosed {
		s.lastError = exitErr.Error()
		s.terminalErr = exitErr
	}
	for id, ch := range s.pending {
		delete(s.pending, id)
		ch <- map[string]any{"error": map[string]any{"message": "process exited"}}
	}
	s.notifyFinishLocked(exitErr)
	var subs []func(map[string]any)
	if !alreadyClosed {
		subs = s.copySubscribersLocked()
	}
	s.mu.Unlock()
	if len(subs) > 0 {
		s.deliverEvents(subs, []map[string]any{{"type": "process_exit", "error": exitErr.Error()}})
	}
}

func (s *CodexSession) handleNotificationOrRequest(method string, rpcID any, msg map[string]any) {
	params, _ := msg["params"].(map[string]any)
	if strings.HasPrefix(method, "codex/event/") {
		if legacy, _ := params["msg"].(map[string]any); legacy != nil {
			for key, value := range legacy {
				if _, exists := params[key]; !exists {
					params[key] = value
				}
			}
		}
	}
	var extraEvents []map[string]any

	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	s.mu.Lock()
	if s.routeCodexSubagentLocked(method, params) {
		for _, descriptor := range s.subagents {
			extraEvents = append(extraEvents, map[string]any{"type": "subagent_upsert", "subagent": descriptor})
		}
		subs := s.copySubscribersLocked()
		s.mu.Unlock()
		s.deliverEvents(subs, extraEvents)
		return
	}
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
		if s.activeTurnID == "" {
			s.turnCounter++
			s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
		}
		extraEvents = append(extraEvents, map[string]any{"type": "turn_start"})

	case "turn/plan/updated":
		rawPlan, _ := params["plan"].([]any)
		items := make([]sdk.TaskItem, 0, len(rawPlan))
		for _, raw := range rawPlan {
			entry, _ := raw.(map[string]any)
			step, _ := entry["step"].(string)
			status, _ := entry["status"].(string)
			items = append(items, sdk.TaskItem{Text: step, Status: status})
		}
		index := s.appendItemLocked(sdk.TimelineItem{Type: "todo", Items: items})
		s.timeline[index].Seq = s.streamSeq
		s.timeline[index].SeqEnd = s.streamSeq
		s.streamSeq++
		extraEvents = append(extraEvents, map[string]any{"type": "timeline_appended", "item": s.timeline[index].Item})

	case "item/commandExecution/outputDelta", "item/fileChange/outputDelta", "codex/event/exec_command_output_delta", "codex/event/patch_apply_output_delta":
		extraEvents = append(extraEvents, s.appendCodexToolDeltaLocked(params, strings.HasPrefix(method, "codex/event/"))...)

	case "item/commandExecution/terminalInteraction", "codex/event/terminal_interaction":
		stdin, _ := params["stdin"].(string)
		itemID, _ := params["itemId"].(string)
		index := s.appendItemLocked(sdk.TimelineItem{Type: "tool_call", CallID: itemID, Name: "terminal", Status: "completed", Detail: map[string]any{"type": "plain_text", "text": stdin, "icon": "square_terminal", "processId": params["processId"]}})
		s.timeline[index].Seq = s.streamSeq
		s.timeline[index].SeqEnd = s.streamSeq
		s.streamSeq++
		extraEvents = append(extraEvents, map[string]any{"type": "timeline_appended", "item": s.timeline[index].Item})

	case "thread/compacted":
		extraEvents = append(extraEvents, s.nativeCompactionLocked("completed", "auto")...)

	case "error":
		willRetry, _ := params["willRetry"].(bool)
		errorObject, _ := params["error"].(map[string]any)
		message, _ := errorObject["message"].(string)
		if willRetry {
			index := s.appendItemLocked(sdk.TimelineItem{Type: "tool_call", Name: "codex_retry", Status: "running", Text: message})
			s.timeline[index].Seq = s.streamSeq
			s.timeline[index].SeqEnd = s.streamSeq
			s.streamSeq++
			extraEvents = append(extraEvents, map[string]any{"type": "timeline_appended", "item": s.timeline[index].Item})
		}

	case "warning":
		message, _ := params["message"].(string)
		index := s.appendItemLocked(sdk.TimelineItem{Type: "notification", Message: message, Level: "warning"})
		s.timeline[index].Seq = s.streamSeq
		s.timeline[index].SeqEnd = s.streamSeq
		s.streamSeq++
		extraEvents = append(extraEvents, map[string]any{"type": "timeline_appended", "item": s.timeline[index].Item})

	case "item/agentMessage/delta", "codex/event/agent_message_delta":
		delta, _ := params["delta"].(string)
		if delta != "" {
			if s.activeTextIdx < 0 || s.activeTextIdx >= len(s.timeline) {
				s.activeTextIdx = s.appendItemLocked(sdk.TimelineItem{
					Type: "assistant_message",
				})
			}
			s.timeline[s.activeTextIdx].Item.Text += delta
			if s.frames.AddText(s.activeTextIdx, sdk.TimelineItem{Type: "assistant_message", Text: delta}, s.activeTurnID) {
				extraEvents = append(extraEvents, s.flushFramesLocked()...)
			}
		}

	case "item/reasoning/summaryTextDelta", "codex/event/reasoning_delta":
		delta, _ := params["delta"].(string)
		if delta != "" {
			if s.activeThinkIdx < 0 || s.activeThinkIdx >= len(s.timeline) {
				s.activeThinkIdx = s.appendItemLocked(sdk.TimelineItem{
					Type: "reasoning",
				})
			}
			s.timeline[s.activeThinkIdx].Item.Text += delta
			if s.frames.AddText(s.activeThinkIdx, sdk.TimelineItem{Type: "reasoning", Text: delta}, s.activeTurnID) {
				extraEvents = append(extraEvents, s.flushFramesLocked()...)
			}
		}

	case "item/started":
		if item, ok := params["item"].(map[string]any); ok {
			extraEvents = append(extraEvents, s.startCodexItemLocked(item)...)
			if itemType, _ := item["type"].(string); itemType == "contextCompaction" {
				extraEvents = append(extraEvents, s.nativeCompactionLocked("loading", "auto")...)
			}
		}

	case "item/completed":
		if item, ok := params["item"].(map[string]any); ok {
			extraEvents = append(extraEvents, s.completeCodexItemLocked(item)...)
			if itemType, _ := item["type"].(string); itemType == "contextCompaction" {
				extraEvents = append(extraEvents, s.nativeCompactionLocked("completed", "auto")...)
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
			title, _ := question["question"].(string)
			if title == "" {
				title, _ = question["title"].(string)
			}
			questionID, _ := question["id"].(string)
			if questionID == "" {
				questionID = fmt.Sprintf("%d", index)
			}
			header, _ := question["header"].(string)
			if header == "" {
				header = fmt.Sprintf("Question %d", index+1)
			}
			options := make([]map[string]any, 0, 4)
			if rawOptions, ok := question["options"].([]any); ok {
				for _, rawOption := range rawOptions {
					switch option := rawOption.(type) {
					case string:
						options = append(options, map[string]any{"label": option})
					case map[string]any:
						options = append(options, option)
					}
				}
			}
			questions = append(questions, map[string]any{
				"id": questionID, "header": header, "question": title, "options": options,
				"multiSelect": question["multiSelect"] == true,
				"isOther":     question["isOther"] != false,
				"isSecret":    question["isSecret"] == true,
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

	case "mcpServer/elicitation/request":
		mode, _ := params["mode"].(string)
		schema, _ := params["requestedSchema"].(map[string]any)
		required, _ := schema["required"].([]any)
		if mode == "url" || len(required) > 0 {
			_ = s.sendJSON(map[string]any{"jsonrpc": "2.0", "id": rpcID, "result": map[string]any{
				"action": "decline", "content": nil, "_meta": nil,
			}})
			break
		}
		reqID := fmt.Sprintf("codex_elicitation_%v", rpcID)
		s.permissionRPCIDs[reqID] = rpcID
		s.pendingPermissions[reqID] = map[string]any{
			"id": reqID, "provider": "codex", "name": "mcp_elicitation", "kind": "tool",
			"title": "MCP server requests input", "input": params,
		}
		extraEvents = append(extraEvents, map[string]any{
			"type": "permission_requested", "request": s.pendingPermissions[reqID],
		})

	case "serverRequest/resolved":
		requestID := fmt.Sprint(params["requestId"])
		for _, id := range sortedCodexPermissionIDs(s.pendingPermissions) {
			if fmt.Sprint(s.permissionRPCIDs[id]) != requestID {
				continue
			}
			delete(s.permissionRPCIDs, id)
			delete(s.pendingPermissions, id)
			extraEvents = append(extraEvents, map[string]any{"type": "permission_resolved", "requestId": id})
		}

	case "thread/tokenUsage/updated", "codex/event/token_usage":
		// Ported from toAgentUsage. `last` is the most recent request's usage; the context
		// window is the model's, not the request's.
		if usage := codexAgentUsage(params); usage != nil {
			s.lastUsage = usage
		}

	case "turn/completed", "codex/event/task_complete":
		// Abort owns cancellation. Ignore the late native completion instead of
		// reporting the interrupted turn as a success.
		if s.activeTurnID == "" {
			break
		}
		if s.activeTextIdx >= 0 {
			extraEvents = append(extraEvents, map[string]any{"type": "message_end"})
		}
		if codexNativeTurnStatus(params) == "interrupted" {
			extraEvents = append(extraEvents, s.finishCancellationLocked("Interrupted")...)
			break
		}
		// A turn that failed is not one that finished: settling it as completed left the record idle
		// and the transcript silent while app-server held the only copy of the error.
		if failure := codexTurnFailure(params); failure != "" {
			finishedTurnID := s.activeTurnID
			s.lastError = failure
			s.status = "idle"
			s.activeTurnID = ""
			s.nativeTurnID = ""
			s.activeTextIdx = -1
			s.activeThinkIdx = -1
			s.notifyFinishLocked(errors.New(failure))
			extraEvents = append(extraEvents, map[string]any{
				"type":   "byspace_turn_failed",
				"turnId": finishedTurnID,
				"error":  failure,
			})
			break
		}
		extraEvents = append(extraEvents, s.emitCodexPlanApprovalLocked(s.latestPlanText)...)
		s.status = "idle"
		s.activeTurnID = ""
		s.nativeTurnID = ""
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		s.notifyFinishLocked(nil)
		extraEvents = append(extraEvents, map[string]any{"type": "agent_end"})
	}

	if method != "item/agentMessage/delta" && method != "codex/event/agent_message_delta" &&
		method != "item/reasoning/summaryTextDelta" && method != "codex/event/reasoning_delta" &&
		method != "item/started" && method != "item/completed" {
		extraEvents = append(s.flushFramesLocked(), extraEvents...)
	}
	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()

	s.deliverEvents(subs, extraEvents)
}

// AppendTimelineItem stores one item in the session's own timeline and returns the entry.
//
// It does not broadcast: the daemon emits the timeline event itself, so a provider cannot re-enter
// its own event loop. The entry deliberately carries no turn id — the daemon uses this for rows that
// belong to no turn, such as the system-error row a failed turn leaves behind.
func (s *CodexSession) AppendTimelineItem(item sdk.TimelineItem) sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.streamSeq++
	entry := sdk.TimelineEntry{
		Seq:       s.streamSeq,
		SeqEnd:    s.streamSeq,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      sdk.LimitTimelineItemContent(item),
	}
	s.timeline = append(s.timeline, entry)
	return entry
}

func (s *CodexSession) appendItemLocked(item sdk.TimelineItem) int {
	return s.appendItemWithSeqLocked(0, item)
}

func (s *CodexSession) appendItemWithSeqLocked(seq int, item sdk.TimelineItem) int {
	s.timeline = append(s.timeline, sdk.TimelineEntry{
		Seq:       seq,
		SeqEnd:    seq,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      sdk.LimitTimelineItemContent(item),
	})
	return len(s.timeline) - 1
}

// appendUserMessageLocked numbers and delivers a user row immediately, ahead of any later
// assistant frames. Streaming rows use appendItemLocked and receive their seq when flushed.
func (s *CodexSession) appendUserMessageLocked(item sdk.TimelineItem) {
	preEvents := s.flushFramesLocked()
	s.streamSeq++
	s.appendItemWithSeqLocked(s.streamSeq, item)
	subs := s.copySubscribersLocked()
	seq := s.streamSeq
	turnID := s.activeTurnID
	s.mu.Unlock()
	for _, fn := range subs {
		for _, event := range preEvents {
			fn(event)
		}
		fn(map[string]any{
			"type": "byspace_stream_timeline", "seq": seq,
			"turnId": turnID, "item": item,
		})
	}
	s.mu.Lock()
}

// flushTailOnExit delivers anything still merging before the process-exit lifecycle event.
func (s *CodexSession) flushTailOnExit() {
	// Not under emitMu: a subscriber may close the session while EOF is delivered. The process
	// has already stopped producing events, and the stopped timer cannot add another delivery.
	s.mu.Lock()
	events := s.flushFramesLocked()
	s.frames.Stop()
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	for _, fn := range subs {
		for _, event := range events {
			fn(event)
		}
	}
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
	return sdk.VisibleTimeline(s.timeline, s.frames.Pending())
}

func (s *CodexSession) SeedTimeline(entries []sdk.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]sdk.TimelineEntry, len(entries))
	copy(s.timeline, entries)
	for _, entry := range entries {
		if entry.SeqEnd > s.streamSeq {
			s.streamSeq = entry.SeqEnd
		}
	}
}

func (s *CodexSession) SetNextClientMessageID(id string) {
	s.mu.Lock()
	s.nextClientMessageID = id
	s.mu.Unlock()
}

// SetNextOutputSchema constrains the next turn's reply to schema, normalized the way Codex
// structured outputs require.
func (s *CodexSession) SetNextOutputSchema(schema any) error {
	normalized, err := normalizeCodexOutputSchema(schema)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.nextOutputSchema = normalized
	s.mu.Unlock()
	return nil
}

func (s *CodexSession) LastError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastError
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
	return s.streamSeq
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
	return s.prompt(ctx, message, images, true)
}

func (s *CodexSession) prompt(ctx context.Context, message string, images []sdk.ImageContent, allowSlash bool) error {
	if allowSlash {
		handled, err := s.tryHandleCodexSlash(ctx, message)
		if handled {
			return err
		}
	}
	s.dismissCodexPlanApprovals("The user answered with a message instead of approving. Their message follows.")
	s.mu.Lock()
	s.turnCounter++
	s.latestPlanText = ""
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.status = "running"
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	// The client's own id comes back on this row so it can reconcile the bubble it rendered
	// optimistically instead of leaving a duplicate, and can settle the pending submission.
	clientMsgID := takeClientMessageID(&s.nextClientMessageID)
	s.appendUserMessageLocked(userMessage(message, clientMsgID))
	s.pendingUserIndex = len(s.timeline) - 1
	s.pendingUserText = message
	s.pendingUserLocal = true
	tid := s.threadID
	outputSchema := s.nextOutputSchema
	s.nextOutputSchema = nil
	inputPrefix := s.nextInputPrefix
	s.nextInputPrefix = nil
	s.mu.Unlock()

	input := append([]map[string]any{}, inputPrefix...)
	input = append(input, map[string]any{"type": "text", "text": message})
	input = append(input, imageBlocksForCodex(images)...)
	s.ensureCollaborationModes(ctx)

	s.mu.Lock()
	state := codexTurnState{
		ThreadID:           tid,
		Cwd:                s.cwd,
		Model:              s.model,
		ModeID:             s.modeID,
		Thinking:           s.thinking,
		FeatureValues:      s.featureValues,
		ProviderOptions:    s.providerOptions,
		SystemPrompt:       s.systemPrompt,
		CollaborationModes: s.collaborationModes,
		OutputSchema:       outputSchema,
		Input:              input,
		Config:             s.innerConfig,
	}
	s.mu.Unlock()
	_, err := s.rpcCall(ctx, "turn/start", codexTurnParams(state))
	return err
}

// Steer delivers a message into the turn that is already running.
//
// Codex has a dedicated `turn/steer` for this. Falling back to Prompt starts a *new* turn while
// the current one is still going: the user's correction is not applied to the work in progress,
// and two turns write to the same thread.
func (s *CodexSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.dismissCodexPlanApprovals("The user answered with a message instead of approving. Their message follows.")
	s.mu.Lock()
	running := s.status == "running"
	threadID := s.threadID
	expectedTurnID := s.nativeTurnID
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	// Only consume the id once we know this is a steer: the fallback below goes through Prompt,
	// which takes the id itself.
	if !running || expectedTurnID == "" {
		s.mu.Unlock()
		// Nothing to steer: the caller's behavior was "steer", but there is no active turn, so
		// this is an ordinary prompt. Without this the RPC would be rejected and the message lost.
		return s.Prompt(ctx, message, images)
	}
	clientMsgID := takeClientMessageID(&s.nextClientMessageID)
	s.appendUserMessageLocked(userMessage(message, clientMsgID))
	s.mu.Unlock()

	input := []map[string]any{{"type": "text", "text": message}}
	input = append(input, imageBlocksForCodex(images)...)
	params := map[string]any{
		"threadId": threadID, "expectedTurnId": expectedTurnID, "input": input,
	}
	if clientMsgID != "" {
		params["clientUserMessageId"] = clientMsgID
	}
	result, err := s.rpcCall(ctx, "turn/steer", params)
	if err != nil {
		return err
	}
	acknowledged, _ := result["turnId"].(string)
	if turn, ok := result["turn"].(map[string]any); ok {
		if id, _ := turn["id"].(string); id != "" {
			acknowledged = id
		}
	}
	if acknowledged != expectedTurnID {
		return fmt.Errorf("Codex returned an invalid steer acknowledgement")
	}
	return nil
}

func (s *CodexSession) Abort(ctx context.Context) error {
	s.mu.Lock()
	tid := s.threadID
	turnID := s.nativeTurnID
	s.mu.Unlock()
	_, rpcErr := s.rpcCall(ctx, "turn/interrupt", map[string]any{"threadId": tid, "turnId": turnID})
	if rpcErr != nil {
		return rpcErr
	}

	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	s.mu.Lock()
	events := s.finishCancellationLocked("Interrupted")
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	for _, fn := range subs {
		for _, event := range events {
			fn(event)
		}
	}
	return rpcErr
}

func codexPermissionCancellationResult(pending map[string]any) (map[string]any, bool) {
	if kind, _ := pending["kind"].(string); kind == "plan" {
		return nil, false
	}
	if name, _ := pending["name"].(string); name == "mcp_elicitation" {
		return map[string]any{"action": "decline", "content": nil, "_meta": nil}, true
	}
	if kind, _ := pending["kind"].(string); kind == "question" {
		return map[string]any{"answers": map[string]any{}}, true
	}
	return map[string]any{"decision": "decline"}, true
}

func (s *CodexSession) finishCancellationLocked(reason string) []map[string]any {
	turnID := s.activeTurnID
	for requestID, nativeID := range s.permissionRPCIDs {
		if result, ok := codexPermissionCancellationResult(s.pendingPermissions[requestID]); ok {
			_ = s.sendJSON(map[string]any{"jsonrpc": "2.0", "id": nativeID, "result": result})
		}
	}
	s.permissionRPCIDs = make(map[string]any)
	s.pendingPermissions = make(map[string]map[string]any)
	for _, index := range failRunningToolCalls(s.timeline, reason) {
		s.frames.AddToolCall(index, s.timeline[index].Item, turnID, nil)
	}
	events := s.flushFramesLocked()
	s.status = "idle"
	s.activeTurnID = ""
	s.nativeTurnID = ""
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.notifyFinishLocked(nil)
	if turnID != "" {
		events = append(events, map[string]any{
			"type": "byspace_turn_canceled", "turnId": turnID, "reason": reason,
		})
	}
	return events
}

func (s *CodexSession) WaitForFinish(ctx context.Context) error {
	s.mu.Lock()
	if s.terminalErr != nil {
		err := s.terminalErr
		s.mu.Unlock()
		return err
	}
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
	s.modelProvider = provider
	s.mu.Unlock()
	return &sdk.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *CodexSession) SetMode(_ context.Context, modeID string) error {
	s.mu.Lock()
	s.modeID = modeID
	s.mu.Unlock()
	return nil
}

// loadCollaborationModes asks Codex which collaboration modes it offers.
//
// Plan mode and the daemon's system prompt travel inside one of them, so an empty list means
// neither is deliverable. Failure is not fatal: turns still run, Codex just keeps its own posture.
func (s *CodexSession) loadCollaborationModes(ctx context.Context) {
	s.mu.Lock()
	s.collabAttempts++
	s.mu.Unlock()
	res, err := s.rpcCall(ctx, "collaborationMode/list", map[string]any{})
	if err != nil {
		return
	}
	s.mu.Lock()
	s.collaborationModes = parseCodexCollaborationModes(res)
	s.mu.Unlock()
}

// ensureCollaborationModes retries the list while it is still empty, twice at most.
//
// The handshake fetch can lose to a slow Codex startup, and a session that never retried sent
// every turn without the system prompt. The cap matters as much: a build that never answers would
// otherwise pay a request — or the deadline — before every turn.
func (s *CodexSession) ensureCollaborationModes(ctx context.Context) {
	s.mu.Lock()
	loaded := len(s.collaborationModes) > 0
	attempts := s.collabAttempts
	s.mu.Unlock()
	if loaded || attempts >= 3 {
		return
	}
	listCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	s.loadCollaborationModes(listCtx)
}

// SetFeatureValues lets the app switch Fast or Plan on a running agent. Codex reads both per turn,
// so the change lands on the next one.
func (s *CodexSession) SetFeatureValues(values map[string]any) {
	s.mu.Lock()
	s.featureValues = values
	s.mu.Unlock()
}

func (s *CodexSession) SetThinkingLevel(_ context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

func (s *CodexSession) GetCommands(ctx context.Context) ([]sdk.SlashCommand, error) {
	s.mu.Lock()
	cwd := s.cwd
	s.mu.Unlock()
	home := codexHomeDir()
	commands := []sdk.SlashCommand{{Name: "compact", Description: "Compact thread context", Source: "builtin", Kind: "command"}}
	s.mu.Lock()
	goalsEnabled := s.goalsEnabled
	s.mu.Unlock()
	if goalsEnabled {
		commands = append(commands, sdk.SlashCommand{Name: "goal", Description: "Set, pause, resume, or clear the thread goal", ArgumentHint: "[objective|pause|resume|clear]", Source: "builtin", Kind: "command"})
	}
	commands = append(commands, listCodexCustomPrompts(home)...)
	skills, nativeErr := s.listNativeSkills(ctx, cwd)
	if nativeErr != nil {
		skills = listCodexSkills(cwd, home)
	}
	bySkill := make(map[string]codexSkill, len(skills))
	for _, skill := range skills {
		if _, exists := bySkill[skill.command.Name]; !exists {
			bySkill[skill.command.Name] = skill
			commands = append(commands, skill.command)
		}
	}
	s.mu.Lock()
	s.skills = bySkill
	s.mu.Unlock()
	byName := make(map[string]sdk.SlashCommand, len(commands))
	for _, command := range commands {
		if _, exists := byName[command.Name]; !exists {
			byName[command.Name] = command
		}
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]sdk.SlashCommand, 0, len(names))
	for _, name := range names {
		result = append(result, byName[name])
	}
	return result, nil
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
	pending := s.pendingPermissions[requestID]
	if pending["kind"] == "plan" {
		s.mu.Unlock()
		return s.resolveCodexPlanApproval(requestID, resp, pending)
	}
	rpcID, ok := s.permissionRPCIDs[requestID]
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
		answers := map[string]any{}
		if behavior, _ := resp["behavior"].(string); behavior != "deny" {
			answers = codexNativeQuestionAnswers(resp, pending)
		}
		return s.sendJSON(map[string]any{
			"jsonrpc": "2.0", "id": rpcID,
			"result": map[string]any{"answers": answers},
		})
	}
	if name, _ := pending["name"].(string); name == "mcp_elicitation" {
		action := "accept"
		var content any = map[string]any{}
		if behavior, _ := resp["behavior"].(string); behavior == "deny" {
			action, content = "decline", nil
			if resp["interrupt"] == true {
				action = "cancel"
			}
		}
		return s.sendJSON(map[string]any{"jsonrpc": "2.0", "id": rpcID, "result": map[string]any{
			"action": action, "content": content, "_meta": nil,
		}})
	}

	decision := "accept"
	if b, _ := resp["behavior"].(string); b == "deny" {
		decision = "decline"
		if resp["interrupt"] == true {
			decision = "cancel"
		}
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

func (s *CodexSession) ListSubagents(parentAgentID string) []sdk.SubagentDescriptor {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]sdk.SubagentDescriptor, 0, len(s.subagents))
	for _, descriptor := range s.subagents {
		if descriptor.ParentAgentID == "" {
			descriptor.ParentAgentID = parentAgentID
		}
		result = append(result, descriptor)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt < result[j].CreatedAt })
	return result
}

func (s *CodexSession) GetSubagent(parentAgentID, id string) (sdk.SubagentDescriptor, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	descriptor, ok := s.subagents[id]
	if ok && descriptor.ParentAgentID == "" {
		descriptor.ParentAgentID = parentAgentID
	}
	return descriptor, ok
}

func (s *CodexSession) SubagentTimeline(_, id string) ([]sdk.TimelineEntry, error) {
	s.mu.Lock()
	if _, ok := s.subagents[id]; !ok {
		s.mu.Unlock()
		return nil, fmt.Errorf("subagent not found: %s", id)
	}
	entries := append([]sdk.TimelineEntry(nil), s.subagentTimelines[id]...)
	hasUser := false
	for _, entry := range entries {
		hasUser = hasUser || entry.Item.Type == "user_message"
	}
	s.mu.Unlock()
	if hasUser {
		return entries, nil
	}

	// Codex 0.171 can omit the spawn item and the child's userMessage notification. The native
	// child thread still has both, so fill that gap without inventing a prompt from the parent.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := s.rpcCall(ctx, "thread/read", map[string]any{"threadId": id, "includeTurns": true})
	if err != nil {
		return entries, nil
	}
	child := &CodexSession{activeTextIdx: -1, activeThinkIdx: -1, toolIndexByID: map[string]int{}, subagents: map[string]sdk.SubagentDescriptor{}, subagentTimelines: map[string][]sdk.TimelineEntry{}, eventSubscribers: map[int]func(map[string]any){}}
	child.frames = sdk.NewStreamFrames(func() {})
	defer child.frames.Stop()
	thread, _ := response["thread"].(map[string]any)
	turns, _ := thread["turns"].([]any)
	for _, rawTurn := range turns {
		turn, _ := rawTurn.(map[string]any)
		items, _ := turn["items"].([]any)
		for _, raw := range items {
			if item, _ := raw.(map[string]any); item != nil {
				child.completeCodexHistoryItem(item)
			}
		}
	}
	native := child.Timeline()
	if len(native) > 0 {
		return native, nil
	}
	return entries, nil
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

func (s *CodexSession) copySubscribersLocked() []func(map[string]any) {
	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	return subs
}

func (s *CodexSession) sentItemLocked(index int) *sdk.TimelineItem {
	for _, frame := range s.frames.Pending() {
		if frame.Kind == "tool_call" && frame.Row == index {
			return frame.Visible
		}
	}
	entry := s.timeline[index]
	if entry.Seq == 0 {
		return nil
	}
	item := entry.Item
	return &item
}

// flushFramesLocked takes seqs only as frames go out. Merging after numbering
// would make clients refetch the timeline for every skipped seq.
func (s *CodexSession) flushFramesLocked() []map[string]any {
	frames := s.frames.Take()
	if len(frames) == 0 {
		return nil
	}
	events := make([]map[string]any, 0, len(frames))
	for _, frame := range frames {
		if frame.Row < 0 || frame.Row >= len(s.timeline) {
			continue
		}
		s.streamSeq++
		entry := &s.timeline[frame.Row]
		if entry.Seq == 0 {
			entry.Seq = s.streamSeq
		}
		entry.SeqEnd = s.streamSeq
		item := frame.Item
		turnID := frame.TurnID
		if frame.Kind == "tool_call" {
			item = entry.Item
			// A tool can resolve after its native turn has ended or while the next turn is
			// active. Keep the original turn identity so the client updates the existing row.
			turnID = entry.TurnID
		}
		events = append(events, map[string]any{
			"type": "byspace_stream_timeline", "seq": s.streamSeq,
			"turnId": turnID, "item": item,
		})
	}
	return events
}

func (s *CodexSession) flushFramesOnTimer() {
	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	s.mu.Lock()
	events := s.flushFramesLocked()
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	s.deliverEvents(subs, events)
}

func (s *CodexSession) deliverEvents(subs []func(map[string]any), events []map[string]any) {
	s.mu.Lock()
	s.delivering++
	s.mu.Unlock()
	for _, fn := range subs {
		for _, event := range events {
			fn(event)
		}
	}
	s.mu.Lock()
	s.delivering--
	closeRequested := s.closeRequested && s.delivering == 0
	s.mu.Unlock()
	if closeRequested {
		_ = s.Close()
	}
}

func (s *CodexSession) Close() error {
	// A subscriber may close the session from any event callback. Closing discards the tail instead
	// of calling that subscriber again, which would deadlock a once-guarded close.
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	if s.delivering > 0 {
		s.closeRequested = true
		s.mu.Unlock()
		return nil
	}
	s.closeRequested = false
	s.closed = true
	s.status = "closed"
	frames := s.finishCancellationLocked("Session closed")
	s.frames.Stop()
	subs := s.copySubscribersLocked()
	s.eventSubscribers = make(map[int]func(map[string]any))
	s.mu.Unlock()
	s.deliverEvents(subs, frames)
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

// codexInnerConfig assembles the `config` object Codex's thread/start and thread/resume accept:
// the user's provider options.
func codexInnerConfig(cfg LaunchConfig) map[string]any {
	inner := make(map[string]any, len(cfg.ProviderOptions))
	for key, value := range cfg.ProviderOptions {
		inner[key] = value
	}
	if len(cfg.MCPServers) > 0 {
		servers := make(map[string]any, len(cfg.MCPServers))
		for name, server := range cfg.MCPServers {
			switch server.Type {
			case "stdio":
				native := map[string]any{"command": server.Command}
				if server.Args != nil {
					native["args"] = server.Args
				}
				if server.Env != nil {
					native["env"] = server.Env
				}
				servers[name] = native
			case "http", "sse":
				native := map[string]any{"url": server.URL}
				if server.Headers != nil {
					native["http_headers"] = server.Headers
				}
				servers[name] = native
			}
		}
		inner["mcp_servers"] = servers
	}

	return inner
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

// Rewind forks immediately before the target turn. Codex 0.156 removed thread/rollback;
// older releases retain the non-destructive fork-then-rollback fallback.
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
		if (entry.Item.MessageID == trimmed || entry.Item.ClientMessageID == trimmed) && entry.Item.Type == "user_message" {
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

	s.mu.Lock()
	targetTurn := len(turns) - dropped
	targetTurnID := ""
	if targetTurn >= 0 && targetTurn < len(turns) {
		targetTurnID = turns[targetTurn]
	}
	forkParams := map[string]any{
		"threadId": threadID, "cwd": s.cwd, "model": s.model,
		"excludeTurns": true, "persistExtendedHistory": true,
	}
	if s.modelProvider != "" {
		forkParams["modelProvider"] = s.modelProvider
	}
	if len(s.innerConfig) > 0 {
		forkParams["config"] = s.innerConfig
	}
	if s.systemPrompt != "" {
		forkParams["developerInstructions"] = s.systemPrompt
	}
	s.mu.Unlock()
	if targetTurnID == "" {
		return errors.New("rewind could not resolve the target Codex turn")
	}
	currentParams := make(map[string]any, len(forkParams)+1)
	for key, value := range forkParams {
		currentParams[key] = value
	}
	currentParams["beforeTurnId"] = targetTurnID
	response, err := s.rpcCall(ctx, "thread/fork", currentParams)
	if err != nil {
		// Releases before beforeTurnId reject that field. Fork first there as well, so even the
		// legacy rollback never destroys the only copy of the original thread.
		message := strings.ToLower(err.Error())
		if !strings.Contains(message, "beforeturnid") || (!strings.Contains(message, "unknown") && !strings.Contains(message, "unexpected")) {
			return err
		}
		response, err = s.rpcCall(ctx, "thread/fork", forkParams)
		if err != nil {
			return err
		}
		forkedID := codexForkedThreadID(response)
		if forkedID == "" {
			return errors.New("codex fork response has no thread id")
		}
		response, err = s.rpcCall(ctx, "thread/rollback", map[string]any{"threadId": forkedID, "numTurns": dropped})
		if err != nil {
			return err
		}
	}
	forkedID := codexForkedThreadID(response)
	if forkedID == "" {
		return errors.New("codex rewind response has no thread id")
	}

	// The fork ends immediately before the target user row. Keep the matching canonical prefix;
	// the server publishes it as a timeline replacement after this call returns.
	s.mu.Lock()
	s.threadID = forkedID
	s.turnIDs = s.turnIDs[:len(s.turnIDs)-dropped]
	s.timeline = s.timeline[:targetIndex]
	s.streamSeq = 0
	for _, entry := range s.timeline {
		if entry.SeqEnd > s.streamSeq {
			s.streamSeq = entry.SeqEnd
		}
	}
	s.status = "idle"
	s.nativeTurnID = ""
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.toolIndexByID = make(map[string]int)
	for index, entry := range s.timeline {
		if entry.Item.CallID != "" {
			s.toolIndexByID[entry.Item.CallID] = index
		}
	}
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	s.mu.Unlock()
	return nil
}

func codexForkedThreadID(response map[string]any) string {
	thread, _ := response["thread"].(map[string]any)
	id, _ := thread["id"].(string)
	return id
}

// TreeEntryForMessage maps a message id to the provider's own reference.
//
// Codex addresses turns, resolved inside RewindConversation from the recorded turn list, so the identity mapping is
// correct here too.
func (s *CodexSession) TreeEntryForMessage(messageID string) (string, bool) {
	trimmed := strings.TrimSpace(messageID)
	return trimmed, trimmed != ""
}
