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

// CodexSession hosts a `codex app-server` JSON-RPC 2.0 subprocess.
type CodexSession struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser

	writeMu sync.Mutex
	nextID  atomic.Int64

	mu                 sync.Mutex
	pending            map[int64]chan map[string]any
	status             string
	threadID           string
	cwd                string
	model              string
	thinking           string
	turnCounter        int
	activeTurnID       string
	activeTextIdx      int
	activeThinkIdx     int
	timeline           []pi.TimelineEntry
	toolIndexByID      map[string]int
	pendingPermissions map[string]map[string]any
	permissionRPCIDs   map[string]any
	subagents          map[string]pi.SubagentDescriptor
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
		subagents:          make(map[string]pi.SubagentDescriptor),
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
		res, err := s.rpcCall(ctx, "thread/start", map[string]any{
			"cwd":   cfg.Cwd,
			"model": cfg.Model,
		})
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
		extraEvents = append(extraEvents, map[string]any{"type": "turn_start"})

	case "item/agentMessage/delta", "codex/event/agent_message_delta":
		delta, _ := params["delta"].(string)
		if delta != "" {
			if s.activeTextIdx < 0 || s.activeTextIdx >= len(s.timeline) {
				s.activeTextIdx = s.appendItemLocked(pi.TimelineItem{
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
				s.activeThinkIdx = s.appendItemLocked(pi.TimelineItem{
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
				idx := s.appendItemLocked(pi.TimelineItem{
					Type:   "tool_call",
					CallID: itemID,
					Name:   "bash",
					Status: "running",
					Detail: pi.BuildToolCallDetail("bash", map[string]any{"command": cmdStr}, nil),
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
					s.activeTextIdx = s.appendItemLocked(pi.TimelineItem{
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
					s.timeline[idx].Item.Detail = pi.BuildToolCallDetail("bash", map[string]any{"command": cmdStr}, outStr)
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

	case "turn/completed", "codex/event/task_complete":
		if s.activeTextIdx >= 0 {
			extraEvents = append(extraEvents, map[string]any{"type": "message_end"})
		}
		s.status = "idle"
		s.activeTurnID = ""
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

func (s *CodexSession) appendItemLocked(item pi.TimelineItem) int {
	seq := len(s.timeline) + 1
	s.timeline = append(s.timeline, pi.TimelineEntry{
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

func (s *CodexSession) Timeline() []pi.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]pi.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *CodexSession) SeedTimeline(entries []pi.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]pi.TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

func (s *CodexSession) SetNextClientMessageID(_ string) {}

func (s *CodexSession) LastError() string {
	return ""
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

func (s *CodexSession) Prompt(ctx context.Context, message string, images []pi.ImageContent) error {
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

func (s *CodexSession) Steer(ctx context.Context, message string, images []pi.ImageContent) error {
	return s.Prompt(ctx, message, images)
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

func (s *CodexSession) GetState(_ context.Context) (*pi.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &pi.SessionState{
		SessionID:     s.threadID,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}, nil
}

func (s *CodexSession) SetModel(_ context.Context, provider, modelID string) (*pi.Model, error) {
	s.mu.Lock()
	s.model = modelID
	s.mu.Unlock()
	return &pi.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *CodexSession) SetThinkingLevel(_ context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

func (s *CodexSession) GetCommands(_ context.Context) ([]pi.SlashCommand, error) {
	return []pi.SlashCommand{
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
	delete(s.permissionRPCIDs, requestID)
	delete(s.pendingPermissions, requestID)
	s.mu.Unlock()
	if !ok {
		return nil
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

func (s *CodexSession) ListSubagents(_ string) []pi.SubagentDescriptor {
	return []pi.SubagentDescriptor{}
}

func (s *CodexSession) GetSubagent(_, _ string) (pi.SubagentDescriptor, bool) {
	return pi.SubagentDescriptor{}, false
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
