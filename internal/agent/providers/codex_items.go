package providers

import (
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func codexTextBlocks(value any) string {
	switch content := value.(type) {
	case string:
		return content
	case []any:
		parts := make([]string, 0, len(content))
		for _, raw := range content {
			if text, ok := raw.(string); ok {
				parts = append(parts, text)
				continue
			}
			block, _ := raw.(map[string]any)
			for _, key := range []string{"text", "summary", "content"} {
				if text, _ := block[key].(string); text != "" {
					parts = append(parts, text)
					break
				}
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func codexItemText(item map[string]any) string {
	for _, key := range []string{"text", "content", "summary", "aggregatedOutput"} {
		if text := codexTextBlocks(item[key]); text != "" {
			return text
		}
	}
	return ""
}

func normalizeCodexItemType(itemType string) string {
	switch strings.ToLower(itemType) {
	case "usermessage":
		return "userMessage"
	case "agentmessage":
		return "agentMessage"
	case "collabagenttoolcall":
		return "collabAgentToolCall"
	case "subagentactivity":
		return "subAgentActivity"
	case "commandexecution":
		return "commandExecution"
	case "filechange":
		return "fileChange"
	case "mcptoolcall":
		return "mcpToolCall"
	case "websearch":
		return "webSearch"
	case "imagegeneration":
		return "imageGeneration"
	case "imageview":
		return "imageView"
	case "plan":
		return "plan"
	case "reasoning":
		return "reasoning"
	default:
		return itemType
	}
}

func (s *CodexSession) startCodexItemLocked(item map[string]any) []map[string]any {
	itemType, _ := item["type"].(string)
	itemType = normalizeCodexItemType(itemType)
	itemID, _ := item["id"].(string)
	if itemType == "userMessage" {
		clientID, _ := item["clientUserMessageId"].(string)
		if clientID == "" {
			clientID, _ = item["clientId"].(string)
		}
		text := codexItemText(item)
		for index := len(s.timeline) - 1; index >= 0; index-- {
			entry := &s.timeline[index]
			if entry.Item.Type != "user_message" {
				continue
			}
			if itemID != "" && entry.Item.MessageID == itemID {
				return nil
			}
			if clientID != "" && entry.Item.ClientMessageID == clientID {
				entry.Item.MessageID = itemID
				return nil
			}
		}
		// Current app-server omits clientId even when turn/start carried one. Reconcile only
		// the local row appended for the active prompt; equal text in older/native turns is a
		// separate message, not proof that this item belongs to that row.
		if clientID == "" && s.pendingUserLocal && s.pendingUserText == text &&
			s.pendingUserIndex >= 0 && s.pendingUserIndex < len(s.timeline) {
			entry := &s.timeline[s.pendingUserIndex]
			if entry.Item.Type == "user_message" && entry.Item.Text == text {
				entry.Item.MessageID = itemID
				s.pendingUserLocal = false
				return nil
			}
		}
		index := s.appendItemLocked(sdk.TimelineItem{Type: "user_message", Text: text, MessageID: itemID, ClientMessageID: clientID})
		s.timeline[index].Seq = s.streamSeq
		s.timeline[index].SeqEnd = s.streamSeq
		s.streamSeq++
		return []map[string]any{{"type": "timeline_appended", "item": s.timeline[index].Item}}
	}
	if itemType == "collabAgentToolCall" {
		s.discoverCodexSubagentsLocked(item)
	}
	if itemType == "subAgentActivity" {
		s.discoverCodexSubagentActivityLocked(item)
	}
	name, input := codexToolProjection(item)
	if name == "" {
		return nil
	}
	status := "running"
	if itemType == "plan" {
		status = "completed"
		s.latestPlanText = codexItemText(item)
	}
	index := s.appendItemLocked(sdk.TimelineItem{Type: "tool_call", CallID: itemID, Name: name, Status: status, Detail: sdk.BuildToolCallDetail(name, input, nil)})
	if itemID != "" {
		s.toolIndexByID[itemID] = index
	}
	events := []map[string]any{}
	if s.frames.AddToolCall(index, s.timeline[index].Item, s.activeTurnID, nil) {
		events = append(events, s.flushFramesLocked()...)
	}
	if status == "running" {
		events = append(events, map[string]any{"type": "tool_execution_start", "toolCallId": itemID, "toolName": name})
	}
	if descriptors := s.codexSubagentEventsLocked(); len(descriptors) > 0 {
		events = append(events, descriptors...)
	}
	return events
}

func codexToolProjection(item map[string]any) (string, map[string]any) {
	itemType, _ := item["type"].(string)
	itemType = normalizeCodexItemType(itemType)
	switch itemType {
	case "commandExecution":
		return "bash", map[string]any{"command": item["command"]}
	case "fileChange":
		return "apply_patch", map[string]any{"changes": item["changes"]}
	case "mcpToolCall":
		server, _ := item["server"].(string)
		tool, _ := item["tool"].(string)
		name := tool
		if server != "" {
			name = server + "." + tool
		}
		return name, map[string]any{"arguments": item["arguments"]}
	case "webSearch":
		return "web_search", map[string]any{"query": item["query"]}
	case "imageGeneration":
		return "image_generation", map[string]any{"prompt": item["revisedPrompt"]}
	case "collabAgentToolCall":
		return "Sub-agent", map[string]any{"tool": item["tool"], "prompt": item["prompt"]}
	case "plan":
		return "plan", map[string]any{"text": codexItemText(item)}
	}
	return "", nil
}

func (s *CodexSession) completeCodexItemLocked(item map[string]any) []map[string]any {
	itemType, _ := item["type"].(string)
	itemType = normalizeCodexItemType(itemType)
	itemID, _ := item["id"].(string)
	if itemType == "userMessage" {
		return s.startCodexItemLocked(item)
	}
	if itemType == "subAgentActivity" {
		s.discoverCodexSubagentActivityLocked(item)
		return s.codexSubagentEventsLocked()
	}
	if itemType == "agentMessage" || itemType == "reasoning" {
		return s.completeCodexOutputLocked(itemType, itemID, codexItemText(item))
	}
	if itemType == "imageView" {
		path, _ := item["path"].(string)
		return s.appendCodexImageLocked(path)
	}
	if itemType == "imageGeneration" {
		failure, _ := item["error"].(string)
		if failure == "" {
			failure, _ = item["failure"].(string)
		}
		if failure == "" {
			path, _ := item["savedPath"].(string)
			if path == "" {
				path, _ = item["saved_path"].(string)
			}
			if path == "" {
				path, _ = item["result"].(string)
			}
			if path != "" {
				return s.appendCodexImageLocked(path)
			}
			if status, _ := item["status"].(string); status != "failed" {
				return nil
			}
		}
	}
	if itemType == "plan" {
		// Codex 0.171 emits a final Plan item without a preceding item/started.
		s.latestPlanText = codexItemText(item)
	}
	name, input := codexToolProjection(item)
	if name == "" {
		return nil
	}
	output := any(codexItemText(item))
	switch itemType {
	case "commandExecution":
		output = item["aggregatedOutput"]
	case "fileChange":
		output = item["changes"]
	case "mcpToolCall":
		output = item["result"]
	case "webSearch":
		output = item["action"]
	}
	status := "completed"
	if errText, _ := item["error"].(string); errText != "" {
		status = "failed"
	}
	index, exists := s.toolIndexByID[itemID]
	if !exists {
		index = s.appendItemLocked(sdk.TimelineItem{Type: "tool_call", CallID: itemID, Name: name, Detail: sdk.BuildToolCallDetail(name, input, nil)})
		s.toolIndexByID[itemID] = index
	}
	visible := s.sentItemLocked(index)
	s.timeline[index].Item.Name = name
	s.timeline[index].Item.Status = status
	s.timeline[index].Item.Detail = sdk.BuildToolCallDetail(name, input, output)
	if status == "failed" {
		message := codexItemText(item)
		s.timeline[index].Item.Error = &message
	}
	events := []map[string]any{}
	s.frames.AddToolCall(index, s.timeline[index].Item, s.activeTurnID, visible)
	events = append(events, s.flushFramesLocked()...)
	events = append(events, map[string]any{"type": "tool_execution_end", "toolCallId": itemID})
	if itemType == "mcpToolCall" {
		events = append(events, s.codexToolImagesLocked(output)...)
	}
	return events
}

func reconcileCodexOutputText(previous, final string) (canonical, delta string) {
	if strings.HasPrefix(final, previous) {
		return final, strings.TrimPrefix(final, previous)
	}
	// The completed native item is authoritative when a delta was lost or revised. Do not
	// append the whole final snapshot to divergent text and call that a correction.
	return final, ""
}

func (s *CodexSession) completeCodexOutputLocked(itemType, itemID, text string) []map[string]any {
	kind := "assistant_message"
	index := &s.activeTextIdx
	if itemType == "reasoning" {
		kind = "reasoning"
		index = &s.activeThinkIdx
	}
	if *index >= 0 && *index < len(s.timeline) {
		entry := s.timeline[*index].Item
		if entry.Type != kind || (itemID != "" && entry.MessageID != "" && entry.MessageID != itemID) {
			*index = -1
		}
	}
	if (*index < 0 || *index >= len(s.timeline)) && itemID != "" {
		for candidate := len(s.timeline) - 1; candidate >= 0; candidate-- {
			if s.timeline[candidate].Item.Type == kind && s.timeline[candidate].Item.MessageID == itemID {
				*index = candidate
				break
			}
		}
	}
	if *index < 0 || *index >= len(s.timeline) {
		*index = s.appendItemLocked(sdk.TimelineItem{Type: kind, MessageID: itemID})
	}
	entry := &s.timeline[*index]
	entry.Item.MessageID = itemID
	previous := entry.Item.Text
	canonical, delta := reconcileCodexOutputText(previous, text)
	entry.Item.Text = canonical
	if delta != "" {
		s.frames.AddText(*index, sdk.TimelineItem{Type: kind, Text: delta}, s.activeTurnID)
	}
	events := s.flushFramesLocked()
	if delta == "" && canonical != previous {
		s.streamSeq++
		entry.SeqEnd = s.streamSeq
		if entry.Seq == 0 {
			entry.Seq = s.streamSeq
		}
		events = append(events, map[string]any{"type": "byspace_stream_timeline", "seq": s.streamSeq, "turnId": s.activeTurnID, "item": entry.Item, "replace": true})
	}
	*index = -1
	if itemType == "agentMessage" {
		events = append(events, map[string]any{"type": "message_end"})
	}
	return events
}

func (s *CodexSession) appendCodexImageLocked(path string) []map[string]any {
	if path == "" {
		return nil
	}
	if !strings.HasPrefix(path, "data:") && !strings.HasPrefix(path, "http:") && !strings.HasPrefix(path, "https:") {
		path = filepath.ToSlash(path)
	}
	index := s.appendItemLocked(sdk.TimelineItem{Type: "assistant_message", Text: "![](" + path + ")"})
	s.timeline[index].Seq = s.streamSeq
	s.timeline[index].SeqEnd = s.streamSeq
	s.streamSeq++
	return []map[string]any{{"type": "timeline_appended", "item": s.timeline[index].Item}}
}

func (s *CodexSession) codexToolImagesLocked(output any) []map[string]any {
	var events []map[string]any
	var visit func(any)
	visit = func(value any) {
		switch current := value.(type) {
		case []any:
			for _, child := range current {
				visit(child)
			}
		case map[string]any:
			if current["type"] == "image" {
				if data, _ := current["data"].(string); data != "" {
					events = append(events, s.appendCodexImageLocked("data:image/png;base64,"+data)...)
				}
			}
			for _, child := range current {
				visit(child)
			}
		}
	}
	visit(output)
	return events
}

func (s *CodexSession) appendCodexToolDeltaLocked(params map[string]any, legacy bool) []map[string]any {
	itemID, _ := params["itemId"].(string)
	delta, _ := params["delta"].(string)
	if delta == "" {
		delta, _ = params["chunk"].(string)
	}
	if legacy {
		if decoded, err := base64.StdEncoding.DecodeString(delta); err == nil {
			delta = string(decoded)
		}
	}
	index, ok := s.toolIndexByID[itemID]
	if !ok || delta == "" {
		return nil
	}
	name := s.timeline[index].Item.Name
	input := map[string]any{}
	output := codexItemText(map[string]any{"text": s.timeline[index].Item.Text}) + delta
	s.timeline[index].Item.Text += delta
	s.timeline[index].Item.Detail = sdk.BuildToolCallDetail(name, input, output)
	visible := s.sentItemLocked(index)
	s.frames.AddToolCall(index, s.timeline[index].Item, s.activeTurnID, visible)
	return s.flushFramesLocked()
}

func (s *CodexSession) discoverCodexSubagentsLocked(item map[string]any) {
	receivers, _ := item["receiverThreadIds"].([]any)
	callID, _ := item["id"].(string)
	prompt, _ := item["prompt"].(string)
	for _, raw := range receivers {
		id, _ := raw.(string)
		if id == "" {
			continue
		}
		title := "Sub-agent"
		now := time.Now().UTC().Format(time.RFC3339Nano)
		s.subagents[id] = sdk.SubagentDescriptor{ID: id, Provider: "codex", Title: &title, Description: &prompt, ToolCallID: &callID, Status: "running", CreatedAt: now, UpdatedAt: now}
		if prompt != "" && len(s.subagentTimelines[id]) == 0 {
			s.subagentTimelines[id] = []sdk.TimelineEntry{{Timestamp: now, Item: sdk.TimelineItem{Type: "user_message", Text: prompt}}}
		}
	}
}

func (s *CodexSession) discoverCodexSubagentActivityLocked(item map[string]any) {
	id, _ := item["agentThreadId"].(string)
	if id == "" {
		return
	}
	descriptor := s.subagents[id]
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if descriptor.ID == "" {
		title := "Sub-agent"
		descriptor = sdk.SubagentDescriptor{ID: id, Provider: "codex", Title: &title, CreatedAt: now}
	}
	if path, _ := item["agentPath"].(string); path != "" {
		title := humanizeCodexAgentPath(path)
		if title != "" {
			descriptor.Title = &title
		}
	}
	descriptor.UpdatedAt = now
	switch item["kind"] {
	case "started", "interacted":
		descriptor.Status = "running"
	case "interrupted":
		descriptor.Status = "canceled"
	}
	s.subagents[id] = descriptor
}

func humanizeCodexAgentPath(path string) string {
	native := path
	if native == "/root" {
		return ""
	}
	if strings.HasPrefix(native, "/root/") {
		native = strings.TrimPrefix(native, "/root/")
	} else if strings.ContainsAny(native, `/\\`) {
		native = filepath.Base(native)
	}
	segments := strings.Split(native, "/")
	for index, segment := range segments {
		segment = strings.TrimSpace(strings.NewReplacer("_", " ", "-", " ").Replace(segment))
		if segment == "" {
			continue
		}
		segments[index] = strings.ToUpper(segment[:1]) + segment[1:]
	}
	return strings.Join(segments, " / ")
}

func (s *CodexSession) codexSubagentEventsLocked() []map[string]any {
	events := make([]map[string]any, 0, len(s.subagents))
	for _, descriptor := range s.subagents {
		events = append(events, map[string]any{"type": "subagent_upsert", "subagent": descriptor})
	}
	return events
}

func (s *CodexSession) routeCodexSubagentLocked(method string, params map[string]any) bool {
	threadID, _ := params["threadId"].(string)
	descriptor, ok := s.subagents[threadID]
	if !ok || threadID == s.threadID {
		return false
	}
	entries := s.subagentTimelines[threadID]
	appendItem := func(item sdk.TimelineItem) {
		seq := len(entries)
		entries = append(entries, sdk.TimelineEntry{Seq: seq, SeqEnd: seq, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Item: item})
	}
	if method == "turn/completed" {
		status := codexNativeTurnStatus(params)
		descriptor.Status = "completed"
		if status == "failed" {
			descriptor.Status = "failed"
		} else if status == "interrupted" {
			descriptor.Status = "canceled"
		}
		descriptor.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		s.subagents[threadID] = descriptor
	} else if method == "item/agentMessage/delta" || method == "item/reasoning/summaryTextDelta" {
		kind := "assistant_message"
		if method == "item/reasoning/summaryTextDelta" {
			kind = "reasoning"
		}
		delta, _ := params["delta"].(string)
		itemID, _ := params["itemId"].(string)
		if itemID == "" {
			itemID, _ = params["id"].(string)
		}
		index := -1
		if s.subagentOutputIdx == nil {
			s.subagentOutputIdx = make(map[string]int)
		}
		key := threadID + "\x00" + itemID + "\x00" + kind
		if itemID != "" {
			if candidate, ok := s.subagentOutputIdx[key]; ok && candidate >= 0 && candidate < len(entries) {
				index = candidate
			}
		}
		if index < 0 && len(entries) > 0 && entries[len(entries)-1].Item.Type == kind {
			last := entries[len(entries)-1].Item
			if last.MessageID == "" || last.MessageID == itemID {
				index = len(entries) - 1
			}
		}
		if index >= 0 {
			entries[index].Item.MessageID = itemID
			entries[index].Item.Text += delta
		} else {
			appendItem(sdk.TimelineItem{Type: kind, Text: delta, MessageID: itemID})
			index = len(entries) - 1
		}
		if itemID != "" {
			s.subagentOutputIdx[key] = index
		}
	} else if method == "item/started" || method == "item/completed" {
		item, _ := params["item"].(map[string]any)
		name, input := codexToolProjection(item)
		if name != "" {
			status := "running"
			if method == "item/completed" {
				status = "completed"
			}
			callID, _ := item["id"].(string)
			found := -1
			for index := range entries {
				if entries[index].Item.CallID == callID {
					found = index
					break
				}
			}
			if found < 0 {
				appendItem(sdk.TimelineItem{Type: "tool_call", CallID: callID, Name: name, Status: status, Detail: sdk.BuildToolCallDetail(name, input, codexItemText(item))})
			} else {
				entries[found].Item.Status = status
				entries[found].Item.Detail = sdk.BuildToolCallDetail(name, input, codexItemText(item))
			}
		} else if itemType, _ := item["type"].(string); itemType == "userMessage" {
			text := codexItemText(item)
			if text != "" {
				found := false
				for _, entry := range entries {
					if entry.Item.Type == "user_message" && entry.Item.Text == text {
						found = true
						break
					}
				}
				if !found {
					appendItem(sdk.TimelineItem{Type: "user_message", Text: text})
				}
			}
		} else if itemType, _ := item["type"].(string); normalizeCodexItemType(itemType) == "agentMessage" || normalizeCodexItemType(itemType) == "reasoning" {
			kind := "assistant_message"
			if normalizeCodexItemType(itemType) == "reasoning" {
				kind = "reasoning"
			}
			itemID, _ := item["id"].(string)
			text := codexItemText(item)
			index := -1
			key := threadID + "\x00" + itemID + "\x00" + kind
			if itemID != "" {
				if candidate, ok := s.subagentOutputIdx[key]; ok && candidate >= 0 && candidate < len(entries) {
					index = candidate
				}
			}
			if index >= 0 {
				canonical, _ := reconcileCodexOutputText(entries[index].Item.Text, text)
				entries[index].Item.Text = canonical
				entries[index].Item.MessageID = itemID
			} else {
				appendItem(sdk.TimelineItem{Type: kind, Text: text, MessageID: itemID})
				index = len(entries) - 1
			}
			if itemID != "" {
				if s.subagentOutputIdx == nil {
					s.subagentOutputIdx = make(map[string]int)
				}
				s.subagentOutputIdx[key] = index
			}
		}
	}
	s.subagentTimelines[threadID] = entries
	return true
}

func (s *CodexSession) nativeCompactionLocked(status string, trigger string) []map[string]any {
	for index := len(s.timeline) - 1; index >= 0; index-- {
		if s.timeline[index].Item.Type != "compaction" {
			continue
		}
		if status == "completed" && s.timeline[index].Item.Status == "loading" {
			s.timeline[index].Item.Status = "completed"
			return []map[string]any{{"type": "timeline_updated", "item": s.timeline[index].Item}}
		}
		if status == "loading" {
			return nil
		}
		break
	}
	index := s.appendItemLocked(sdk.TimelineItem{Type: "compaction", Status: status, Trigger: trigger})
	s.timeline[index].Seq = s.streamSeq
	s.timeline[index].SeqEnd = s.streamSeq
	s.streamSeq++
	return []map[string]any{{"type": "timeline_appended", "item": s.timeline[index].Item}}
}

func codexWarningKey(message string) string { return fmt.Sprintf("codex-warning:%s", message) }
