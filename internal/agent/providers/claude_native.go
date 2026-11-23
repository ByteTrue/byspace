package providers

import (
	"fmt"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func (s *ClaudeSession) handleClaudeSystemLocked(ev map[string]any) []map[string]any {
	subtype, _ := ev["subtype"].(string)
	switch subtype {
	case "background_tasks_changed":
		tasks, _ := ev["tasks"].([]any)
		s.handleClaudeBackgroundTasksLocked(tasks)
		return nil
	case "task_started", "task_progress", "task_updated", "task_notification":
		return s.handleClaudeTaskLocked(subtype, ev)
	case "status":
		var events []map[string]any
		if mode, _ := ev["permissionMode"].(string); mode != "" && mode != s.modeID {
			s.modeID = mode
			events = append(events, map[string]any{"type": "mode_changed", "modeId": mode})
		}
		if status, _ := ev["status"].(string); status == "compacting" && !s.compactionOpen {
			idx := s.appendItemLocked(sdk.TimelineItem{Type: "compaction", Status: "loading"})
			s.compactionOpen = true
			s.compactionIdx = idx
			events = append(events, s.claudeTimelineEventLocked(idx))
		}
		return events
	case "compact_boundary":
		metadata, _ := ev["compact_metadata"].(map[string]any)
		trigger, _ := metadata["trigger"].(string)
		preTokens, _ := numericParam(metadata, "pre_tokens")
		item := sdk.TimelineItem{Type: "compaction", Status: "completed", Trigger: trigger, PreTokens: preTokens}
		idx := s.compactionIdx
		if !s.compactionOpen || idx < 0 || idx >= len(s.timeline) {
			idx = s.appendItemLocked(item)
		} else {
			s.timeline[idx].Item = item
		}
		s.compactionOpen = false
		s.compactionIdx = -1
		return []map[string]any{s.claudeTimelineEventLocked(idx)}
	case "session_state_changed":
		state, _ := ev["state"].(string)
		if state == "idle" && strings.HasPrefix(s.activeTurnID, "auto-") {
			turnID := s.activeTurnID
			s.activeTurnID = ""
			s.status = "idle"
			s.notifyFinishLocked(nil)
			return []map[string]any{{"type": "agent_end", "turnId": turnID}}
		}
	}
	return nil
}

func (s *ClaudeSession) openClaudeAutonomousTurnLocked() []map[string]any {
	if s.activeTurnID != "" {
		return nil
	}
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("auto-%d", s.turnCounter)
	s.status = "running"
	return []map[string]any{{"type": "turn_start", "turnId": s.activeTurnID}}
}

func (s *ClaudeSession) handleClaudeTaskLocked(subtype string, ev map[string]any) []map[string]any {
	taskID, _ := ev["task_id"].(string)
	if taskID == "" {
		return nil
	}
	taskType, _ := ev["task_type"].(string)
	subagentType, _ := ev["subagent_type"].(string)
	kind := subagentType
	if taskType == "local_workflow" {
		kind = "Workflow"
	}
	if kind == "" {
		kind = "Subagent"
	}
	if s.nativeTaskIDs == nil {
		s.nativeTaskIDs = make(map[string]string)
	}
	canonical := s.nativeTaskIDs[taskID]
	if subtype == "task_started" {
		if (taskType != "local_agent" && taskType != "local_workflow" && !(taskType == "" && subagentType != "")) || ev["skip_transcript"] == true {
			return nil
		}
		toolUseID, _ := ev["tool_use_id"].(string)
		if toolUseID == "" {
			return nil
		}
		s.nativeTasks = true
		if canonical == "" {
			canonical = toolUseID
			s.nativeTaskIDs[taskID] = canonical
		}
		if _, exists := s.subagents[canonical]; !exists {
			now := time.Now().UTC().Format(time.RFC3339Nano)
			title, _ := ev["subagent_type"].(string)
			if taskType == "local_workflow" {
				title = "Workflow"
			}
			if input, _ := s.toolArgsByID[toolUseID].(map[string]any); input != nil && taskType != "local_workflow" {
				if explicit, _ := input["description"].(string); explicit != "" {
					title = explicit
				}
				if explicit, _ := input["name"].(string); explicit != "" {
					title = explicit
				}
			}
			if title == "" {
				title = "Subagent"
			}
			description, _ := ev["description"].(string)
			toolCopy := toolUseID
			var parentSubagentID *string
			if owner := s.subagentToolOwners[toolUseID]; owner != "" && owner != canonical {
				parentSubagentID = &owner
			}
			descriptor := sdk.SubagentDescriptor{
				ID: canonical, ParentSubagentID: parentSubagentID, Provider: "claude", Status: "running", Title: &title, Kind: &kind,
				Description: &description, ToolCallID: &toolCopy, CreatedAt: now, UpdatedAt: now,
			}
			sdk.RefreshSubagentSubtitle(&descriptor)
			s.subagents[canonical] = descriptor
			if prompt, _ := ev["prompt"].(string); prompt != "" {
				s.appendClaudeSubagentItemLocked(canonical, sdk.TimelineItem{Type: "user_message", Text: prompt})
			}
		}
	} else if canonical == "" {
		return nil
	}
	descriptor := s.subagents[canonical]
	if descriptor.ToolCallID != nil {
		if owner := s.subagentToolOwners[*descriptor.ToolCallID]; owner != "" && owner != canonical {
			descriptor.ParentSubagentID = &owner
		}
	}
	if descriptor.Kind == nil {
		descriptor.Kind = &kind
	}
	// task_started can precede the streamed Task input. Re-read the tool arguments on
	// later task events so the explicit name replaces the generic subagent type.
	if descriptor.ToolCallID != nil {
		if input, _ := s.toolArgsByID[*descriptor.ToolCallID].(map[string]any); input != nil && (descriptor.Kind == nil || *descriptor.Kind != "Workflow") {
			title, _ := input["description"].(string)
			if explicit, _ := input["name"].(string); explicit != "" {
				title = explicit
			}
			if title != "" {
				descriptor.Title = &title
				sdk.RefreshSubagentSubtitle(&descriptor)
			}
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	descriptor.UpdatedAt = now
	switch subtype {
	case "task_progress":
		usage, _ := ev["usage"].(map[string]any)
		tokens, _ := numericParam(usage, "total_tokens")
		tokens64 := int64(tokens)
		descriptor.TotalTokens = &tokens64
	case "task_updated":
		patch, _ := ev["patch"].(map[string]any)
		descriptor.Status = claudeNativeTaskStatus(patch["status"])
	case "task_notification":
		descriptor.Status = claudeNativeTaskStatus(ev["status"])
		if summary, _ := ev["summary"].(string); summary != "" && (descriptor.Kind == nil || *descriptor.Kind != "Workflow") {
			descriptor.Description = &summary
		}
		if descriptor.Kind != nil && *descriptor.Kind == "Workflow" {
			if outputFile := claudeTaskNotificationOutputFile(ev); outputFile != "" {
				if text := readClaudeWorkflowOutputWithWait(outputFile); text != "" {
					s.appendClaudeSubagentItemLocked(canonical, sdk.TimelineItem{Type: "assistant_message", Text: text})
				}
			}
		}
	}
	sdk.RefreshSubagentSubtitle(&descriptor)
	s.subagents[canonical] = descriptor
	return []map[string]any{{
		"type": "byspace_provider_subagents", "kind": "upsert",
		"subagent": descriptor, "updatedAt": now,
	}}
}

func claudeNativeTaskStatus(raw any) string {
	status, _ := raw.(string)
	switch status {
	case "completed":
		return "completed"
	case "failed":
		return "failed"
	case "killed", "stopped":
		return "canceled"
	default:
		return "running"
	}
}

func (s *ClaudeSession) claudeTimelineEventLocked(idx int) map[string]any {
	s.sealClaudeTimelineEntryLocked(idx)
	entry := &s.timeline[idx]
	return map[string]any{
		"type": "byspace_stream_timeline", "seq": s.streamSeq,
		"turnId": s.activeTurnID, "item": entry.Item,
	}
}
