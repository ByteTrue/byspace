package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/ByteTrue/byspace/internal/execres"
	"github.com/ByteTrue/byspace/internal/proc"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// ACPSession hosts any Agent Client Protocol (ACP) JSON-RPC 2.0 agent
// (Copilot, Cursor, Kimi, Kiro, Trae, or any custom ACP binary a user connects).
type ACPSession struct {
	provider string
	cmd      *exec.Cmd
	stdin    io.WriteCloser

	writeMu sync.Mutex
	nextID  atomic.Int64

	// acpTerminals holds the commands the agent asked the client to run (reverse terminal).
	acpTerminals   map[string]*acpTerminal
	acpTerminalsMu sync.Mutex

	mu        sync.Mutex
	pending   map[int64]chan map[string]any
	status    string
	sessionID string
	// lastUsage is the token accounting from the most recent prompt, for the context ring.
	lastUsage *sdk.AgentUsage
	// lastError is the provider's own text for the most recent failure.
	lastError           string
	cwd                 string
	model               string
	modeID              string
	thinking            string
	turnCounter         int
	nextClientMessageID string
	activeTurnID        string
	activeTextIdx       int
	activeThinkIdx      int
	activeUserTextIdx   int
	activeUserMessageID string
	streamSeq           int
	frames              *sdk.StreamFrames
	emitMu              sync.Mutex
	timeline            []sdk.TimelineEntry
	toolIndexByID       map[string]int
	commands            []sdk.SlashCommand
	// commandsUpdatedAt is when the agent last published part of its command inventory, and
	// commandsSettled records that the first listing already waited for it. ACP agents publish in
	// batches, so a read right after startup returns one batch and none of the skills.
	commandsUpdatedAt  time.Time
	commandsSettled    bool
	pendingPermissions map[string]map[string]any
	permissionRPCIDs   map[string]any
	finishWaiters      []chan error
	promptCancel       context.CancelFunc
	eventSubscribers   map[int]func(map[string]any)
	nextSubID          int
	closed             bool
	delivering         int
	closeRequested     bool
	agentCapabilities  map[string]any
	configOptions      []any
	nativeModels       []sdk.Model
	nativeModes        []ModeDefinition
	waitDone           chan struct{}
	currentTitle       string
	lastActivityAt     string
}

// StartACPSession spawns an ACP agent process and completes `initialize` + `session/new` (or `session/load`).
func StartACPSession(cfg LaunchConfig, spec ProviderSpec, cmdOverride string) (*ACPSession, error) {
	bin := strings.TrimSpace(cmdOverride)
	args := append([]string(nil), spec.DefaultArgs...)
	if bin == "" {
		bin = spec.Binary
	}
	// OpenCode accepts the historical command string `opencode acp`; only its executable
	// participates in lookup. Other overrides keep their complete argument tail in cfg.
	if spec.ID == "opencode" && strings.HasSuffix(bin, " acp") {
		args = []string{"acp"}
		bin = strings.TrimSuffix(bin, " acp")
	}
	if resolved := execres.Find(context.Background(), bin); resolved != "" {
		bin = resolved
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

	s := &ACPSession{
		provider:           spec.ID,
		cmd:                cmd,
		stdin:              stdin,
		pending:            make(map[int64]chan map[string]any),
		status:             "idle",
		cwd:                cfg.Cwd,
		model:              cfg.Model,
		modeID:             cfg.ModeID,
		thinking:           cfg.ThinkingOptionID,
		activeTextIdx:      -1,
		activeThinkIdx:     -1,
		activeUserTextIdx:  -1,
		toolIndexByID:      make(map[string]int),
		pendingPermissions: make(map[string]map[string]any),
		permissionRPCIDs:   make(map[string]any),
		eventSubscribers:   make(map[int]func(map[string]any)),
		waitDone:           make(chan struct{}),
	}
	go func() {
		_ = cmd.Wait()
		close(s.waitDone)
	}()
	s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	go s.readLoop(stdout)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	failStart := func(err error) (*ACPSession, error) {
		_ = s.Close()
		return nil, err
	}
	initializeResult, err := s.rpcCall(ctx, "initialize", map[string]any{
		"protocolVersion":    1,
		"clientCapabilities": acpClientCapabilities(cfg.ProviderConfig),
	})
	if err != nil {
		return failStart(fmt.Errorf("acp initialize: %w", err))
	}
	s.agentCapabilities, _ = initializeResult["agentCapabilities"].(map[string]any)
	mcpServers, err := normalizeACPMCPServers(cfg.MCPServers)
	if err != nil {
		return failStart(err)
	}

	if cfg.SessionHandle != "" {
		method, err := acpResumeMethod(s.agentCapabilities)
		if err != nil {
			return failStart(err)
		}
		// Replay belongs to the existing native session, so its id must be set before updates arrive.
		s.sessionID = cfg.SessionHandle
		res, err := s.rpcCall(ctx, method, map[string]any{
			"sessionId":  cfg.SessionHandle,
			"cwd":        cfg.Cwd,
			"mcpServers": mcpServers,
		})
		if err != nil {
			return failStart(fmt.Errorf("acp %s: %w", method, err))
		}
		s.applyACPSessionCatalog(res)
	} else {
		res, err := s.rpcCall(ctx, "session/new", map[string]any{
			"cwd":        cfg.Cwd,
			"mcpServers": mcpServers,
		})
		if err != nil {
			return failStart(fmt.Errorf("acp session/new: %w", err))
		}
		sid, _ := res["sessionId"].(string)
		if sid == "" {
			return failStart(fmt.Errorf("acp session/new: response has no sessionId"))
		}
		s.sessionID = sid
		s.applyACPSessionCatalog(res)
	}

	// Native catalogs use their dedicated RPCs; config-only agents use set_config_option.
	if value := strings.TrimSpace(cfg.Model); value != "" && value != "default" {
		if _, err := s.SetModel(ctx, cfg.Provider, value); err != nil {
			return failStart(err)
		}
	}
	if value := strings.TrimSpace(cfg.ModeID); value != "" && value != "default" {
		if err := s.SetMode(ctx, value); err != nil {
			return failStart(err)
		}
	}
	if value := strings.TrimSpace(cfg.ThinkingOptionID); value != "" && value != "default" {
		if err := s.SetThinkingLevel(ctx, value); err != nil {
			return failStart(err)
		}
	}

	return s, nil
}

func (s *ACPSession) applyACPSessionCatalog(result map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if models, _ := result["models"].(map[string]any); models != nil {
		s.model, _ = models["currentModelId"].(string)
		s.nativeModels = nil
		available, _ := models["availableModels"].([]any)
		for _, raw := range available {
			entry, _ := raw.(map[string]any)
			id, _ := entry["modelId"].(string)
			name, _ := entry["name"].(string)
			if id != "" {
				s.nativeModels = append(s.nativeModels, sdk.Model{Provider: s.provider, ID: id, Name: name})
			}
		}
	}
	if modes, _ := result["modes"].(map[string]any); modes != nil {
		s.modeID, _ = modes["currentModeId"].(string)
		s.nativeModes = nil
		available, _ := modes["availableModes"].([]any)
		for _, raw := range available {
			entry, _ := raw.(map[string]any)
			id, _ := entry["id"].(string)
			name, _ := entry["name"].(string)
			description, _ := entry["description"].(string)
			if id != "" {
				s.nativeModes = append(s.nativeModes, ModeDefinition{ID: id, Label: name, Description: description})
			}
		}
	}
}

// acpClientCapabilities builds the `initialize` capability advertisement from the provider's
// `params.clientCapabilities`. Host filesystem access is opt-in: an agent that runs remotely or in
// a container must not be told the host can read its paths. Terminal support remains enabled.
func acpResumeMethod(capabilities map[string]any) (string, error) {
	if load, _ := capabilities["loadSession"].(bool); load {
		return "session/load", nil
	}
	sessionCapabilities, _ := capabilities["sessionCapabilities"].(map[string]any)
	if _, ok := sessionCapabilities["resume"]; ok {
		return "session/resume", nil
	}
	return "", fmt.Errorf("ACP agent does not support session resume")
}

func acpClientCapabilities(providerConfig map[string]any) map[string]any {
	caps := map[string]any{
		"fs": map[string]any{
			"readTextFile":  false,
			"writeTextFile": false,
		},
		"terminal": true,
	}
	params, _ := providerConfig["params"].(map[string]any)
	override, _ := params["clientCapabilities"].(map[string]any)
	if override == nil {
		return caps
	}
	if terminal, ok := override["terminal"].(bool); ok {
		caps["terminal"] = terminal
	}
	if fs, ok := override["fs"].(map[string]any); ok {
		fsCaps := caps["fs"].(map[string]any)
		if read, ok := fs["readTextFile"].(bool); ok {
			fsCaps["readTextFile"] = read
		}
		if write, ok := fs["writeTextFile"].(bool); ok {
			fsCaps["writeTextFile"] = write
		}
	}
	return caps
}

func (s *ACPSession) rpcCall(ctx context.Context, method string, params map[string]any) (map[string]any, error) {
	id := s.nextID.Add(1)
	ch := make(chan map[string]any, 1)

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, fmt.Errorf("acp process closed")
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
			return nil, fmt.Errorf("acp rpc error: %s", msg)
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

func (s *ACPSession) sendJSON(v any) error {
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

func (s *ACPSession) readLoop(stdout io.Reader) {
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

	// Kill every command the agent asked us to run. These are OUR children: when the ACP
	// process dies the requests stop coming, and a build or a test run left behind becomes an
	// orphan that keeps writing to stdout and holding a port.
	s.acpTerminalsMu.Lock()
	orphans := make([]*acpTerminal, 0, len(s.acpTerminals))
	for _, terminal := range s.acpTerminals {
		orphans = append(orphans, terminal)
	}
	s.acpTerminals = make(map[string]*acpTerminal)
	s.acpTerminalsMu.Unlock()
	for _, terminal := range orphans {
		if terminal.cmd != nil && terminal.cmd.Process != nil {
			_ = terminal.cmd.Process.Kill()
		}
	}

	s.flushTailOnExit()
	s.mu.Lock()
	s.closed = true
	s.status = "closed"
	if s.promptCancel != nil {
		s.promptCancel()
		s.promptCancel = nil
	}
	for id, ch := range s.pending {
		delete(s.pending, id)
		ch <- map[string]any{"error": map[string]any{"message": "process exited"}}
	}
	s.notifyFinishLocked(fmt.Errorf("acp process exited"))
	s.mu.Unlock()
}

func (s *ACPSession) handleNotificationOrRequest(method string, rpcID any, msg map[string]any) {
	params, _ := msg["params"].(map[string]any)
	var extraEvents []map[string]any

	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	// The reverse terminal family. Handled first so the main switch stays about session state.
	if s.handleACPReverseTerminal(rpcID, method, params) {
		return
	}

	switch method {
	case "fs/read_text_file":
		filePath, _ := params["path"].(string)
		b, err := os.ReadFile(filePath)
		if err == nil {
			// `line` and `limit` are how an agent reads a window of a large file. Ignoring them
			// returns the whole file: the agent believes it is looking at lines 100-120 while it
			// has the first line, and a large file crosses the pipe in full.
			if window := sliceLines(string(b), params); window != "" {
				b = []byte(window)
			}
		}
		if err != nil {
			_ = s.sendJSON(map[string]any{
				"jsonrpc": "2.0",
				"id":      rpcID,
				"error":   map[string]any{"code": -32000, "message": err.Error()},
			})
		} else {
			_ = s.sendJSON(map[string]any{
				"jsonrpc": "2.0",
				"id":      rpcID,
				"result":  map[string]any{"content": string(b)},
			})
		}
		return

	case "fs/write_text_file":
		filePath, _ := params["path"].(string)
		content, _ := params["content"].(string)
		// The parent directory may not exist yet — an agent writing a new module under a fresh
		// package directory otherwise fails on a missing directory rather than creating it.
		if dir := filepath.Dir(filePath); dir != "" && dir != "." {
			_ = os.MkdirAll(dir, 0o755)
		}
		if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
			_ = s.sendJSON(map[string]any{
				"jsonrpc": "2.0",
				"id":      rpcID,
				"error":   map[string]any{"code": -32000, "message": err.Error()},
			})
		} else {
			_ = s.sendJSON(map[string]any{
				"jsonrpc": "2.0",
				"id":      rpcID,
				"result":  map[string]any{},
			})
		}
		return

	case "session/request_permission":
		reqID := fmt.Sprintf("acp_perm_%v", rpcID)
		title := "Approve ACP tool?"
		toolKind := ""
		toolCall, _ := params["toolCall"].(map[string]any)
		if tc := toolCall; tc != nil {
			if t, ok := tc["title"].(string); ok && t != "" {
				title = t
			}
			toolKind, _ = tc["kind"].(string)
		}
		name := toolKind
		if name == "" {
			name = title
		}
		kind := "tool"
		if toolKind == "switch_mode" {
			kind = "mode"
		}
		nativeOptions, _ := params["options"].([]any)
		actions := make([]map[string]any, 0, len(nativeOptions))
		for _, raw := range nativeOptions {
			option, _ := raw.(map[string]any)
			optionID, _ := option["optionId"].(string)
			label, _ := option["name"].(string)
			optionKind, _ := option["kind"].(string)
			behavior := "deny"
			if strings.HasPrefix(optionKind, "allow") {
				behavior = "allow"
			}
			actions = append(actions, map[string]any{"id": optionID, "label": label, "behavior": behavior})
		}
		request := map[string]any{
			"id": reqID, "provider": s.provider, "name": name, "kind": kind, "title": title,
			"detail":   map[string]any{"type": "plain_text", "text": title},
			"actions":  actions,
			"metadata": map[string]any{"toolCallId": toolCall["toolCallId"], "rawRequest": params, "options": nativeOptions},
		}
		s.mu.Lock()
		s.permissionRPCIDs[reqID] = rpcID
		s.pendingPermissions[reqID] = request
		subs := s.copySubscribersLocked()
		s.mu.Unlock()
		for _, fn := range subs {
			fn(map[string]any{"type": "permission_requested", "request": request})
		}
		return

	case "_kiro.dev/commands/available":
		// Kiro announces its palette through this extension notification instead of the standard
		// available_commands_update: built-ins arrive under `commands` with a leading "/", skills and
		// prompts under `prompts`. Reading only `commands` left every Kiro skill out of the composer.
		s.mu.Lock()
		s.commandsUpdatedAt = time.Now()
		if mapped := mapKiroAvailableCommands(params["commands"], params["prompts"]); len(mapped) > 0 {
			s.commands = mapped
		} else {
			s.commandsSettled = true
		}
		s.mu.Unlock()
		return
	}

	if method != "session/update" {
		return
	}

	upd, _ := params["update"].(map[string]any)
	if upd == nil {
		upd = params
	}
	updType, _ := upd["sessionUpdate"].(string)

	s.mu.Lock()
	switch updType {
	case "user_message_chunk":
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		text := extractACPChunkText(upd)
		messageID, _ := upd["messageId"].(string)
		if text != "" {
			if s.activeUserTextIdx < 0 || s.activeUserTextIdx >= len(s.timeline) || (messageID != "" && s.activeUserMessageID != "" && messageID != s.activeUserMessageID) {
				s.activeUserTextIdx = s.appendItemLocked(sdk.TimelineItem{Type: "user_message", MessageID: messageID})
				s.activeUserMessageID = messageID
			}
			s.timeline[s.activeUserTextIdx].Item.Text += text
			if s.frames.AddText(s.activeUserTextIdx, sdk.TimelineItem{Type: "user_message", Text: text, MessageID: messageID}, s.activeTurnID) {
				extraEvents = append(extraEvents, s.flushFramesLocked()...)
			}
		}

	case "agent_message_chunk":
		s.activeUserTextIdx = -1
		s.activeUserMessageID = ""
		s.activeThinkIdx = -1
		text := extractACPChunkText(upd)
		if text != "" {
			if s.activeTextIdx < 0 || s.activeTextIdx >= len(s.timeline) {
				s.activeTextIdx = s.appendItemLocked(sdk.TimelineItem{
					Type: "assistant_message",
				})
			}
			s.timeline[s.activeTextIdx].Item.Text += text
			if s.frames.AddText(s.activeTextIdx, sdk.TimelineItem{Type: "assistant_message", Text: text}, s.activeTurnID) {
				extraEvents = append(extraEvents, s.flushFramesLocked()...)
			}
		}

	case "agent_thought_chunk":
		s.activeTextIdx = -1
		s.activeUserTextIdx = -1
		s.activeUserMessageID = ""
		text := extractACPChunkText(upd)
		if text != "" {
			if s.activeThinkIdx < 0 || s.activeThinkIdx >= len(s.timeline) {
				s.activeThinkIdx = s.appendItemLocked(sdk.TimelineItem{
					Type: "reasoning",
				})
			}
			s.timeline[s.activeThinkIdx].Item.Text += text
			if s.frames.AddText(s.activeThinkIdx, sdk.TimelineItem{Type: "reasoning", Text: text}, s.activeTurnID) {
				extraEvents = append(extraEvents, s.flushFramesLocked()...)
			}
		}

	case "tool_call", "tool_call_update":
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		s.activeUserTextIdx = -1
		s.activeUserMessageID = ""
		callID, _ := upd["toolCallId"].(string)
		idx, exists := s.toolIndexByID[callID]
		if !exists || idx < 0 || idx >= len(s.timeline) {
			idx = s.appendItemLocked(sdk.TimelineItem{Type: "tool_call", CallID: callID, Error: nil})
			s.toolIndexByID[callID] = idx
		}
		item := s.timeline[idx].Item
		previousStatus := item.Status
		mergeACPToolSnapshot(&item, upd)
		s.timeline[idx].Item = item
		visible := s.sentItemLocked(idx)
		if s.frames.AddToolCall(idx, item, s.activeTurnID, visible) {
			extraEvents = append(extraEvents, s.flushFramesLocked()...)
		}
		if updType == "tool_call" || !exists {
			extraEvents = append(extraEvents, map[string]any{"type": "tool_execution_start", "toolCallId": callID, "toolName": item.Name})
		}
		terminal := item.Status == "completed" || item.Status == "failed" || item.Status == "canceled"
		wasTerminal := previousStatus == "completed" || previousStatus == "failed" || previousStatus == "canceled"
		if terminal && !wasTerminal {
			extraEvents = append(extraEvents, map[string]any{"type": "tool_execution_end", "toolCallId": callID})
		}

	case "plan":
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		s.activeUserTextIdx = -1
		s.activeUserMessageID = ""
		idx := -1
		for index := len(s.timeline) - 1; index >= 0; index-- {
			if s.timeline[index].Item.Type == "todo" {
				idx = index
				break
			}
		}
		if idx < 0 {
			s.streamSeq++
			idx = s.appendItemWithSeqLocked(s.streamSeq, sdk.TimelineItem{Type: "todo"})
		}
		s.timeline[idx].Item.Items = acpPlanItems(upd["entries"])
		extraEvents = append(extraEvents, map[string]any{"type": "byspace_stream_timeline", "seq": s.timeline[idx].Seq, "turnId": s.timeline[idx].TurnID, "item": s.timeline[idx].Item})

	case "current_mode_update":
		if modeID, ok := upd["currentModeId"].(string); ok {
			s.modeID = modeID
		}
		extraEvents = append(extraEvents, map[string]any{"type": "mode_changed", "provider": s.provider, "currentModeId": s.modeID})

	case "config_option_update":
		s.configOptions, _ = upd["configOptions"].([]any)
		for _, raw := range s.configOptions {
			option, _ := raw.(map[string]any)
			category, _ := option["category"].(string)
			value, _ := option["currentValue"].(string)
			switch category {
			case "mode":
				s.modeID = value
				extraEvents = append(extraEvents, map[string]any{"type": "mode_changed", "provider": s.provider, "currentModeId": value})
			case "model":
				s.model = value
				extraEvents = append(extraEvents, map[string]any{"type": "model_changed", "provider": s.provider, "modelId": value})
			case "thought_level":
				s.thinking = value
				extraEvents = append(extraEvents, map[string]any{"type": "thinking_option_changed", "provider": s.provider, "thinkingOptionId": value})
			}
		}

	case "session_info_update":
		s.currentTitle, _ = upd["title"].(string)
		s.lastActivityAt, _ = upd["updatedAt"].(string)

	case "usage_update":
		maxTokens, maxOK := numericParam(upd, "size")
		usedTokens, usedOK := numericParam(upd, "used")
		if maxOK && usedOK && maxTokens > 0 && usedTokens >= 0 {
			usage := sdk.AgentUsage{ContextWindowMaxTokens: &maxTokens, ContextWindowUsedTokens: &usedTokens}
			if s.lastUsage != nil {
				copy := *s.lastUsage
				copy.ContextWindowMaxTokens = &maxTokens
				copy.ContextWindowUsedTokens = &usedTokens
				usage = copy
			}
			s.lastUsage = &usage
			extraEvents = append(extraEvents, map[string]any{"type": "usage_updated", "provider": s.provider, "usage": usage, "turnId": s.activeTurnID})
		}

	case "available_commands_update":
		s.commandsUpdatedAt = time.Now()
		if cmds, ok := upd["availableCommands"].([]any); ok {
			s.commands = nil
			for _, rawCmd := range cmds {
				if m, ok := rawCmd.(map[string]any); ok {
					name, _ := m["name"].(string)
					desc, _ := m["description"].(string)
					if name != "" {
						// The hint is what the composer shows beside the name; dropping it left every
						// ACP command looking argument-free.
						hint := ""
						if input, ok := m["input"].(map[string]any); ok {
							hint, _ = input["hint"].(string)
						}
						s.commands = append(s.commands, sdk.SlashCommand{
							Name:         strings.TrimLeft(name, "/"),
							Description:  desc,
							ArgumentHint: hint,
							Kind:         "command",
							Source:       "acp",
						})
					}
				}
			}
			// An agent that published an empty inventory has none to publish; waiting the quiet window
			// would only delay the answer.
			if len(s.commands) == 0 {
				s.commandsSettled = true
			}
		}
	}

	if updType != "user_message_chunk" && updType != "agent_message_chunk" && updType != "agent_thought_chunk" &&
		updType != "tool_call" && updType != "tool_call_update" {
		extraEvents = append(s.flushFramesLocked(), extraEvents...)
	}
	subs := s.copySubscribersLocked()
	s.mu.Unlock()

	s.deliverEvents(subs, extraEvents)
}

func acpPlanItems(raw any) []sdk.TaskItem {
	entries, _ := raw.([]any)
	items := make([]sdk.TaskItem, 0, len(entries))
	for _, entry := range entries {
		item, _ := entry.(map[string]any)
		text, _ := item["content"].(string)
		status, _ := item["status"].(string)
		items = append(items, sdk.TaskItem{Text: text, Status: status, Completed: status == "completed"})
	}
	return items
}

func acpToolStatus(raw string) string {
	switch raw {
	case "completed":
		return "completed"
	case "failed", "error":
		return "failed"
	case "cancelled", "canceled":
		return "canceled"
	default:
		return "running"
	}
}

func mergeACPToolSnapshot(item *sdk.TimelineItem, upd map[string]any) {
	if title, _ := upd["title"].(string); title != "" {
		item.Name = title
	} else if kind, _ := upd["kind"].(string); kind != "" && item.Name == "" {
		item.Name = kind
	}
	if item.Name == "" {
		item.Name = "tool"
	}
	if status, ok := upd["status"].(string); ok || item.Status == "" {
		item.Status = acpToolStatus(status)
	}
	metadata := map[string]any{}
	for key, value := range item.Metadata {
		metadata[key] = value
	}
	for _, key := range []string{"content", "locations", "kind", "rawInput", "rawOutput"} {
		if value, exists := upd[key]; exists && value != nil {
			metadata[key] = value
		}
	}
	if terminal, exists := upd["terminal"]; exists {
		metadata["terminal"] = terminal
	} else if terminalID, exists := upd["terminalId"]; exists {
		metadata["terminalId"] = terminalID
	}
	item.Metadata = metadata
	item.Detail = sdk.BuildToolCallDetail(strings.ToLower(item.Name), metadata["rawInput"], metadata["rawOutput"])
	if item.Status == "failed" {
		item.Error = metadata["rawOutput"]
	}
}

func extractACPChunkText(upd map[string]any) string {
	if c, ok := upd["content"].(map[string]any); ok {
		if t, ok := c["text"].(string); ok {
			return t
		}
	}
	if t, ok := upd["text"].(string); ok {
		return t
	}
	return ""
}

func (s *ACPSession) copySubscribersLocked() []func(map[string]any) {
	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	return subs
}

// AppendTimelineItem stores one item in the session's own timeline and returns the entry.
//
// It does not broadcast: the daemon emits the timeline event itself, so a provider cannot re-enter
// its own event loop. The entry deliberately carries no turn id — the daemon uses this for rows that
// belong to no turn, such as the system-error row a failed turn leaves behind.
func (s *ACPSession) AppendTimelineItem(item sdk.TimelineItem) sdk.TimelineEntry {
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

func (s *ACPSession) appendItemLocked(item sdk.TimelineItem) int {
	return s.appendItemWithSeqLocked(0, item)
}

func (s *ACPSession) appendItemWithSeqLocked(seq int, item sdk.TimelineItem) int {
	s.timeline = append(s.timeline, sdk.TimelineEntry{
		Seq:       seq,
		SeqEnd:    seq,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      sdk.LimitTimelineItemContent(item),
	})
	return len(s.timeline) - 1
}

func (s *ACPSession) appendUserMessageLocked(item sdk.TimelineItem) {
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

func (s *ACPSession) flushTailOnExit() {
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

func (s *ACPSession) notifyFinishLocked(err error) {
	waiters := s.finishWaiters
	s.finishWaiters = nil
	for _, ch := range waiters {
		ch <- err
		close(ch)
	}
}

func (s *ACPSession) Status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *ACPSession) Timeline() []sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return sdk.VisibleTimeline(s.timeline, s.frames.Pending())
}

func (s *ACPSession) SeedTimeline(entries []sdk.TimelineEntry) {
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

func (s *ACPSession) SetNextClientMessageID(id string) {
	s.mu.Lock()
	s.nextClientMessageID = id
	s.mu.Unlock()
}

func (s *ACPSession) LastError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastError
}

// TurnToken returns "" for providers without an explicit turn token; the daemon then relies
// on its own turn id comparison.
func (s *ACPSession) TurnToken() string { return "" }

// Usage reports token/cost accounting when the provider exposes it.
// Usage reports the token accounting the last prompt announced.
//
// ACP returns it on the session/prompt result, so it lands once per turn rather than streaming.
func (s *ACPSession) Usage(_ context.Context) *sdk.AgentUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastUsage == nil {
		return nil
	}
	usage := *s.lastUsage
	return &usage
}

func (s *ACPSession) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streamSeq
}

func (s *ACPSession) ActiveTurn() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != "running" {
		return "", ""
	}
	return s.activeTurnID, ""
}

func (s *ACPSession) LastAssistantText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.timeline) - 1; i >= 0; i-- {
		if s.timeline[i].Item.Type == "assistant_message" {
			return s.timeline[i].Item.Text
		}
	}
	return ""
}

func (s *ACPSession) Prompt(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	turnID := s.activeTurnID
	promptCtx, promptCancel := context.WithCancel(context.Background())
	s.promptCancel = promptCancel
	s.status = "running"
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.activeUserTextIdx = -1
	s.activeUserMessageID = ""
	// The client's own id comes back on this row so it can reconcile the bubble it rendered
	// optimistically instead of leaving a duplicate, and can settle the pending submission.
	clientMsgID := takeClientMessageID(&s.nextClientMessageID)
	s.appendUserMessageLocked(userMessage(message, clientMsgID))
	sid := s.sessionID
	subs := s.copySubscribersLocked()
	s.mu.Unlock()

	for _, fn := range subs {
		fn(map[string]any{"type": "turn_start"})
	}

	go func() {
		pctx, cancel := context.WithTimeout(promptCtx, 10*time.Minute)
		defer cancel()
		promptBlocks := []map[string]any{{"type": "text", "text": message}}
		promptBlocks = append(promptBlocks, imageBlocksForACP(images)...)
		res, err := s.rpcCall(pctx, "session/prompt", map[string]any{
			"sessionId": sid,
			"prompt":    promptBlocks,
		})
		if usage := acpUsageFromResult(res); usage != nil {
			s.mu.Lock()
			if s.activeTurnID == turnID {
				s.lastUsage = usage
			}
			s.mu.Unlock()
		}
		if stopReason, _ := res["stopReason"].(string); stopReason == "cancelled" {
			s.cancelPromptForID(turnID, "Cancelled by agent")
			return
		}
		s.finishPromptForID(turnID, err)
	}()
	_ = ctx
	return nil
}

func (s *ACPSession) finishPrompt(err error) {
	s.mu.Lock()
	turnID := s.activeTurnID
	s.mu.Unlock()
	s.finishPromptForID(turnID, err)
}

func (s *ACPSession) finishPromptForID(expectedTurnID string, err error) {
	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	s.mu.Lock()
	// Abort already emitted the terminal cancellation. A late native response
	// must not complete the same turn successfully.
	if s.activeTurnID == "" || s.activeTurnID != expectedTurnID {
		s.mu.Unlock()
		return
	}
	if s.promptCancel != nil {
		s.promptCancel()
		s.promptCancel = nil
	}
	s.cancelPendingPermissionsLocked()
	tail := s.flushFramesLocked()
	hadText := s.activeTextIdx >= 0
	finishedTurnID := s.activeTurnID
	if err != nil {
		s.lastError = err.Error()
	}
	s.status = "idle"
	s.activeTurnID = ""
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.activeUserTextIdx = -1
	s.activeUserMessageID = ""
	s.notifyFinishLocked(err)
	endSubs := s.copySubscribersLocked()
	s.mu.Unlock()

	for _, fn := range endSubs {
		for _, event := range tail {
			fn(event)
		}
		if hadText {
			fn(map[string]any{"type": "message_end"})
		}
		if err != nil {
			// A prompt the agent refused (auth, quota, a rejected request) is a failed turn. Reporting
			// agent_end made the daemon call it completed and write no [System Error] row.
			fn(map[string]any{
				"type":   "byspace_turn_failed",
				"turnId": finishedTurnID,
				"error":  err.Error(),
			})
			continue
		}
		fn(map[string]any{"type": "agent_end"})
	}
}

func (s *ACPSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	return s.Prompt(ctx, message, images)
}

func (s *ACPSession) Abort(ctx context.Context) error {
	s.mu.Lock()
	sid := s.sessionID
	s.mu.Unlock()
	_, rpcErr := s.rpcCall(ctx, "session/cancel", map[string]any{"sessionId": sid})
	s.cancelPrompt("Interrupted")
	return rpcErr
}

func (s *ACPSession) cancelPrompt(reason string) {
	s.mu.Lock()
	turnID := s.activeTurnID
	s.mu.Unlock()
	s.cancelPromptForID(turnID, reason)
}

func (s *ACPSession) cancelPromptForID(expectedTurnID string, reason string) {
	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	s.mu.Lock()
	if s.activeTurnID == "" || s.activeTurnID != expectedTurnID {
		s.mu.Unlock()
		return
	}
	events := s.finishCancellationLocked(reason)
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	for _, fn := range subs {
		for _, event := range events {
			fn(event)
		}
	}
}

func (s *ACPSession) cancelPendingPermissionsLocked() {
	for requestID, nativeID := range s.permissionRPCIDs {
		delete(s.pendingPermissions, requestID)
		_ = s.sendJSON(map[string]any{
			"jsonrpc": "2.0", "id": nativeID,
			"result": map[string]any{"outcome": map[string]any{"outcome": "cancelled"}},
		})
	}
	s.permissionRPCIDs = make(map[string]any)
	s.pendingPermissions = make(map[string]map[string]any)
}

// finishCancellationLocked clears every client-visible interaction before the
// turn's terminal event. Native permission requests are answered as cancelled.
func (s *ACPSession) finishCancellationLocked(reason string) []map[string]any {
	turnID := s.activeTurnID
	if s.promptCancel != nil {
		s.promptCancel()
		s.promptCancel = nil
	}
	s.cancelPendingPermissionsLocked()
	for _, index := range failRunningToolCalls(s.timeline, reason) {
		s.frames.AddToolCall(index, s.timeline[index].Item, turnID, nil)
	}
	events := s.flushFramesLocked()
	s.status = "idle"
	s.activeTurnID = ""
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.activeUserTextIdx = -1
	s.activeUserMessageID = ""
	s.notifyFinishLocked(nil)
	if turnID != "" {
		events = append(events, map[string]any{
			"type": "byspace_turn_canceled", "turnId": turnID, "reason": reason,
		})
	}
	return events
}

func (s *ACPSession) WaitForFinish(ctx context.Context) error {
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

func (s *ACPSession) Capabilities() sdk.AgentCapabilities {
	s.mu.Lock()
	defer s.mu.Unlock()
	modelConfig := false
	for _, raw := range s.configOptions {
		option, _ := raw.(map[string]any)
		if option["id"] == "model" {
			modelConfig = true
		}
	}
	return sdk.AgentCapabilities{
		SupportsStreaming: true, SupportsSessionPersistence: true, SupportsDynamicModes: len(s.nativeModes) > 0,
		SupportsMcpServers: true, SupportsReasoningStream: true, SupportsToolInvocations: true,
		CanCancel: true, CanSelectModel: len(s.nativeModels) > 0 || modelConfig, CanSelectThinking: true,
		SupportsImages: true, SupportsAttachments: true,
	}
}

func (s *ACPSession) GetState(_ context.Context) (*sdk.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := &sdk.SessionState{
		SessionID:     s.sessionID,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}
	if s.model != "" {
		state.Model = &sdk.Model{Provider: s.provider, ID: s.model, Name: s.model}
	}
	return state, nil
}

func (s *ACPSession) SetModel(ctx context.Context, provider, modelID string) (*sdk.Model, error) {
	s.mu.Lock()
	sid := s.sessionID
	native := len(s.nativeModels) > 0
	if native && !slices.ContainsFunc(s.nativeModels, func(model sdk.Model) bool { return model.ID == modelID }) {
		s.mu.Unlock()
		return nil, fmt.Errorf("ACP model %q is not available", modelID)
	}
	s.mu.Unlock()
	method := "session/set_config_option"
	params := map[string]any{"sessionId": sid, "configId": "model", "value": modelID}
	if native {
		method = "session/set_model"
		params = map[string]any{"sessionId": sid, "modelId": modelID}
	}
	if _, err := s.rpcCall(ctx, method, params); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.model = modelID
	s.mu.Unlock()
	return &sdk.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *ACPSession) SetMode(ctx context.Context, modeID string) error {
	s.mu.Lock()
	sid := s.sessionID
	native := len(s.nativeModes) > 0
	if native && !slices.ContainsFunc(s.nativeModes, func(mode ModeDefinition) bool { return mode.ID == modeID }) {
		s.mu.Unlock()
		return fmt.Errorf("ACP mode %q is not available", modeID)
	}
	s.mu.Unlock()
	method := "session/set_config_option"
	params := map[string]any{"sessionId": sid, "configId": "mode", "value": modeID}
	if native {
		method = "session/set_mode"
		params = map[string]any{"sessionId": sid, "modeId": modeID}
	}
	if _, err := s.rpcCall(ctx, method, params); err != nil {
		return err
	}
	s.mu.Lock()
	s.modeID = modeID
	s.mu.Unlock()
	return nil
}

func (s *ACPSession) SetThinkingLevel(ctx context.Context, level string) error {
	s.mu.Lock()
	sid := s.sessionID
	s.mu.Unlock()
	if _, err := s.rpcCall(ctx, "session/set_config_option", map[string]any{
		"sessionId": sid,
		"configId":  "thought_level",
		"value":     level,
	}); err != nil {
		return err
	}
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

// GetCommands returns the commands the agent announced.
//
// The first read waits for the inventory to go quiet: MiniMax sends its built-ins twice and a third
// batch with every discovered skill about 350ms later, so answering after the first batch listed the
// built-ins and none of the skills.
func (s *ACPSession) GetCommands(ctx context.Context) ([]sdk.SlashCommand, error) {
	s.settleCommands(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.SlashCommand, len(s.commands))
	copy(out, s.commands)
	return out, nil
}

const (
	// The quiet window has to exceed the gap between an agent's own batches.
	acpCommandQuietWindow = 600 * time.Millisecond
	// ...and the whole wait is bounded for agents that publish once or never.
	acpCommandWaitTimeout = 1500 * time.Millisecond
	acpCommandPollWindow  = 25 * time.Millisecond
)

// acpSlowCommandProviders publish their inventory seconds after session/new, so the generic budget
// would answer with an empty palette. Ported from the node daemon's per-provider
// initialCommandsWaitTimeoutMs (cursor/kiro/trae = 10s).
var acpSlowCommandProviders = map[string]time.Duration{
	"cursor": 10 * time.Second,
	"kiro":   10 * time.Second,
	"trae":   10 * time.Second,
}

func (s *ACPSession) commandWaitTimeout() time.Duration {
	if timeout, ok := acpSlowCommandProviders[s.provider]; ok {
		return timeout
	}
	return acpCommandWaitTimeout
}

// mapKiroAvailableCommands merges the two lists Kiro reports. Built-ins carry a leading "/" and
// skills/prompts carry a "skill:" server name; names are stored without the slash because the
// composer prepends it on insertion.
func mapKiroAvailableCommands(lists ...any) []sdk.SlashCommand {
	var out []sdk.SlashCommand
	seen := map[string]bool{}
	for _, list := range lists {
		entries, _ := list.([]any)
		for _, rawEntry := range entries {
			entry, ok := rawEntry.(map[string]any)
			if !ok {
				continue
			}
			name, _ := entry["name"].(string)
			name = strings.TrimLeft(strings.TrimSpace(name), "/")
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			description, _ := entry["description"].(string)
			hint := ""
			if meta, ok := entry["meta"].(map[string]any); ok {
				hint, _ = meta["hint"].(string)
			}
			kind := "command"
			if serverName, _ := entry["serverName"].(string); strings.HasPrefix(serverName, "skill:") {
				kind = "skill"
			}
			out = append(out, sdk.SlashCommand{
				Name:         name,
				Description:  description,
				ArgumentHint: hint,
				Kind:         kind,
				Source:       "acp",
			})
		}
	}
	return out
}

func (s *ACPSession) settleCommands(ctx context.Context) {
	s.mu.Lock()
	settled := s.commandsSettled
	s.mu.Unlock()
	if settled {
		return
	}
	deadline := time.Now().Add(s.commandWaitTimeout())
	for {
		s.mu.Lock()
		if s.commandsSettled || s.closed {
			s.mu.Unlock()
			return
		}
		lastUpdate := s.commandsUpdatedAt
		s.mu.Unlock()

		remaining := time.Until(deadline)
		if remaining <= 0 {
			// An agent that has not published by now may publish later, but every read must not pay the
			// timeout again: the wait is a one-shot startup cost.
			s.markCommandsSettled()
			return
		}
		if !lastUpdate.IsZero() && time.Since(lastUpdate) >= acpCommandQuietWindow {
			break
		}
		wait := acpCommandPollWindow
		if remaining < wait {
			wait = remaining
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
	s.markCommandsSettled()
}

func (s *ACPSession) markCommandsSettled() {
	s.mu.Lock()
	s.commandsSettled = true
	s.mu.Unlock()
}

func (s *ACPSession) PendingPermissions() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]map[string]any, 0, len(s.pendingPermissions))
	for _, p := range s.pendingPermissions {
		out = append(out, p)
	}
	return out
}

func (s *ACPSession) RespondToPermission(requestID string, resp map[string]any) error {
	s.mu.Lock()
	rpcID, ok := s.permissionRPCIDs[requestID]
	request := s.pendingPermissions[requestID]
	s.mu.Unlock()
	if !ok || request == nil {
		return fmt.Errorf("unknown ACP permission request %q", requestID)
	}
	metadata, _ := request["metadata"].(map[string]any)
	rawOptions, _ := metadata["options"].([]any)
	behavior, _ := resp["behavior"].(string)
	selectedID, _ := resp["selectedActionId"].(string)
	var selected map[string]any
	if selectedID != "" {
		for _, raw := range rawOptions {
			option, _ := raw.(map[string]any)
			if id, _ := option["optionId"].(string); id == selectedID {
				selected = option
				break
			}
		}
		if selected == nil {
			return fmt.Errorf("unknown ACP permission option %q", selectedID)
		}
		kind, _ := selected["kind"].(string)
		if (behavior == "allow") != strings.HasPrefix(kind, "allow") {
			return fmt.Errorf("ACP permission option %q does not match behavior %q", selectedID, behavior)
		}
	} else {
		kinds := []string{"allow_once", "allow_always"}
		if behavior == "deny" {
			kinds = []string{"reject_once", "reject_always"}
		}
		for _, wanted := range kinds {
			for _, raw := range rawOptions {
				option, _ := raw.(map[string]any)
				if kind, _ := option["kind"].(string); kind == wanted {
					selected = option
					break
				}
			}
			if selected != nil {
				break
			}
		}
	}
	outcome := map[string]any{"outcome": "cancelled"}
	if selected != nil {
		outcome = map[string]any{"outcome": "selected", "optionId": selected["optionId"]}
	}
	s.mu.Lock()
	delete(s.permissionRPCIDs, requestID)
	delete(s.pendingPermissions, requestID)
	s.mu.Unlock()
	if behavior == "deny" {
		if interrupt, _ := resp["interrupt"].(bool); interrupt {
			_ = s.sendJSON(map[string]any{"jsonrpc": "2.0", "method": "session/cancel", "params": map[string]any{"sessionId": s.sessionID}})
		}
	}
	return s.sendJSON(map[string]any{
		"jsonrpc": "2.0", "id": rpcID,
		"result": map[string]any{"outcome": outcome},
	})
}

func (s *ACPSession) ListSubagents(_ string) []sdk.SubagentDescriptor {
	return []sdk.SubagentDescriptor{}
}

func (s *ACPSession) GetSubagent(_, _ string) (sdk.SubagentDescriptor, bool) {
	return sdk.SubagentDescriptor{}, false
}

func (s *ACPSession) OnEvent(fn func(map[string]any)) func() {
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

func (s *ACPSession) sentItemLocked(index int) *sdk.TimelineItem {
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

// flushFramesLocked keeps timeline sequence assignment after coalescing, as Pi does.
func (s *ACPSession) flushFramesLocked() []map[string]any {
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
		if frame.Kind == "tool_call" {
			item = entry.Item
		}
		events = append(events, map[string]any{
			"type": "byspace_stream_timeline", "seq": s.streamSeq,
			"turnId": frame.TurnID, "item": item,
		})
	}
	return events
}

func (s *ACPSession) flushFramesOnTimer() {
	s.emitMu.Lock()
	defer s.emitMu.Unlock()
	s.mu.Lock()
	events := s.flushFramesLocked()
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	s.deliverEvents(subs, events)
}

func (s *ACPSession) deliverEvents(subs []func(map[string]any), events []map[string]any) {
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

func (s *ACPSession) Close() error {
	// A subscriber may close the session from any event callback. Closing discards the tail instead
	// of calling that subscriber again, which would deadlock a once-guarded close.
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		s.closeACPProcess()
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
	s.closeACPProcess()
	return nil
}

func (s *ACPSession) closeACPProcess() {
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		if s.waitDone != nil {
			select {
			case <-s.waitDone:
				return
			case <-time.After(2 * time.Second):
			}
		}
		_ = s.cmd.Process.Kill()
		if s.waitDone != nil {
			<-s.waitDone
		}
	}
}

// sliceLines returns the requested window of `content`, or "" when no window was asked for.
//
// Ported from readTextFile. ACP line numbers are 1-based and `limit` counts lines, so an agent
// asking for line 1 with limit 20 wants lines 1..20.
func sliceLines(content string, params map[string]any) string {
	line, hasLine := numericParam(params, "line")
	limit, hasLimit := numericParam(params, "limit")
	if !hasLine && !hasLimit {
		return ""
	}
	lines := strings.Split(content, "\n")
	start := 0
	if hasLine && line > 1 {
		start = line - 1
	}
	if start > len(lines) {
		return ""
	}
	end := len(lines)
	if hasLimit && limit > 0 && start+limit < end {
		end = start + limit
	}
	return strings.Join(lines[start:end], "\n")
}

// numericParam reads a JSON number from params.
func numericParam(params map[string]any, key string) (int, bool) {
	switch value := params[key].(type) {
	case float64:
		return int(value), true
	case int:
		return value, true
	case int64:
		return int(value), true
	default:
		return 0, false
	}
}

// acpUsageFromResult reads the usage a session/prompt result carries.
//
// ACP spells the cache bucket `cachedReadTokens`; everything else lines up with the daemon's
// AgentUsage. A provider that reports nothing yields nil, and the agent shows no usage.
func acpUsageFromResult(res map[string]any) *sdk.AgentUsage {
	usage, _ := res["usage"].(map[string]any)
	if usage == nil {
		return nil
	}
	entry := &sdk.AgentUsage{
		InputTokens:       intField(usage, "inputTokens"),
		OutputTokens:      intField(usage, "outputTokens"),
		CachedInputTokens: intField(usage, "cachedReadTokens"),
	}
	if entry.InputTokens == 0 && entry.OutputTokens == 0 && entry.CachedInputTokens == 0 {
		return nil
	}
	return entry
}
