package providers

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/agent/tasknotify"
)

var (
	claudeWorkflowSummaryPattern = regexp.MustCompile("(?m)^Summary:\\s*(.+)$")
	claudeWorkflowTaskPattern    = regexp.MustCompile("\\bTask ID:\\s*(\\S+)")
	claudeWorkflowRunPattern     = regexp.MustCompile("(?m)^Run ID:\\s*(\\S+)")
)

func (s *ClaudeSession) declareClaudeWorkflowLocked(callID string) map[string]any {
	if callID == "" {
		return nil
	}
	if existing, ok := s.subagents[callID]; ok {
		return claudeSubagentUpsertEvent(existing)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	title, kind, description := "Workflow", "Workflow", ""
	toolCallID := callID
	descriptor := sdk.SubagentDescriptor{
		ID: callID, Provider: "claude", Status: "running", Title: &title, Kind: &kind,
		Description: &description, ToolCallID: &toolCallID, CreatedAt: now, UpdatedAt: now,
	}
	sdk.RefreshSubagentSubtitle(&descriptor)
	s.subagents[callID] = descriptor
	return claudeSubagentUpsertEvent(descriptor)
}

func (s *ClaudeSession) observeClaudeWorkflowResultLocked(callID string, content any, failed bool) map[string]any {
	descriptor, ok := s.subagents[callID]
	if !ok || descriptor.Kind == nil || *descriptor.Kind != "Workflow" {
		return nil
	}
	text := claudeWorkflowResultText(content)
	if match := claudeWorkflowSummaryPattern.FindStringSubmatch(text); len(match) == 2 {
		summary := strings.TrimSpace(match[1])
		if summary != "" && !claudeSubagentHasUserText(s.subagentTimelines[callID], summary) {
			s.appendClaudeSubagentItemLocked(callID, sdk.TimelineItem{Type: "user_message", Text: summary})
		}
	}
	if s.nativeTaskIDs == nil {
		s.nativeTaskIDs = make(map[string]string)
	}
	for _, pattern := range []*regexp.Regexp{claudeWorkflowTaskPattern, claudeWorkflowRunPattern} {
		if match := pattern.FindStringSubmatch(text); len(match) == 2 {
			s.nativeTaskIDs[match[1]] = callID
		}
	}
	if failed {
		descriptor.Status = "failed"
	}
	descriptor.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	sdk.RefreshSubagentSubtitle(&descriptor)
	s.subagents[callID] = descriptor
	return claudeSubagentUpsertEvent(descriptor)
}

func claudeSubagentUpsertEvent(descriptor sdk.SubagentDescriptor) map[string]any {
	return map[string]any{
		"type": "byspace_provider_subagents", "kind": "upsert",
		"subagent": descriptor, "updatedAt": descriptor.UpdatedAt,
	}
}

func claudeSubagentHasUserText(entries []sdk.TimelineEntry, text string) bool {
	for _, entry := range entries {
		if entry.Item.Type == "user_message" && entry.Item.Text == text {
			return true
		}
	}
	return false
}

func claudeWorkflowResultText(content any) string {
	switch value := content.(type) {
	case string:
		return value
	case []any:
		parts := make([]string, 0, len(value))
		for _, raw := range value {
			block, _ := raw.(map[string]any)
			if text, _ := block["text"].(string); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return fmt.Sprint(content)
	}
}

func claudeTaskNotificationOutputFile(ev map[string]any) string {
	for _, key := range []string{"output_file", "outputFile"} {
		if value, _ := ev[key].(string); value != "" {
			return value
		}
	}
	if metadata, _ := ev["metadata"].(map[string]any); metadata != nil {
		if value, _ := metadata["outputFile"].(string); value != "" {
			return value
		}
	}
	if card := tasknotify.Map(ev["content"]); card != nil {
		value, _ := card.Metadata["outputFile"].(string)
		return value
	}
	return ""
}

// Claude can emit task_notification just before the output file is durable on Windows.
func readClaudeWorkflowOutputWithWait(path string) string {
	for attempt := 0; attempt < 10; attempt++ {
		if text := readClaudeWorkflowOutput(path); text != "" {
			return text
		}
		time.Sleep(50 * time.Millisecond)
	}
	return ""
}

func readClaudeWorkflowOutput(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return ""
	}
	var payload map[string]any
	if json.Unmarshal(data, &payload) != nil {
		return ""
	}
	result, ok := payload["result"]
	if !ok {
		return ""
	}
	return formatClaudeWorkflowResult(result)
}

func formatClaudeWorkflowResult(result any) string {
	current := result
	for depth := 0; depth < 8; depth++ {
		record, ok := current.(map[string]any)
		if !ok || len(record) != 1 {
			break
		}
		for _, value := range record {
			current = value
		}
	}
	var text string
	switch value := current.(type) {
	case string:
		text = strings.TrimSpace(value)
	case float64, bool:
		text = fmt.Sprint(value)
	case nil:
		return ""
	default:
		encoded, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return ""
		}
		text = "\x60\x60\x60json\n" + string(encoded) + "\n\x60\x60\x60"
	}
	if len(text) > 100000 {
		return text[:100000] + "\n\n…"
	}
	return text
}
