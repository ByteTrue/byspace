package providers

import (
	"encoding/json"
	"strconv"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func (s *ClaudeSession) ensureStreamLocked() {
	if s.frames == nil {
		s.frames = sdk.NewStreamFrames(s.flushFramesOnTimer)
	}
	if s.toolArgsByID == nil {
		s.toolArgsByID = make(map[string]any)
		s.toolIndexByID = make(map[string]int)
	}
	if s.streamText == nil {
		s.streamText = make(map[string]string)
		s.streamReasoning = make(map[string]string)
		s.streamTextIdx = make(map[string]int)
		s.streamReasoningIdx = make(map[string]int)
		s.streamBlocks = make(map[int]string)
		s.streamToolJSON = make(map[string]string)
	}
}

func claudeBlockIndex(event map[string]any) int {
	value, _ := numericParam(event, "index")
	return value
}

func claudeStreamBlockKey(messageID string, blockIndex int) string {
	return messageID + ":" + strconv.Itoa(blockIndex)
}

func claudeStreamMessageID(ev map[string]any) string {
	event, _ := ev["event"].(map[string]any)
	if id, _ := event["message_id"].(string); id != "" {
		return id
	}
	message, _ := event["message"].(map[string]any)
	if id, _ := message["id"].(string); id != "" {
		return id
	}
	return ""
}

func claudeAssistantMessageID(ev map[string]any) string {
	if id, _ := ev["message_id"].(string); id != "" {
		return id
	}
	message, _ := ev["message"].(map[string]any)
	id, _ := message["id"].(string)
	return id
}

func (s *ClaudeSession) handleClaudeStreamEventLocked(ev map[string]any) {
	s.ensureStreamLocked()
	event, _ := ev["event"].(map[string]any)
	typeName, _ := event["type"].(string)
	if id := claudeStreamMessageID(ev); id != "" {
		s.streamMessageID = id
	}
	messageID := s.streamMessageID
	if messageID == "" {
		messageID = "claude-stream-current"
	}
	switch typeName {
	case "content_block_start":
		index := claudeBlockIndex(event)
		block, _ := event["content_block"].(map[string]any)
		switch block["type"] {
		case "tool_use":
			callID, _ := block["id"].(string)
			name, _ := block["name"].(string)
			if callID == "" {
				return
			}
			s.streamBlocks[index] = callID
			s.streamToolJSON[callID] = ""
			input := block["input"]
			s.toolArgsByID[callID] = input
			idx := s.appendItemLocked(sdk.TimelineItem{
				Type: "tool_call", CallID: callID, Name: name, Status: "running",
				Detail: sdk.BuildToolCallDetail(name, input, nil),
			})
			s.toolIndexByID[callID] = idx
			s.addToolFrameLocked(idx)
		}
	case "content_block_delta":
		index := claudeBlockIndex(event)
		delta, _ := event["delta"].(map[string]any)
		switch delta["type"] {
		case "text_delta":
			text, _ := delta["text"].(string)
			s.appendClaudeTextDeltaLocked(messageID, index, "assistant_message", text)
		case "thinking_delta":
			text, _ := delta["thinking"].(string)
			s.appendClaudeTextDeltaLocked(messageID, index, "reasoning", text)
		case "input_json_delta":
			callID := s.streamBlocks[index]
			if callID == "" {
				return
			}
			part, _ := delta["partial_json"].(string)
			s.streamToolJSON[callID] += part
			var input any
			if json.Unmarshal([]byte(s.streamToolJSON[callID]), &input) == nil {
				s.updateClaudeToolInputLocked(callID, input)
			}
		}
	case "content_block_stop":
		delete(s.streamBlocks, claudeBlockIndex(event))
	}
}

func (s *ClaudeSession) appendClaudeTextDeltaLocked(messageID string, blockIndex int, itemType, delta string) {
	if delta == "" {
		return
	}
	s.ensureStreamLocked()
	values := s.streamText
	indexes := s.streamTextIdx
	if itemType == "reasoning" {
		values = s.streamReasoning
		indexes = s.streamReasoningIdx
	}
	key := claudeStreamBlockKey(messageID, blockIndex)
	idx, ok := indexes[key]
	if !ok {
		idx = s.appendItemLocked(sdk.TimelineItem{Type: itemType, MessageID: messageID})
		indexes[key] = idx
	}
	values[key] += delta
	s.timeline[idx].Item.Text = values[key]
	s.timeline[idx].Item.MessageID = messageID
	s.frames.AddText(idx, sdk.TimelineItem{Type: itemType, MessageID: messageID, Text: delta}, s.activeTurnID)
}

func (s *ClaudeSession) appendClaudeFinalTextLocked(messageID string, blockIndex int, itemType, full string) {
	if messageID == "" {
		s.appendItemLocked(sdk.TimelineItem{Type: itemType, Text: full})
		return
	}
	s.ensureStreamLocked()
	values := s.streamText
	if itemType == "reasoning" {
		values = s.streamReasoning
	}
	key := claudeStreamBlockKey(messageID, blockIndex)
	streamed := values[key]
	if streamed == full && streamed != "" {
		return
	}
	if len(full) >= len(streamed) && full[:len(streamed)] == streamed {
		s.appendClaudeTextDeltaLocked(messageID, blockIndex, itemType, full[len(streamed):])
		return
	}
	s.appendClaudeTextDeltaLocked(messageID, blockIndex, itemType, full)
}

func (s *ClaudeSession) updateClaudeToolInputLocked(callID string, input any) {
	idx, ok := s.toolIndexByID[callID]
	if !ok {
		return
	}
	s.toolArgsByID[callID] = input
	item := &s.timeline[idx].Item
	item.Detail = sdk.BuildToolCallDetail(item.Name, input, nil)
	s.addToolFrameLocked(idx)
}

func (s *ClaudeSession) addToolFrameLocked(idx int) {
	s.ensureStreamLocked()
	item := s.timeline[idx].Item
	visible := item
	s.frames.AddToolCall(idx, item, s.activeTurnID, &visible)
}

func (s *ClaudeSession) flushFramesLocked() []map[string]any {
	if s.frames == nil {
		return nil
	}
	frames := s.frames.Take()
	events := make([]map[string]any, 0, len(frames))
	for _, frame := range frames {
		if frame.Row < 0 || frame.Row >= len(s.timeline) {
			continue
		}
		s.sealClaudeTimelineEntryLocked(frame.Row)
		entry := &s.timeline[frame.Row]
		item := frame.Item
		if frame.Kind != "text" {
			entry.Item = item
		}
		events = append(events, map[string]any{
			"type": "byspace_stream_timeline", "seq": s.streamSeq,
			"turnId": frame.TurnID, "item": item,
		})
	}
	return events
}

func (s *ClaudeSession) flushFramesOnTimer() {
	s.mu.Lock()
	events := s.flushFramesLocked()
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

func claudeStreamNeedsTrailingFrame(ev map[string]any) bool {
	if ev["type"] != "stream_event" {
		return true
	}
	event, _ := ev["event"].(map[string]any)
	return event["type"] != "content_block_delta" && event["type"] != "content_block_start"
}
