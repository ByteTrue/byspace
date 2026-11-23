package providers

import (
	"fmt"
)

const claudeSteerSupersededPermissionMessage = "The user answered with a message instead of approving. Their message follows."

// emitClaudePermissionResolved keeps the native tool row and the permission store in sync when
// a response came from steering rather than the permission card's own button.
func (s *ClaudeSession) emitClaudePermissionResolved(requestID string, pending, resp map[string]any) {
	s.mu.Lock()
	allow, _ := resp["behavior"].(string)
	callID := requestID
	if metadata, _ := pending["metadata"].(map[string]any); metadata != nil {
		if native, _ := metadata["toolUseId"].(string); native != "" {
			callID = native
		}
	}
	var events []map[string]any
	for index := range s.timeline {
		entry := &s.timeline[index]
		if entry.Item.Type != "tool_call" || entry.Item.CallID != callID {
			continue
		}
		if allow == "deny" {
			entry.Item.Status = "failed"
			message, _ := resp["message"].(string)
			if message == "" {
				message = "Permission denied"
			}
			entry.Item.Error = map[string]any{"message": message}
		} else {
			entry.Item.Status = "completed"
			entry.Item.Error = nil
		}
		s.streamSeq++
		entry.SeqEnd = s.streamSeq
		events = append(events, map[string]any{
			"type": "byspace_stream_timeline", "seq": s.streamSeq,
			"turnId": s.activeTurnID, "item": entry.Item,
		})
		break
	}
	events = append(events, map[string]any{
		"type": "permission_resolved", "requestId": requestID, "resolution": resp,
	})
	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	s.mu.Unlock()
	for _, fn := range subs {
		for _, event := range events {
			fn(event)
		}
	}
}

func claudePermissionControlPayload(pending, resp map[string]any) map[string]any {
	behavior, _ := resp["behavior"].(string)
	if behavior == "" {
		behavior = "allow"
	}
	result := map[string]any{"behavior": behavior}
	if behavior == "allow" {
		updated, _ := resp["updatedInput"].(map[string]any)
		if updated == nil {
			updated, _ = pending["input"].(map[string]any)
		}
		if updated == nil {
			updated = map[string]any{}
		}
		result["updatedInput"] = updated
	} else {
		message, _ := resp["message"].(string)
		if message == "" {
			message = "Permission request denied"
		}
		result["message"] = message
		if interrupt, ok := resp["interrupt"].(bool); ok {
			result["interrupt"] = interrupt
		}
	}
	return result
}

func (s *ClaudeSession) denyClaudePermissionsForSteer() error {
	s.mu.Lock()
	ids := make([]string, 0, len(s.pendingPermissions))
	for id := range s.pendingPermissions {
		ids = append(ids, id)
	}
	s.mu.Unlock()
	for _, id := range ids {
		if err := s.RespondToPermission(id, map[string]any{
			"behavior": "deny", "message": claudeSteerSupersededPermissionMessage,
		}); err != nil {
			return fmt.Errorf("supersede Claude permission: %w", err)
		}
	}
	return nil
}
