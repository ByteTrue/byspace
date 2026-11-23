package providers

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type claudeControlResult struct {
	response map[string]any
	err      error
}

func (s *ClaudeSession) control(ctx context.Context, subtype string, fields map[string]any) (map[string]any, error) {
	if s.proc == nil {
		return nil, errors.New("claude process is not running")
	}
	request := map[string]any{"subtype": subtype}
	for key, value := range fields {
		request[key] = value
	}
	s.mu.Lock()
	s.controlCounter++
	requestID := fmt.Sprintf("byspace-%s-%d", subtype, s.controlCounter)
	if s.pendingControls == nil {
		s.pendingControls = make(map[string]chan claudeControlResult)
	}
	ch := make(chan claudeControlResult, 1)
	s.pendingControls[requestID] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pendingControls, requestID)
		s.mu.Unlock()
	}()
	if err := s.proc.SendRaw(map[string]any{
		"type": "control_request", "request_id": requestID, "request": request,
	}); err != nil {
		return nil, err
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
	}
	select {
	case result := <-ch:
		return result.response, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *ClaudeSession) resolveControl(ev map[string]any) bool {
	envelope, _ := ev["response"].(map[string]any)
	requestID, _ := envelope["request_id"].(string)
	if requestID == "" {
		return false
	}
	s.mu.Lock()
	ch := s.pendingControls[requestID]
	delete(s.pendingControls, requestID)
	s.mu.Unlock()
	if ch == nil {
		return false
	}
	if envelope["subtype"] == "error" {
		message, _ := envelope["error"].(string)
		if message == "" {
			message = "Claude rejected the control request"
		}
		ch <- claudeControlResult{err: errors.New(message)}
		return true
	}
	response, _ := envelope["response"].(map[string]any)
	ch <- claudeControlResult{response: response}
	return true
}

func (s *ClaudeSession) RewindFiles(ctx context.Context, messageID string) error {
	response, err := s.control(ctx, "rewind_files", map[string]any{
		"user_message_id": messageID, "dry_run": false,
	})
	if err != nil {
		return err
	}
	canRewind, _ := response["canRewind"].(bool)
	if !canRewind {
		if message, _ := response["error"].(string); message != "" {
			return errors.New(message)
		}
		return errors.New("Claude has no file checkpoint for that message")
	}
	return nil
}

func (s *ClaudeSession) failControls(err error) {
	s.mu.Lock()
	pending := s.pendingControls
	s.pendingControls = make(map[string]chan claudeControlResult)
	s.mu.Unlock()
	for _, ch := range pending {
		ch <- claudeControlResult{err: err}
	}
}
