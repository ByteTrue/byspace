package pi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"byspace/internal/agent"
)

const (
	defaultStartTimeout = 10 * time.Second
	defaultAbortTimeout = 5 * time.Second
	poisonCloseTimeout  = 4 * time.Second
)

type Options struct {
	Command      []string
	SessionDir   string
	ExtraArgs    []string
	Env          map[string]string
	AbortTimeout time.Duration
}

type Factory struct {
	options Options
}

func New(options Options) *Factory {
	options.Command = append([]string(nil), options.Command...)
	options.ExtraArgs = append([]string(nil), options.ExtraArgs...)
	if len(options.Command) == 0 {
		options.Command = []string{"pi"}
	}
	if options.AbortTimeout <= 0 {
		options.AbortTimeout = defaultAbortTimeout
	}
	if options.Env != nil {
		copied := make(map[string]string, len(options.Env))
		for key, value := range options.Env {
			copied[key] = value
		}
		options.Env = copied
	}
	return &Factory{options: options}
}

func (factory *Factory) Start(ctx context.Context, config agent.Config) (agent.Session, error) {
	if config.Provider != "pi" {
		return nil, fmt.Errorf("Pi factory cannot start provider %q", config.Provider)
	}
	if factory.options.SessionDir == "" {
		return nil, errors.New("Pi session directory must not be empty")
	}
	if err := os.MkdirAll(factory.options.SessionDir, 0o700); err != nil {
		return nil, fmt.Errorf("create Pi session directory: %w", err)
	}
	if err := os.Chmod(factory.options.SessionDir, 0o700); err != nil {
		return nil, fmt.Errorf("secure Pi session directory: %w", err)
	}
	resumePath, err := validateResumeHandle(factory.options.SessionDir, config.Resume)
	if err != nil {
		return nil, err
	}

	args := append([]string(nil), factory.options.Command[1:]...)
	args = append(args, "--mode", "rpc", "--no-approve")
	if config.Model != "" {
		args = append(args, "--model", config.Model)
	}
	if config.ThinkingOptionID != "" {
		args = append(args, "--thinking", config.ThinkingOptionID)
	}
	args = append(args, "--session-dir", factory.options.SessionDir)
	if resumePath != "" {
		args = append(args, "--session", resumePath)
	}
	args = append(args, factory.options.ExtraArgs...)

	command := exec.Command(factory.options.Command[0], args...)
	command.Dir = config.CWD
	command.Env = mergeEnvironment(os.Environ(), factory.options.Env)
	process, err := startRPCProcess(command)
	if err != nil {
		return nil, err
	}
	session := &piSession{
		process:      process,
		events:       make(chan agent.ProviderEvent, 256),
		pumpDone:     make(chan struct{}),
		abortTimeout: factory.options.AbortTimeout,
	}
	go session.pumpEvents()

	startCtx, cancel := context.WithTimeout(ctx, defaultStartTimeout)
	defer cancel()
	state, err := session.getState(startCtx)
	if err == nil && config.Resume != nil {
		err = validateResumedState(*config.Resume, state)
	}
	if err != nil {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer closeCancel()
		_ = session.Close(closeCtx)
		return nil, fmt.Errorf("initialize Pi RPC session: %w", err)
	}
	session.mu.Lock()
	session.info = agent.RuntimeInfo{
		Provider:         "pi",
		SessionID:        state.SessionID,
		NativeHandle:     state.SessionFile,
		Model:            state.Model.ID,
		ThinkingOptionID: state.ThinkingLevel,
	}
	session.mu.Unlock()
	return session, nil
}

func validateResumeHandle(sessionDirectory string, handle *agent.PersistenceHandle) (string, error) {
	if handle == nil {
		return "", nil
	}
	if handle.Provider != "pi" {
		return "", fmt.Errorf("Pi resume handle has provider %q", handle.Provider)
	}
	if strings.TrimSpace(handle.SessionID) == "" {
		return "", errors.New("Pi resume handle has no session ID")
	}
	if strings.TrimSpace(handle.NativeHandle) == "" {
		return "", errors.New("Pi resume handle has no native session file")
	}
	base, err := filepath.Abs(sessionDirectory)
	if err != nil {
		return "", fmt.Errorf("resolve Pi session directory: %w", err)
	}
	target, err := filepath.Abs(handle.NativeHandle)
	if err != nil {
		return "", fmt.Errorf("resolve Pi resume session: %w", err)
	}
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		return "", fmt.Errorf("resolve Pi session directory links: %w", err)
	}
	realTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		return "", fmt.Errorf("resolve Pi resume session links: %w", err)
	}
	relative, err := filepath.Rel(realBase, realTarget)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", fmt.Errorf("Pi resume session %s is outside %s", target, base)
	}
	info, err := os.Stat(realTarget)
	if err != nil {
		return "", fmt.Errorf("inspect Pi resume session: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("Pi resume session %s is not a regular file", target)
	}
	return filepath.Clean(target), nil
}

func validateResumedState(expected agent.PersistenceHandle, actual rpcState) error {
	if expected.SessionID != "" && actual.SessionID != expected.SessionID {
		return fmt.Errorf("Pi resumed session ID is %q, want %q", actual.SessionID, expected.SessionID)
	}
	if filepath.Clean(actual.SessionFile) != filepath.Clean(expected.NativeHandle) {
		return fmt.Errorf("Pi resumed session file is %q, want %q", actual.SessionFile, expected.NativeHandle)
	}
	return nil
}

type piSession struct {
	process  *rpcProcess
	events   chan agent.ProviderEvent
	pumpDone chan struct{}

	mu            sync.Mutex
	info          agent.RuntimeInfo
	activeTurnID  string
	turnDone      chan error
	turnError     string
	threadEmitted bool
	closed        bool
	unusable      bool
	abortTimeout  time.Duration
}

func (session *piSession) RuntimeInfo() agent.RuntimeInfo {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.info
}

func (session *piSession) Capabilities() agent.Capabilities {
	return agent.Capabilities{
		SupportsStreaming:          true,
		SupportsSessionPersistence: true,
		SupportsReasoningStream:    true,
		SupportsToolInvocations:    true,
	}
}

func (session *piSession) Events() <-chan agent.ProviderEvent {
	return session.events
}

func (session *piSession) Prompt(ctx context.Context, turnID, prompt string) error {
	session.mu.Lock()
	if session.closed || session.unusable {
		session.mu.Unlock()
		return agent.ErrSessionUnusable
	}
	if session.activeTurnID != "" {
		session.mu.Unlock()
		return errors.New("Pi session already has an active turn")
	}
	session.activeTurnID = turnID
	session.turnDone = make(chan error, 1)
	session.turnError = ""
	session.mu.Unlock()

	_, written, err := session.command(ctx, map[string]any{"type": "prompt", "message": prompt}, "prompt")
	if err == nil {
		return nil
	}
	if written {
		err = session.poison(err)
	}
	session.mu.Lock()
	session.finishTurnLocked(turnID, err)
	session.mu.Unlock()
	return err
}

func (session *piSession) Abort(ctx context.Context) error {
	session.mu.Lock()
	if session.closed || session.unusable {
		session.mu.Unlock()
		return agent.ErrSessionUnusable
	}
	turnID := session.activeTurnID
	turnDone := session.turnDone
	if turnID == "" || turnDone == nil {
		session.mu.Unlock()
		return errors.New("Pi session has no active turn")
	}
	abortTimeout := session.abortTimeout
	session.mu.Unlock()

	abortCtx, cancel := context.WithTimeout(ctx, abortTimeout)
	defer cancel()
	_, written, err := session.command(abortCtx, map[string]any{"type": "abort"}, "abort")
	if err != nil {
		if written {
			return session.poison(err)
		}
		return err
	}
	select {
	case result := <-turnDone:
		return result
	case <-abortCtx.Done():
		return session.poison(fmt.Errorf("wait for Pi turn to settle after abort: %w", abortCtx.Err()))
	}
}

func (session *piSession) poison(cause error) error {
	session.mu.Lock()
	if session.unusable || session.closed {
		session.unusable = true
		session.mu.Unlock()
		return errors.Join(agent.ErrSessionUnusable, cause)
	}
	session.unusable = true
	session.mu.Unlock()

	closeCtx, cancel := context.WithTimeout(context.Background(), poisonCloseTimeout)
	defer cancel()
	closeErr := session.process.Close(closeCtx)
	select {
	case <-session.pumpDone:
	case <-closeCtx.Done():
		closeErr = errors.Join(closeErr, closeCtx.Err())
	}
	return errors.Join(agent.ErrSessionUnusable, cause, closeErr)
}

func (session *piSession) Close(ctx context.Context) error {
	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		select {
		case <-session.pumpDone:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	session.closed = true
	session.mu.Unlock()

	closeErr := session.process.Close(ctx)
	select {
	case <-session.pumpDone:
		return closeErr
	case <-ctx.Done():
		if closeErr != nil {
			return errors.Join(closeErr, ctx.Err())
		}
		return ctx.Err()
	}
}

func (session *piSession) getState(ctx context.Context) (rpcState, error) {
	response, _, err := session.command(ctx, map[string]any{"type": "get_state"}, "get_state")
	if err != nil {
		return rpcState{}, err
	}
	var state rpcState
	if err := json.Unmarshal(response.Data, &state); err != nil {
		return rpcState{}, fmt.Errorf("decode get_state data: %w", err)
	}
	if state.SessionID == "" {
		return rpcState{}, errors.New("Pi get_state returned an empty session ID")
	}
	return state, nil
}

func (session *piSession) command(ctx context.Context, command map[string]any, wantCommand string) (rpcResponse, bool, error) {
	raw, written, err := session.process.Request(ctx, command)
	if err != nil {
		return rpcResponse{}, written, err
	}
	var response rpcResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return rpcResponse{}, written, fmt.Errorf("decode Pi %s response: %w", wantCommand, err)
	}
	if response.Type != "response" || response.Command != wantCommand {
		return rpcResponse{}, written, fmt.Errorf("unexpected Pi response for %s", wantCommand)
	}
	if !response.Success {
		message := strings.TrimSpace(response.Error)
		if message == "" {
			message = "command failed"
		}
		return rpcResponse{}, written, errors.New(message)
	}
	return response, written, nil
}

func (session *piSession) pumpEvents() {
	defer close(session.pumpDone)
	defer close(session.events)
	for raw := range session.process.Events() {
		session.handleEvent(raw)
	}

	err := session.process.Err()
	message := "Pi RPC process exited"
	if err != nil {
		message = err.Error()
	}
	session.mu.Lock()
	closed := session.closed
	turnID := session.activeTurnID
	session.finishTurnLocked(turnID, errors.Join(agent.ErrSessionUnusable, err))
	session.mu.Unlock()
	if closed {
		return
	}
	session.events <- agent.ProviderEvent{
		Type:   agent.ProviderEventProcessExited,
		TurnID: turnID,
		Error:  message,
	}
}

func (session *piSession) handleEvent(raw json.RawMessage) {
	var event rpcEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return
	}
	session.mu.Lock()
	turnID := session.activeTurnID
	closed := session.closed
	if closed {
		session.mu.Unlock()
		return
	}

	switch event.Type {
	case "agent_start":
		if session.threadEmitted {
			session.mu.Unlock()
			return
		}
		session.threadEmitted = true
		sessionID := session.info.SessionID
		session.mu.Unlock()
		session.emit(agent.ProviderEvent{Type: agent.ProviderEventThreadStarted, TurnID: turnID, SessionID: sessionID})
	case "turn_start":
		session.mu.Unlock()
		session.emit(agent.ProviderEvent{Type: agent.ProviderEventTurnStarted, TurnID: turnID})
	case "message_update":
		session.mu.Unlock()
		if event.AssistantMessageEvent == nil || event.AssistantMessageEvent.Delta == "" {
			return
		}
		item := agent.TimelineItem{Text: event.AssistantMessageEvent.Delta}
		switch event.AssistantMessageEvent.Type {
		case "text_delta":
			item.Type = agent.TimelineAssistantMessage
		case "thinking_delta":
			item.Type = agent.TimelineReasoning
		default:
			return
		}
		session.emit(agent.ProviderEvent{Type: agent.ProviderEventTimeline, TurnID: turnID, Item: item})
	case "tool_execution_start":
		session.mu.Unlock()
		session.emit(agent.ProviderEvent{
			Type:   agent.ProviderEventTimeline,
			TurnID: turnID,
			Item: agent.TimelineItem{
				Type:   agent.TimelineToolCall,
				CallID: event.ToolCallID,
				Name:   event.ToolName,
				Status: "running",
				Input:  cloneRaw(event.Args),
			},
		})
	case "tool_execution_update":
		session.mu.Unlock()
		session.emit(agent.ProviderEvent{
			Type:   agent.ProviderEventTimeline,
			TurnID: turnID,
			Item: agent.TimelineItem{
				Type:   agent.TimelineToolCall,
				CallID: event.ToolCallID,
				Name:   event.ToolName,
				Status: "running",
				Input:  cloneRaw(event.Args),
				Output: cloneRaw(event.PartialResult),
			},
		})
	case "tool_execution_end":
		status := "completed"
		errorMessage := ""
		if event.IsError {
			status = "failed"
			errorMessage = "tool execution failed"
		}
		session.mu.Unlock()
		session.emit(agent.ProviderEvent{
			Type:   agent.ProviderEventTimeline,
			TurnID: turnID,
			Item: agent.TimelineItem{
				Type:   agent.TimelineToolCall,
				CallID: event.ToolCallID,
				Name:   event.ToolName,
				Status: status,
				Input:  cloneRaw(event.Args),
				Output: cloneRaw(event.Result),
				Error:  errorMessage,
			},
		})
	case "message_end":
		if event.Message != nil && event.Message.Role == "assistant" {
			switch event.Message.StopReason {
			case "error":
				session.turnError = strings.TrimSpace(event.Message.ErrorMessage)
				if session.turnError == "" {
					session.turnError = "Pi assistant message failed"
				}
			case "stop":
				session.turnError = ""
			}
		}
		session.mu.Unlock()
	case "agent_end":
		if event.WillRetry {
			session.turnError = ""
		}
		session.mu.Unlock()
	case "agent_settled":
		errorMessage := session.turnError
		session.finishTurnLocked(turnID, nil)
		session.mu.Unlock()
		if turnID == "" {
			return
		}
		if errorMessage != "" {
			session.emit(agent.ProviderEvent{Type: agent.ProviderEventTurnFailed, TurnID: turnID, Error: errorMessage})
		} else {
			session.emit(agent.ProviderEvent{Type: agent.ProviderEventTurnCompleted, TurnID: turnID})
		}
	default:
		session.mu.Unlock()
	}
}

func (session *piSession) emit(event agent.ProviderEvent) {
	session.events <- event
}

func (session *piSession) finishTurnLocked(turnID string, result error) {
	if turnID == "" || session.activeTurnID != turnID {
		return
	}
	session.activeTurnID = ""
	session.turnError = ""
	if session.turnDone != nil {
		session.turnDone <- result
		close(session.turnDone)
		session.turnDone = nil
	}
}

type rpcResponse struct {
	Type    string          `json:"type"`
	Command string          `json:"command"`
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   string          `json:"error"`
}

type rpcState struct {
	SessionID     string `json:"sessionId"`
	SessionFile   string `json:"sessionFile"`
	ThinkingLevel string `json:"thinkingLevel"`
	Model         struct {
		ID       string `json:"id"`
		Provider string `json:"provider"`
	} `json:"model"`
}

type rpcEvent struct {
	Type                  string                    `json:"type"`
	AssistantMessageEvent *rpcAssistantMessageEvent `json:"assistantMessageEvent"`
	ToolCallID            string                    `json:"toolCallId"`
	ToolName              string                    `json:"toolName"`
	Args                  json.RawMessage           `json:"args"`
	PartialResult         json.RawMessage           `json:"partialResult"`
	Result                json.RawMessage           `json:"result"`
	IsError               bool                      `json:"isError"`
	Message               *rpcMessage               `json:"message"`
	WillRetry             bool                      `json:"willRetry"`
}

type rpcAssistantMessageEvent struct {
	Type  string `json:"type"`
	Delta string `json:"delta"`
}

type rpcMessage struct {
	Role         string `json:"role"`
	StopReason   string `json:"stopReason"`
	ErrorMessage string `json:"errorMessage"`
}

func cloneRaw(value json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), value...)
}

func mergeEnvironment(base []string, overrides map[string]string) []string {
	result := append([]string(nil), base...)
	for key, value := range overrides {
		result = append(result, key+"="+value)
	}
	return result
}
