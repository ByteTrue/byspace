package pi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// RewindSupport reports which rewind modes a provider implements.
//
// `conversation` needs pi's tree navigation (via the integration extension). `files` is the
// daemon's own job — it restores the working tree — so it does not depend on the provider.
func (s *Session) RewindSupport() (conversation, files, both bool) {
	return true, true, true
}

// RewindConversation moves pi's conversation leaf to the given user message.
//
// pi exposes no RPC for this: the only route is the integration extension's `byspace_tree`
// command, which calls `ctx.navigateTree(targetId)` inside the pi process. Prompts it, then
// waits for the BYSPACE_COMMAND_RESULT notification that carries the outcome.
func (s *Session) RewindConversation(ctx context.Context, messageID string) error {
	target := strings.TrimSpace(messageID)
	if target == "" {
		return fmt.Errorf("pi rewind requires a user message id")
	}
	if s.Status() == "running" {
		// Navigating the tree mid-turn would race the model.
		return fmt.Errorf("cannot rewind the Pi conversation while a turn is active")
	}

	requestID := fmt.Sprintf("rewind_%d", time.Now().UnixNano())
	resultCh := s.awaitCommandResult(requestID)

	payload, err := json.Marshal(map[string]string{"targetId": target, "requestId": requestID})
	if err != nil {
		return err
	}
	prompt := "/" + TreeExtensionCommand + " " + base64.RawURLEncoding.EncodeToString(payload)
	if _, err := s.proc.Request(ctx, map[string]any{"type": "prompt", "message": prompt}); err != nil {
		s.dropCommandWaiter(requestID)
		return err
	}

	select {
	case result := <-resultCh:
		if !result.ok {
			if result.err == "" {
				return fmt.Errorf("pi tree navigation failed")
			}
			return fmt.Errorf("%s", result.err)
		}
		return nil
	case <-ctx.Done():
		s.dropCommandWaiter(requestID)
		return ctx.Err()
	}
}

type commandResult struct {
	ok  bool
	err string
}

// awaitCommandResult registers interest in a BYSPACE_COMMAND_RESULT with this request id.
func (s *Session) awaitCommandResult(requestID string) <-chan commandResult {
	ch := make(chan commandResult, 1)
	s.mu.Lock()
	if s.commandWaiters == nil {
		s.commandWaiters = make(map[string]chan commandResult)
	}
	s.commandWaiters[requestID] = ch
	s.mu.Unlock()
	return ch
}

func (s *Session) dropCommandWaiter(requestID string) {
	s.mu.Lock()
	delete(s.commandWaiters, requestID)
	s.mu.Unlock()
}

// handleCommandResultNotification resolves a pending rewind after the extension reports back.
func (s *Session) handleCommandResultNotification(text string) {
	rest, ok := strings.CutPrefix(text, CommandResultMarker)
	if !ok {
		return
	}
	var payload struct {
		RequestID string `json:"requestId"`
		OK        bool   `json:"ok"`
		Error     string `json:"error"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(rest)), &payload) != nil || payload.RequestID == "" {
		return
	}
	s.mu.Lock()
	ch, ok := s.commandWaiters[payload.RequestID]
	delete(s.commandWaiters, payload.RequestID)
	s.mu.Unlock()
	if !ok {
		return
	}
	select {
	case ch <- commandResult{ok: payload.OK, err: payload.Error}:
	default:
	}
}

// handleExtensionNotification routes a `ctx.ui.notify` payload from the integration extension.
//
// Three markers exist: command results (rewind), entry captures (which user message maps to
// which tree entry), and per-message acknowledgements. Only the first two matter to the daemon.
func (s *Session) handleExtensionNotification(message string) {
	trimmed := strings.TrimSpace(message)
	if strings.HasPrefix(trimmed, CommandResultMarker) {
		s.handleCommandResultNotification(trimmed)
		return
	}
	if strings.HasPrefix(trimmed, EntryCaptureMarker) || strings.HasPrefix(trimmed, SubmittedUserEntryMarker) {
		s.handleEntryCaptureNotification(trimmed)
	}
}

// handleEntryCaptureNotification records the pi tree entry id for each user message.
//
// Rewind needs it: the client sends a BySpace message id, but pi navigates by its own tree entry
// id. Without this mapping there is nothing to navigate to.
func (s *Session) handleEntryCaptureNotification(message string) {
	rest := strings.TrimPrefix(strings.TrimPrefix(message, EntryCaptureMarker), SubmittedUserEntryMarker)
	var payload struct {
		Entries []struct {
			ID       string `json:"id"`
			ParentID string `json:"parentId"`
			Text     string `json:"text"`
		} `json:"entries"`
		Entry *struct {
			ID       string `json:"id"`
			ParentID string `json:"parentId"`
			Text     string `json:"text"`
		} `json:"entry"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(rest)), &payload) != nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.treeEntries == nil {
		s.treeEntries = make(map[string]string)
	}
	record := func(id, text string) {
		if id == "" || text == "" {
			return
		}
		// Index by normalized text: the client knows the message text, not pi's entry id.
		s.treeEntries[strings.TrimSpace(text)] = id
	}
	for _, entry := range payload.Entries {
		record(entry.ID, entry.Text)
	}
	if payload.Entry != nil {
		record(payload.Entry.ID, payload.Entry.Text)
	}
}

// TreeEntryForMessage resolves a user message's text to pi's tree entry id.
func (s *Session) TreeEntryForMessage(text string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.treeEntries[strings.TrimSpace(text)]
	return id, ok
}

// SetCleanup registers a function to run when the session closes (the generated extension's
// temp directory, which must not outlive the agent).
func (s *Session) SetCleanup(fn func()) {
	s.mu.Lock()
	s.cleanup = fn
	s.mu.Unlock()
}
