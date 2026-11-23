package providers

import (
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func (s *ClaudeSession) appendClaudeSubagentItemLocked(subagentID string, item sdk.TimelineItem) {
	if s.subagentTimelines == nil {
		s.subagentTimelines = make(map[string][]sdk.TimelineEntry)
	}
	entries := s.subagentTimelines[subagentID]
	entry := sdk.TimelineEntry{Seq: len(entries) + 1, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Item: item}
	s.subagentTimelines[subagentID] = append(entries, entry)
}

func (s *ClaudeSession) recordClaudeSubagentAssistantLocked(subagentID string, ev map[string]any) {
	msg, _ := ev["message"].(map[string]any)
	content, _ := msg["content"].([]any)
	for _, raw := range content {
		block, _ := raw.(map[string]any)
		switch block["type"] {
		case "text":
			if text, _ := block["text"].(string); text != "" {
				s.appendClaudeSubagentItemLocked(subagentID, sdk.TimelineItem{Type: "assistant_message", Text: text})
			}
		case "thinking":
			if text, _ := block["thinking"].(string); text != "" {
				s.appendClaudeSubagentItemLocked(subagentID, sdk.TimelineItem{Type: "reasoning", Text: text})
			}
		case "tool_use":
			callID, _ := block["id"].(string)
			name, _ := block["name"].(string)
			input := block["input"]
			if (name == "Task" || name == "Agent") && callID != "" {
				if s.subagentToolOwners == nil {
					s.subagentToolOwners = make(map[string]string)
				}
				s.subagentToolOwners[callID] = subagentID
			}
			s.appendClaudeSubagentItemLocked(subagentID, sdk.TimelineItem{
				Type: "tool_call", CallID: callID, Name: name, Status: "running",
				Detail: sdk.BuildToolCallDetail(strings.ToLower(name), input, nil),
			})
		}
	}
}

func (s *ClaudeSession) recordClaudeSubagentToolResultsLocked(subagentID string, ev map[string]any) {
	msg, _ := ev["message"].(map[string]any)
	content, _ := msg["content"].([]any)
	entries := s.subagentTimelines[subagentID]
	for _, raw := range content {
		block, _ := raw.(map[string]any)
		if block["type"] != "tool_result" {
			continue
		}
		callID, _ := block["tool_use_id"].(string)
		for i := len(entries) - 1; i >= 0; i-- {
			if entries[i].Item.Type != "tool_call" || entries[i].Item.CallID != callID {
				continue
			}
			isError, _ := block["is_error"].(bool)
			entries[i].Item.Status = "completed"
			if isError {
				entries[i].Item.Status = "failed"
			}
			entries[i].Item.Detail = sdk.BuildToolCallDetail(strings.ToLower(entries[i].Item.Name), nil, block["content"])
			break
		}
	}
}

func (s *ClaudeSession) SubagentTimeline(_ string, subagentID string) ([]sdk.TimelineEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshClaudeSidecarsLocked()
	entries := s.subagentTimelines[subagentID]
	if descriptor := s.subagents[subagentID]; descriptor.SessionFile != "" {
		if native, err := LoadClaudeSubagentTimelineFromJSONL(descriptor.SessionFile, subagentID); err == nil && len(native) > len(entries) {
			entries = native
		}
	}
	return append([]sdk.TimelineEntry(nil), entries...), nil
}
