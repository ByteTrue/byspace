package pi

import (
	"fmt"
	"strings"
)

func (s *Session) appendCustomMessageLocked(message map[string]any) map[string]any {
	if display, ok := message["display"].(bool); ok && !display {
		return nil
	}
	customType, _ := message["customType"].(string)
	customType = strings.TrimSpace(customType)
	if customType == "" || isSubagentExit(customType) {
		return nil
	}
	text := customMessageText(message["content"])
	idx := s.appendItemLocked(TimelineItem{
		Type:   "tool_call",
		CallID: fmt.Sprintf("pi-custom-%d-%d", s.turnCounter, len(s.timeline)+1),
		Name:   customType,
		Status: "completed",
		Detail: map[string]any{"type": "plain_text", "text": text},
		Metadata: map[string]any{
			"synthetic":  true,
			"customType": customType,
			"details":    message["details"],
		},
		Error: nil,
	})
	return map[string]any{"type": "byspace_stream_timeline", "seq": s.timeline[idx].SeqEnd, "turnId": s.activeTurnID, "item": s.timeline[idx].Item}
}

func customMessageText(content any) string {
	switch typed := content.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, raw := range typed {
			block, _ := raw.(map[string]any)
			if text, _ := block["text"].(string); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}
