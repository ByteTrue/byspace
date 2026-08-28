package daemon

import (
	"encoding/json"
	"path/filepath"
	"slices"
	"time"

	"byspace/internal/agent"
	"byspace/internal/protocol"
)

func agentSnapshotPayload(snapshot agent.Snapshot) map[string]any {
	labels := snapshot.Labels
	if labels == nil {
		labels = map[string]string{}
	}
	var lastUserMessageAt any
	if !snapshot.LastUserMessageAt.IsZero() {
		lastUserMessageAt = formatTime(snapshot.LastUserMessageAt)
	}
	payload := map[string]any{
		"id":                  snapshot.ID,
		"provider":            snapshot.Provider,
		"cwd":                 snapshot.CWD,
		"model":               optionalString(snapshot.RuntimeInfo.Model),
		"thinkingOptionId":    optionalString(snapshot.RuntimeInfo.ThinkingOptionID),
		"createdAt":           formatTime(snapshot.CreatedAt),
		"updatedAt":           formatTime(snapshot.UpdatedAt),
		"lastUserMessageAt":   lastUserMessageAt,
		"status":              snapshot.Lifecycle,
		"capabilities":        capabilitiesPayload(snapshot.Capabilities),
		"currentModeId":       optionalString(snapshot.RuntimeInfo.ModeID),
		"availableModes":      []any{},
		"pendingPermissions":  []any{},
		"persistence":         persistencePayload(snapshot.Persistence),
		"runtimeInfo":         runtimeInfoPayload(snapshot.RuntimeInfo),
		"title":               optionalString(snapshot.Title),
		"labels":              labels,
		"requiresAttention":   false,
		"providerUnavailable": false,
	}
	if snapshot.WorkspaceID != "" {
		payload["workspaceId"] = snapshot.WorkspaceID
	}
	if snapshot.ActiveTurnID != "" {
		payload["activeTurn"] = map[string]any{
			"turnId":    snapshot.ActiveTurnID,
			"startedAt": nil,
		}
	} else {
		payload["activeTurn"] = nil
	}
	if snapshot.LastError != "" {
		payload["lastError"] = snapshot.LastError
	}
	return payload
}

func capabilitiesPayload(capabilities agent.Capabilities) map[string]bool {
	return map[string]bool{
		"supportsStreaming":          capabilities.SupportsStreaming,
		"supportsSessionPersistence": capabilities.SupportsSessionPersistence,
		"supportsDynamicModes":       capabilities.SupportsDynamicModes,
		"supportsMcpServers":         capabilities.SupportsMCPServers,
		"supportsReasoningStream":    capabilities.SupportsReasoningStream,
		"supportsToolInvocations":    capabilities.SupportsToolInvocations,
	}
}

func persistencePayload(handle *agent.PersistenceHandle) any {
	if handle == nil {
		return nil
	}
	payload := map[string]any{
		"provider":  handle.Provider,
		"sessionId": handle.SessionID,
	}
	if handle.NativeHandle != "" {
		payload["nativeHandle"] = handle.NativeHandle
	}
	return payload
}

func runtimeInfoPayload(info agent.RuntimeInfo) map[string]any {
	return map[string]any{
		"provider":         info.Provider,
		"sessionId":        optionalString(info.SessionID),
		"model":            optionalString(info.Model),
		"thinkingOptionId": optionalString(info.ThinkingOptionID),
		"modeId":           optionalString(info.ModeID),
	}
}

func directoryEntry(snapshot agent.Snapshot) map[string]any {
	projectName := filepath.Base(snapshot.CWD)
	if projectName == "." || projectName == string(filepath.Separator) {
		projectName = snapshot.CWD
	}
	return map[string]any{
		"agent": agentSnapshotPayload(snapshot),
		"project": map[string]any{
			"projectKey":    snapshot.CWD,
			"projectName":   projectName,
			"workspaceName": nil,
			"checkout": map[string]any{
				"cwd":                  snapshot.CWD,
				"isGit":                false,
				"currentBranch":        nil,
				"remoteUrl":            nil,
				"worktreeRoot":         nil,
				"isPaseoOwnedWorktree": false,
				"mainRepoRoot":         nil,
			},
		},
	}
}

func timelineItemPayload(item agent.TimelineItem) map[string]any {
	switch item.Type {
	case agent.TimelineUserMessage:
		payload := map[string]any{"type": "user_message", "text": item.Text}
		setOptional(payload, "messageId", item.MessageID)
		setOptional(payload, "clientMessageId", item.ClientMessageID)
		return payload
	case agent.TimelineAssistantMessage:
		payload := map[string]any{"type": "assistant_message", "text": item.Text}
		setOptional(payload, "messageId", item.MessageID)
		return payload
	case agent.TimelineReasoning:
		return map[string]any{"type": "reasoning", "text": item.Text}
	case agent.TimelineToolCall:
		status := item.Status
		if status == "" {
			status = "running"
		}
		var toolError any
		if status == "failed" {
			toolError = item.Error
		}
		return map[string]any{
			"type":   "tool_call",
			"callId": item.CallID,
			"name":   item.Name,
			"status": status,
			"error":  toolError,
			"detail": map[string]any{
				"type":   "unknown",
				"input":  rawJSONValue(item.Input),
				"output": rawJSONValue(item.Output),
			},
		}
	case agent.TimelineError:
		return map[string]any{"type": "error", "message": item.Error}
	default:
		return map[string]any{"type": "error", "message": "unsupported timeline item"}
	}
}

func timelineEntryPayload(provider string, row agent.TimelineRow) map[string]any {
	payload := map[string]any{
		"provider":  provider,
		"item":      timelineItemPayload(row.Item),
		"timestamp": formatTime(row.Timestamp),
		"seqStart":  row.Seq,
		"seqEnd":    row.Seq,
		"sourceSeqRanges": []map[string]uint64{{
			"startSeq": row.Seq,
			"endSeq":   row.Seq,
		}},
		"collapsed": []string{},
	}
	setOptional(payload, "turnId", row.TurnID)
	return payload
}

func streamEventPayload(event agent.Event, provider string) (map[string]any, bool) {
	if event.Type == agent.EventAgentState && event.Agent != nil {
		return map[string]any{
			"type": "agent_update",
			"payload": map[string]any{
				"kind":  "upsert",
				"agent": agentSnapshotPayload(*event.Agent),
			},
		}, true
	}
	if event.Type != agent.EventAgentStream || event.Stream == nil {
		return nil, false
	}

	stream := event.Stream
	if provider == "" {
		return nil, false
	}
	providerEvent := map[string]any{
		"type":     stream.Type,
		"provider": provider,
	}
	switch stream.Type {
	case agent.ProviderEventThreadStarted:
		providerEvent["sessionId"] = stream.SessionID
	case agent.ProviderEventTurnStarted, agent.ProviderEventTurnCompleted:
		setOptional(providerEvent, "turnId", stream.TurnID)
	case agent.ProviderEventTurnFailed:
		setOptional(providerEvent, "turnId", stream.TurnID)
		providerEvent["error"] = stream.Error
	case agent.ProviderEventTurnCanceled:
		setOptional(providerEvent, "turnId", stream.TurnID)
		providerEvent["reason"] = valueOr(stream.Error, "canceled")
	case agent.ProviderEventTimeline:
		setOptional(providerEvent, "turnId", stream.TurnID)
		providerEvent["item"] = timelineItemPayload(stream.Item)
	case agent.ProviderEventProcessExited:
		return nil, false
	default:
		return nil, false
	}

	timestamp := time.Now().UTC()
	payload := map[string]any{
		"agentId":   event.AgentID,
		"event":     providerEvent,
		"timestamp": formatTime(timestamp),
	}
	if event.Row != nil {
		payload["timestamp"] = formatTime(event.Row.Timestamp)
		payload["seq"] = event.Row.Seq
		payload["epoch"] = event.Epoch
	}
	return map[string]any{"type": "agent_stream", "payload": payload}, true
}

func timelineResponsePayload(request protocol.FetchAgentTimelineRequest, snapshot agent.Snapshot, timeline agent.TimelineSnapshot) map[string]any {
	direction := valueOrPointer(request.Direction, "tail")
	projection := valueOrPointer(request.Projection, "canonical")
	stale := request.Cursor != nil && request.Cursor.Epoch != timeline.Epoch
	selectionDirection := direction
	if stale {
		selectionDirection = "tail"
	}

	rows := slices.Clone(timeline.Rows)
	eligible := make([]agent.TimelineRow, 0, len(rows))
	for _, row := range rows {
		switch selectionDirection {
		case "before":
			if request.Cursor != nil && row.Seq < uint64(request.Cursor.Seq) {
				eligible = append(eligible, row)
			}
		case "after":
			if request.Cursor != nil && row.Seq > uint64(request.Cursor.Seq) {
				eligible = append(eligible, row)
			}
		default:
			eligible = append(eligible, row)
		}
	}

	limit := 200
	if request.Limit != nil {
		limit = *request.Limit
	}
	selected := eligible
	if limit > 0 && len(selected) > limit {
		if selectionDirection == "after" {
			selected = selected[:limit]
		} else {
			selected = selected[len(selected)-limit:]
		}
	}

	entries := make([]map[string]any, 0, len(selected))
	for _, row := range selected {
		entries = append(entries, timelineEntryPayload(snapshot.Provider, row))
	}

	head := uint64(0)
	if len(rows) > 0 {
		head = rows[len(rows)-1].Seq
	}
	payload := map[string]any{
		"requestId":   request.RequestID,
		"agentId":     request.AgentID,
		"agent":       agentSnapshotPayload(snapshot),
		"direction":   direction,
		"projection":  projection,
		"epoch":       timeline.Epoch,
		"reset":       stale,
		"staleCursor": stale,
		"gap":         false,
		"window": map[string]uint64{
			"minSeq":  firstSeq(rows),
			"maxSeq":  head,
			"nextSeq": head + 1,
		},
		"startCursor": cursorPayload(timeline.Epoch, firstSeq(selected)),
		"endCursor":   cursorPayload(timeline.Epoch, lastSeq(selected)),
		"hasOlder":    hasOlder(rows, selected),
		"hasNewer":    hasNewer(rows, selected),
		"entries":     entries,
		"error":       nil,
	}
	if request.MergeWindow != nil {
		payload["mergeWindow"] = *request.MergeWindow
	}
	return payload
}

func firstSeq(rows []agent.TimelineRow) uint64 {
	if len(rows) == 0 {
		return 0
	}
	return rows[0].Seq
}

func lastSeq(rows []agent.TimelineRow) uint64 {
	if len(rows) == 0 {
		return 0
	}
	return rows[len(rows)-1].Seq
}

func cursorPayload(epoch string, seq uint64) any {
	if seq == 0 {
		return nil
	}
	return map[string]any{"epoch": epoch, "seq": seq}
}

func hasOlder(all, selected []agent.TimelineRow) bool {
	return len(selected) > 0 && len(all) > 0 && selected[0].Seq > all[0].Seq
}

func hasNewer(all, selected []agent.TimelineRow) bool {
	return len(selected) > 0 && len(all) > 0 && selected[len(selected)-1].Seq < all[len(all)-1].Seq
}

func optionalString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func setOptional(payload map[string]any, key, value string) {
	if value != "" {
		payload[key] = value
	}
}

func rawCollectionNotEmpty(value json.RawMessage) bool {
	if len(value) == 0 {
		return false
	}
	var entries []json.RawMessage
	return json.Unmarshal(value, &entries) != nil || len(entries) > 0
}

func rawValueHasContent(value json.RawMessage) bool {
	if len(value) == 0 {
		return false
	}
	var decoded any
	if json.Unmarshal(value, &decoded) != nil {
		return true
	}
	switch typed := decoded.(type) {
	case nil:
		return false
	case []any:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	default:
		return true
	}
}

func rawJSONValue(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	var decoded any
	if json.Unmarshal(value, &decoded) != nil {
		return nil
	}
	return decoded
}

func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func valueOrPointer(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}
