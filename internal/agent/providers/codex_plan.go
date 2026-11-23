package providers

import (
	"context"
	"fmt"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// emitCodexPlanApprovalLocked turns Codex's final Plan item into the same approval boundary as
// the other providers. Plan mode otherwise produced a read-only todo row with no way to implement it.
func (s *CodexSession) emitCodexPlanApprovalLocked(planText string) []map[string]any {
	planText = strings.TrimSpace(planText)
	if planText == "" || s.featureValues["plan_mode"] != true {
		return nil
	}
	for _, pending := range s.pendingPermissions {
		if pending["kind"] == "plan" {
			return nil
		}
	}
	requestID := fmt.Sprintf("codex_plan_%d", s.nextID.Add(1))
	request := map[string]any{
		"id": requestID, "provider": "codex", "name": "CodexPlanApproval", "kind": "plan",
		"title": "Plan", "description": "Review the proposed plan before implementation starts.",
		"input": map[string]any{"plan": planText},
		"actions": []map[string]any{
			{"id": "dismiss", "label": "Dismiss", "behavior": "deny", "variant": "danger", "intent": "dismiss"},
			{"id": "implement", "label": "Implement", "behavior": "allow", "variant": "primary", "intent": "implement"},
		},
		"metadata": map[string]any{"planText": planText, "source": "codex_plan_approval"},
	}
	s.pendingPermissions[requestID] = request
	s.permissionRPCIDs[requestID] = "synthetic:plan"
	item := sdk.TimelineItem{
		Type: "tool_call", CallID: requestID, Name: "plan_approval", Status: "running",
		Detail: map[string]any{"type": "plan", "text": planText},
	}
	index := s.appendItemLocked(item)
	s.toolIndexByID[requestID] = index
	s.frames.AddToolCall(index, s.timeline[index].Item, s.activeTurnID, nil)
	events := s.flushFramesLocked()
	return append(events, map[string]any{"type": "permission_requested", "request": request})
}

func codexPlanImplementationPrompt(planText string) string {
	planText = strings.TrimSpace(planText)
	if planText == "" {
		return "Implement the approved plan. Make the required code changes and verify them."
	}
	return "Implement the approved plan.\n\nApproved plan:\n" + planText + "\n\nCarry out the work, make the necessary code changes, and verify the result."
}

// resolveCodexPlanApproval completes the proposal row and, for Implement, starts the ordinary
// coding turn after leaving plan mode. Denial only records the outcome; the next prompt is the
// user's own follow-up.
func (s *CodexSession) resolveCodexPlanApproval(requestID string, resp map[string]any, pending map[string]any) error {
	approved, _ := resp["behavior"].(string)
	approved = strings.TrimSpace(approved)
	allow := approved != "deny"
	metadata, _ := pending["metadata"].(map[string]any)
	planText, _ := metadata["planText"].(string)

	s.emitMu.Lock()
	s.mu.Lock()
	delete(s.pendingPermissions, requestID)
	delete(s.permissionRPCIDs, requestID)
	if index, ok := s.toolIndexByID[requestID]; ok {
		s.timeline[index].Item.Status = "completed"
		s.timeline[index].Item.Metadata = map[string]any{"approved": allow}
		s.frames.AddToolCall(index, s.timeline[index].Item, s.activeTurnID, nil)
	}
	if allow {
		values := make(map[string]any, len(s.featureValues)+1)
		for key, value := range s.featureValues {
			values[key] = value
		}
		values["plan_mode"] = false
		s.featureValues = values
	}
	events := s.flushFramesLocked()
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	s.deliverEvents(subs, events)
	s.emitMu.Unlock()

	if !allow {
		return nil
	}
	return s.prompt(context.Background(), codexPlanImplementationPrompt(planText), nil, false)
}

// dismissCodexPlanApprovals resolves stale proposals before a normal prompt or steer supersedes
// them. The proposal stays in the transcript, marked rejected instead of remaining actionable.
func (s *CodexSession) dismissCodexPlanApprovals(message string) {
	s.emitMu.Lock()
	s.mu.Lock()
	var events []map[string]any
	for _, requestID := range sortedCodexPermissionIDs(s.pendingPermissions) {
		pending := s.pendingPermissions[requestID]
		if pending["kind"] != "plan" {
			continue
		}
		delete(s.pendingPermissions, requestID)
		delete(s.permissionRPCIDs, requestID)
		if index, ok := s.toolIndexByID[requestID]; ok {
			s.timeline[index].Item.Status = "completed"
			s.timeline[index].Item.Metadata = map[string]any{"approved": false}
			s.frames.AddToolCall(index, s.timeline[index].Item, s.activeTurnID, nil)
		}
		events = append(events, map[string]any{
			"type": "permission_resolved", "requestId": requestID,
			"resolution": map[string]any{"behavior": "deny", "message": message},
		})
	}
	events = append(s.flushFramesLocked(), events...)
	subs := s.copySubscribersLocked()
	s.mu.Unlock()
	s.deliverEvents(subs, events)
	s.emitMu.Unlock()
}
