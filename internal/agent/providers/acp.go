package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// ACPSession hosts any Agent Client Protocol (ACP) JSON-RPC 2.0 agent
// (GitHub Copilot, Cursor, Kimi, Kiro, Trae, or custom ACP binaries).
type ACPSession struct {
	provider string
	cmd      *exec.Cmd
	stdin    io.WriteCloser

	writeMu sync.Mutex
	nextID  atomic.Int64

	mu                 sync.Mutex
	pending            map[int64]chan map[string]any
	status             string
	sessionID          string
	cwd                string
	model              string
	modeID             string
	thinking           string
	turnCounter        int
	activeTurnID       string
	activeTextIdx      int
	activeThinkIdx     int
	timeline           []pi.TimelineEntry
	toolIndexByID      map[string]int
	commands           []pi.SlashCommand
	pendingPermissions map[string]map[string]any
	permissionRPCIDs   map[string]any
	finishWaiters      []chan error
	eventSubscribers   map[int]func(map[string]any)
	nextSubID          int
	closed             bool
}

// StartACPSession spawns an ACP agent process and completes `initialize` + `session/new` (or `session/load`).
func StartACPSession(cfg LaunchConfig, spec ProviderSpec, cmdOverride string) (*ACPSession, error) {
	bin := strings.TrimSpace(cmdOverride)
	args := append([]string(nil), spec.DefaultArgs...)
	if bin != "" {
		// When overridden via env or test script, use the override command directly.
		args = spec.DefaultArgs
	} else {
		bin = spec.Binary
	}

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
		toolIndexByID:      make(map[string]int),
		pendingPermissions: make(map[string]map[string]any),
		permissionRPCIDs:   make(map[string]any),
		eventSubscribers:   make(map[int]func(map[string]any)),
	}
	go s.readLoop(stdout)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = s.rpcCall(ctx, "initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs": map[string]any{
				"readTextFile":  true,
				"writeTextFile": true,
			},
			"terminal": true,
		},
	})

	if cfg.SessionHandle != "" {
		s.sessionID = cfg.SessionHandle
		_, _ = s.rpcCall(ctx, "session/load", map[string]any{
			"sessionId":  cfg.SessionHandle,
			"cwd":        cfg.Cwd,
			"mcpServers": []any{},
		})
	} else {
		res, err := s.rpcCall(ctx, "session/new", map[string]any{
			"cwd":        cfg.Cwd,
			"mcpServers": []any{},
		})
		if err == nil {
			if sid, ok := res["sessionId"].(string); ok && sid != "" {
				s.sessionID = sid
			}
		}
	}
	if s.sessionID == "" {
		s.sessionID = "acp_sess_1"
	}

	return s, nil
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

	s.mu.Lock()
	s.closed = true
	s.status = "closed"
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

	switch method {
	case "fs/read_text_file":
		filePath, _ := params["path"].(string)
		b, err := os.ReadFile(filePath)
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
		if tc, ok := params["toolCall"].(map[string]any); ok {
			if t, ok := tc["title"].(string); ok && t != "" {
				title = t
			}
		}
		s.mu.Lock()
		s.permissionRPCIDs[reqID] = rpcID
		s.pendingPermissions[reqID] = map[string]any{
			"id":       reqID,
			"provider": s.provider,
			"name":     title,
			"kind":     "tool",
			"title":    title,
			"input":    params,
		}
		subs := s.copySubscribersLocked()
		s.mu.Unlock()
		for _, fn := range subs {
			fn(map[string]any{
				"type":    "extension_ui_request",
				"id":      reqID,
				"method":  "confirm",
				"title":   title,
				"message": title,
			})
		}
		return

	case "_kiro.dev/commands/available":
		s.mu.Lock()
		if cmds, ok := params["commands"].([]any); ok {
			for _, rawCmd := range cmds {
				if m, ok := rawCmd.(map[string]any); ok {
					name, _ := m["name"].(string)
					name = strings.TrimLeft(name, "/")
					desc, _ := m["description"].(string)
					if name != "" {
						s.commands = append(s.commands, pi.SlashCommand{
							Name:        name,
							Description: desc,
							Source:      "acp",
						})
					}
				}
			}
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
	case "agent_message_chunk":
		text := extractACPChunkText(upd)
		if text != "" {
			if s.activeTextIdx < 0 || s.activeTextIdx >= len(s.timeline) {
				s.activeTextIdx = s.appendItemLocked(pi.TimelineItem{
					Type: "assistant_message",
					Text: text,
				})
			} else {
				s.timeline[s.activeTextIdx].Item.Text += text
			}
		}

	case "agent_thought_chunk":
		text := extractACPChunkText(upd)
		if text != "" {
			if s.activeThinkIdx < 0 || s.activeThinkIdx >= len(s.timeline) {
				s.activeThinkIdx = s.appendItemLocked(pi.TimelineItem{
					Type: "reasoning",
					Text: text,
				})
			} else {
				s.timeline[s.activeThinkIdx].Item.Text += text
			}
		}

	case "tool_call":
		callID, _ := upd["toolCallId"].(string)
		title, _ := upd["title"].(string)
		kind, _ := upd["kind"].(string)
		if title == "" {
			title = kind
		}
		if title == "" {
			title = "tool"
		}
		idx := s.appendItemLocked(pi.TimelineItem{
			Type:   "tool_call",
			CallID: callID,
			Name:   title,
			Status: "running",
			Detail: pi.BuildToolCallDetail(strings.ToLower(title), upd["rawInput"], nil),
			Error:  nil,
		})
		if callID != "" {
			s.toolIndexByID[callID] = idx
		}
		extraEvents = append(extraEvents, map[string]any{
			"type":       "tool_execution_start",
			"toolCallId": callID,
			"toolName":   title,
		})

	case "tool_call_update":
		callID, _ := upd["toolCallId"].(string)
		status, _ := upd["status"].(string)
		normStatus := "completed"
		if status == "failed" || status == "error" {
			normStatus = "failed"
		} else if status == "in_progress" || status == "pending" {
			normStatus = "running"
		}
		if idx, ok := s.toolIndexByID[callID]; ok && idx >= 0 && idx < len(s.timeline) {
			s.timeline[idx].Item.Status = normStatus
			s.timeline[idx].Item.Detail = pi.BuildToolCallDetail(strings.ToLower(s.timeline[idx].Item.Name), upd["rawInput"], upd["rawOutput"])
		}
		extraEvents = append(extraEvents, map[string]any{
			"type":       "tool_execution_end",
			"toolCallId": callID,
		})

	case "available_commands_update":
		if cmds, ok := upd["availableCommands"].([]any); ok {
			s.commands = nil
			for _, rawCmd := range cmds {
				if m, ok := rawCmd.(map[string]any); ok {
					name, _ := m["name"].(string)
					desc, _ := m["description"].(string)
					if name != "" {
						s.commands = append(s.commands, pi.SlashCommand{
							Name:        strings.TrimLeft(name, "/"),
							Description: desc,
							Source:      "acp",
						})
					}
				}
			}
		}
	}

	subs := s.copySubscribersLocked()
	s.mu.Unlock()

	for _, fn := range subs {
		for _, ex := range extraEvents {
			fn(ex)
		}
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

func (s *ACPSession) appendItemLocked(item pi.TimelineItem) int {
	seq := len(s.timeline) + 1
	s.timeline = append(s.timeline, pi.TimelineEntry{
		Seq:       seq,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      item,
	})
	return len(s.timeline) - 1
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

func (s *ACPSession) Timeline() []pi.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]pi.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *ACPSession) SeedTimeline(entries []pi.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]pi.TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

func (s *ACPSession) SetNextClientMessageID(_ string) {}

func (s *ACPSession) LastError() string {
	return ""
}

func (s *ACPSession) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.timeline)
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

func (s *ACPSession) Prompt(ctx context.Context, message string, images []pi.ImageContent) error {
	s.mu.Lock()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	s.status = "running"
	s.activeTextIdx = -1
	s.activeThinkIdx = -1
	s.appendItemLocked(pi.TimelineItem{
		Type: "user_message",
		Text: message,
	})
	sid := s.sessionID
	subs := s.copySubscribersLocked()
	s.mu.Unlock()

	for _, fn := range subs {
		fn(map[string]any{"type": "turn_start"})
	}

	go func() {
		pctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		promptBlocks := []map[string]any{{"type": "text", "text": message}}
		promptBlocks = append(promptBlocks, imageBlocksForACP(images)...)
		_, err := s.rpcCall(pctx, "session/prompt", map[string]any{
			"sessionId": sid,
			"prompt":    promptBlocks,
		})
		s.mu.Lock()
		hadText := s.activeTextIdx >= 0
		s.status = "idle"
		s.activeTurnID = ""
		s.activeTextIdx = -1
		s.activeThinkIdx = -1
		s.notifyFinishLocked(err)
		endSubs := s.copySubscribersLocked()
		s.mu.Unlock()

		for _, fn := range endSubs {
			if hadText {
				fn(map[string]any{"type": "message_end"})
			}
			fn(map[string]any{"type": "agent_end"})
		}
	}()
	_ = ctx
	return nil
}

func (s *ACPSession) Steer(ctx context.Context, message string, images []pi.ImageContent) error {
	return s.Prompt(ctx, message, images)
}

func (s *ACPSession) Abort(ctx context.Context) error {
	s.mu.Lock()
	sid := s.sessionID
	s.mu.Unlock()
	_, _ = s.rpcCall(ctx, "session/cancel", map[string]any{"sessionId": sid})
	return nil
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

func (s *ACPSession) GetState(_ context.Context) (*pi.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &pi.SessionState{
		SessionID:     s.sessionID,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}, nil
}

func (s *ACPSession) SetModel(ctx context.Context, provider, modelID string) (*pi.Model, error) {
	s.mu.Lock()
	s.model = modelID
	sid := s.sessionID
	s.mu.Unlock()
	_, _ = s.rpcCall(ctx, "session/set_config_option", map[string]any{
		"sessionId": sid,
		"configId":  "model",
		"value":     modelID,
	})
	return &pi.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *ACPSession) SetThinkingLevel(ctx context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	sid := s.sessionID
	s.mu.Unlock()
	_, _ = s.rpcCall(ctx, "session/set_config_option", map[string]any{
		"sessionId": sid,
		"configId":  "thought_level",
		"value":     level,
	})
	return nil
}

func (s *ACPSession) GetCommands(_ context.Context) ([]pi.SlashCommand, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]pi.SlashCommand, len(s.commands))
	copy(out, s.commands)
	return out, nil
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
	delete(s.permissionRPCIDs, requestID)
	delete(s.pendingPermissions, requestID)
	s.mu.Unlock()
	if !ok {
		return nil
	}
	outcome := "selected"
	optionID := "allow"
	if b, _ := resp["behavior"].(string); b == "deny" {
		outcome = "cancelled"
		optionID = "deny"
	}
	return s.sendJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      rpcID,
		"result": map[string]any{
			"outcome": map[string]any{
				"outcome":  outcome,
				"optionId": optionID,
			},
		},
	})
}

func (s *ACPSession) ListSubagents(_ string) []pi.SubagentDescriptor {
	return []pi.SubagentDescriptor{}
}

func (s *ACPSession) GetSubagent(_, _ string) (pi.SubagentDescriptor, bool) {
	return pi.SubagentDescriptor{}, false
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

func (s *ACPSession) Close() error {
	_ = s.stdin.Close()
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return nil
}
