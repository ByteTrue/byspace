package providers

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/replaytime"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/agent/tasknotify"
)

// LoadClaudeSubagentTimelineFromJSONL keeps the sidechain rows the main transcript
// parser intentionally omits: tool output, reasoning, and background notifications.
func LoadClaudeSubagentTimelineFromJSONL(filePath, subagentID string) ([]sdk.TimelineEntry, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	s := &ClaudeSession{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var row map[string]any
		if json.Unmarshal(sc.Bytes(), &row) != nil {
			continue
		}
		entries := s.subagentTimelines[subagentID]
		before := len(entries)
		ts := replaytime.Normalize(row["timestamp"])
		if ts == "" {
			ts = time.Now().UTC().Format(time.RFC3339Nano)
		}
		switch row["type"] {
		case "assistant":
			s.recordClaudeSubagentAssistantLocked(subagentID, row)
		case "user":
			msg, _ := row["message"].(map[string]any)
			if card := tasknotify.Map(msg["content"]); card != nil {
				s.appendClaudeSubagentItemLocked(subagentID, claudeTaskNotificationItem(card))
			} else if claudeMessageHasToolResult(msg) {
				s.recordClaudeSubagentToolResultsLocked(subagentID, row)
			} else if text := claudeTranscriptUserText(msg); text != "" {
				s.appendClaudeSubagentItemLocked(subagentID, sdk.TimelineItem{Type: "user_message", Text: text})
			}
		case "attachment":
			attachment, _ := row["attachment"].(map[string]any)
			if card := tasknotify.Map(attachment["prompt"]); card != nil {
				s.appendClaudeSubagentItemLocked(subagentID, claudeTaskNotificationItem(card))
			}
		}
		entries = s.subagentTimelines[subagentID]
		for i := before; i < len(entries); i++ {
			entries[i].Seq = i + 1
			entries[i].Timestamp = ts
		}
	}
	return s.subagentTimelines[subagentID], sc.Err()
}

func claudeTaskNotificationItem(card *tasknotify.Card) sdk.TimelineItem {
	detail := card.Detail
	detail["metadata"] = card.Metadata
	return sdk.TimelineItem{Type: "tool_call", CallID: card.CallID, Name: card.Name, Status: card.Status, Detail: detail, Error: card.Error}
}

func claudeMessageHasToolResult(msg map[string]any) bool {
	content, _ := msg["content"].([]any)
	for _, raw := range content {
		block, _ := raw.(map[string]any)
		if block["type"] == "tool_result" {
			return true
		}
	}
	return false
}

func claudeTranscriptUserText(msg map[string]any) string {
	switch content := msg["content"].(type) {
	case string:
		return content
	case []any:
		parts := make([]string, 0, len(content))
		for _, raw := range content {
			block, _ := raw.(map[string]any)
			if block["type"] == "text" {
				if text, _ := block["text"].(string); text != "" {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}
