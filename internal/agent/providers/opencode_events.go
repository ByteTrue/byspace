package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func (s *OpenCodeSession) startEventStream() {
	s.mu.Lock()
	if s.eventCancel != nil || s.closed {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.eventCancel = cancel
	s.mu.Unlock()
	go s.consumeOpenCodeEvents(ctx)
}

func (s *OpenCodeSession) consumeOpenCodeEvents(ctx context.Context) {
	client := s.streamHTTPClient
	if client == nil {
		client = s.httpClient
	}
	backoff := 100 * time.Millisecond
	for ctx.Err() == nil {
		path := "/global/event"
		if s.version == 2 {
			path = "/api/event"
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+path, nil)
		if err == nil {
			var resp *http.Response
			resp, err = client.Do(req)
			if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
				records, streamErr := readOpenCodeStream(ctx, resp.Body, 5*time.Second, 30*time.Second, s.handleOpenCodeEvent)
				_ = resp.Body.Close()
				if streamErr == nil && records > 0 {
					backoff = 100 * time.Millisecond
				} else {
					backoff *= 2
				}
			} else {
				if resp != nil {
					_ = resp.Body.Close()
				}
				backoff *= 2
			}
		}
		s.repairOpenCodeTurn(ctx)
		if backoff > 5*time.Second {
			backoff = 5 * time.Second
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func openCodeString(value any) string {
	text, _ := value.(string)
	return text
}

func openCodeModelParts(provider, model string) (string, string) {
	if provider == "" {
		if prefix, id, ok := strings.Cut(model, "/"); ok {
			provider, model = prefix, id
		}
	}
	if provider == "" {
		provider = "opencode"
	}
	return provider, model
}

func (s *OpenCodeSession) handleOpenCodeEvent(envelope map[string]any) {
	event := envelope
	if payload, ok := envelope["payload"].(map[string]any); ok {
		event = payload
	}
	properties, _ := event["properties"].(map[string]any)
	if properties == nil {
		properties, _ = event["data"].(map[string]any)
	}
	if properties == nil {
		properties = map[string]any{}
	}
	typeName := openCodeString(event["type"])
	s.mu.Lock()
	s.eventTimelineIndex = -1
	sid := s.sessionID
	if eventSession := openCodeString(properties["sessionID"]); eventSession != "" && eventSession != sid {
		s.mu.Unlock()
		return
	}
	switch typeName {
	case "session.text.delta", "session.reasoning.delta":
		messageID := openCodeString(properties["assistantMessageID"])
		partID := fmt.Sprintf("%s:text:%v", messageID, properties["ordinal"])
		kind := "assistant_message"
		if strings.HasPrefix(typeName, "session.reasoning.") {
			partID = fmt.Sprintf("%s:reasoning:%v", messageID, properties["ordinal"])
			kind = "reasoning"
		}
		s.appendOpenCodeTextLocked(partID, messageID, kind, openCodeString(properties["delta"]), false)
	case "session.text.ended", "session.reasoning.ended":
		messageID := openCodeString(properties["assistantMessageID"])
		partID := fmt.Sprintf("%s:text:%v", messageID, properties["ordinal"])
		kind := "assistant_message"
		if strings.HasPrefix(typeName, "session.reasoning.") {
			partID = fmt.Sprintf("%s:reasoning:%v", messageID, properties["ordinal"])
			kind = "reasoning"
		}
		full := openCodeString(properties["text"])
		emitted := s.materializedText[partID]
		if strings.HasPrefix(full, emitted) {
			s.appendOpenCodeTextLocked(partID, messageID, kind, strings.TrimPrefix(full, emitted), true)
		} else {
			s.replaceOpenCodeTextLocked(partID, messageID, kind, full)
		}
	case "session.usage.updated", "session.step.ended":
		s.applyOpenCodeStepUsageLocked(properties)
	case "message.updated":
		info, _ := properties["info"].(map[string]any)
		if openCodeString(info["sessionID"]) != sid {
			s.mu.Unlock()
			return
		}
		s.messageRoles[openCodeString(info["id"])] = openCodeString(info["role"])
		s.mu.Unlock()
		return
	case "message.part.delta":
		partID := openCodeString(properties["partID"])
		messageID := openCodeString(properties["messageID"])
		if s.messageRoles[messageID] == "user" || s.closedParts[partID] {
			s.mu.Unlock()
			return
		}
		delta := openCodeString(properties["delta"])
		kind := "assistant_message"
		if openCodeString(properties["field"]) == "reasoning" || s.partTypes[partID] == "reasoning" {
			kind = "reasoning"
		}
		s.appendOpenCodeTextLocked(partID, messageID, kind, delta, false)
	case "message.part.updated":
		part, _ := properties["part"].(map[string]any)
		if openCodeString(part["sessionID"]) != sid {
			s.mu.Unlock()
			return
		}
		partID := openCodeString(part["id"])
		messageID := openCodeString(part["messageID"])
		partType := openCodeString(part["type"])
		s.partTypes[partID] = partType
		switch partType {
		case "text", "reasoning":
			timeMap, _ := part["time"].(map[string]any)
			if _, ended := timeMap["end"]; !ended || s.closedParts[partID] || s.messageRoles[messageID] == "user" {
				s.mu.Unlock()
				return
			}
			full := openCodeString(part["text"])
			emitted := s.materializedText[partID]
			if strings.HasPrefix(full, emitted) {
				s.appendOpenCodeTextLocked(partID, messageID, partType, strings.TrimPrefix(full, emitted), true)
			} else {
				s.replaceOpenCodeTextLocked(partID, messageID, partType, full)
			}
		case "tool":
			s.upsertOpenCodeToolLocked(part)
		case "step-finish":
			s.applyOpenCodeStepUsageLocked(part)
		}
	case "permission.asked":
		request := s.addOpenCodePermissionLocked(properties)
		subs := s.copyOpenCodeSubscribersLocked()
		s.mu.Unlock()
		for _, fn := range subs {
			fn(map[string]any{"type": "permission_requested", "request": request})
		}
		return
	case "session.idle":
		s.partTypes = make(map[string]string)
		turnID := s.activeTurnID
		s.mu.Unlock()
		s.settleOpenCodeIdleTurn(turnID)
		return
	case "session.status":
		status, _ := properties["status"].(map[string]any)
		if openCodeString(status["type"]) == "idle" {
			s.partTypes = make(map[string]string)
			turnID := s.activeTurnID
			s.mu.Unlock()
			s.settleOpenCodeIdleTurn(turnID)
			return
		}
	case "question.asked":
		if request := s.addOpenCodeQuestionLocked(properties); request != nil {
			subs := s.copyOpenCodeSubscribersLocked()
			s.mu.Unlock()
			for _, fn := range subs {
				fn(map[string]any{"type": "permission_requested", "request": request})
			}
			return
		}
	case "session.error":
		nativeError, _ := properties["error"].(map[string]any)
		data, _ := nativeError["data"].(map[string]any)
		message := openCodeString(data["message"])
		if message == "" {
			encoded, _ := json.Marshal(nativeError)
			message = string(encoded)
		}
		aborted := openCodeString(nativeError["name"]) == "MessageAbortedError"
		s.mu.Unlock()
		if aborted {
			s.finishOpenCodeTurn(nil, true)
		} else {
			s.finishOpenCodeTurn(fmt.Errorf("%s", message), false)
		}
		return
	case "session.execution.succeeded":
		s.mu.Unlock()
		s.finishOpenCodeTurn(nil, false)
		return
	case "session.execution.interrupted":
		s.mu.Unlock()
		s.finishOpenCodeTurn(nil, true)
		return
	case "session.execution.failed":
		data, _ := event["data"].(map[string]any)
		nativeError, _ := data["error"].(map[string]any)
		message := openCodeString(nativeError["message"])
		if message == "" {
			message = "OpenCode execution failed"
		}
		s.mu.Unlock()
		s.finishOpenCodeTurn(fmt.Errorf("%s", message), false)
		return
	}
	item, seq, turnID, ok := s.lastOpenCodeTimelineEventLocked()
	subs := s.copyOpenCodeSubscribersLocked()
	s.mu.Unlock()
	if ok {
		publishOpenCodeTimeline(subs, seq, turnID, item)
	}
}

func (s *OpenCodeSession) appendOpenCodeTextLocked(partID, messageID, kind, delta string, closed bool) {
	if delta == "" && !closed {
		return
	}
	s.materializedText[partID] += delta
	if closed {
		s.closedParts[partID] = true
	}
	if delta == "" {
		return
	}
	itemKind := kind
	if itemKind == "text" {
		itemKind = "assistant_message"
	}
	for i := len(s.timeline) - 1; i >= 0; i-- {
		item := &s.timeline[i].Item
		if item.Type == itemKind && item.Metadata["opencodePartId"] == partID {
			item.Text += delta
			s.eventTimelineIndex = i
			return
		}
		if item.Type != itemKind {
			break
		}
	}
	metadata := map[string]any{"opencodePartId": partID}
	entry := sdk.TimelineEntry{Seq: len(s.timeline) + 1, TurnID: s.activeTurnID, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Item: sdk.TimelineItem{Type: itemKind, Text: delta, MessageID: messageID, Metadata: metadata}}
	s.eventTimelineIndex = len(s.timeline)
	s.timeline = append(s.timeline, entry)
}

func (s *OpenCodeSession) replaceOpenCodeTextLocked(partID, messageID, kind, full string) {
	s.materializedText[partID] = full
	s.closedParts[partID] = true
	itemKind := kind
	if itemKind == "text" {
		itemKind = "assistant_message"
	}
	for index := range s.timeline {
		item := &s.timeline[index].Item
		if item.Type == itemKind && item.Metadata["opencodePartId"] == partID {
			item.Text = full
			s.eventTimelineIndex = index
			return
		}
	}
	if full != "" {
		s.appendOpenCodeTextLocked(partID, messageID, kind, full, true)
	}
}

func openCodeToolStatus(state map[string]any) string {
	status := strings.ToLower(openCodeString(state["status"]))
	if state["error"] != nil {
		return "failed"
	}
	switch status {
	case "failed", "failure", "error", "errored", "rejected", "denied", "declined":
		return "failed"
	case "canceled", "cancelled", "interrupted", "aborted":
		return "canceled"
	case "completed", "complete", "done", "success", "succeeded":
		return "completed"
	case "":
		if state["output"] != nil {
			return "completed"
		}
	}
	return "running"
}

func (s *OpenCodeSession) upsertOpenCodeToolLocked(part map[string]any) {
	callID := openCodeString(part["callID"])
	if callID == "" {
		callID = openCodeString(part["id"])
	}
	if callID == "" {
		return
	}
	state, _ := part["state"].(map[string]any)
	input := state["input"]
	output := state["output"]
	if output == nil {
		output = state["error"]
	}
	status := openCodeToolStatus(state)
	var toolErr *string
	if text := sdk.ExtractResultText(state["error"]); text != "" {
		toolErr = &text
	}
	item := sdk.TimelineItem{Type: "tool_call", CallID: callID, Name: openCodeString(part["tool"]), Status: status, Detail: sdk.BuildToolCallDetail(openCodeString(part["tool"]), input, output), Error: toolErr}
	if index, ok := s.toolIndexByID[callID]; ok {
		s.timeline[index].Item = item
		s.eventTimelineIndex = index
		return
	}
	s.toolIndexByID[callID] = len(s.timeline)
	s.eventTimelineIndex = len(s.timeline)
	s.timeline = append(s.timeline, sdk.TimelineEntry{Seq: len(s.timeline) + 1, TurnID: s.activeTurnID, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Item: item})
}

func (s *OpenCodeSession) applyOpenCodeStepUsageLocked(part map[string]any) {
	tokens, _ := part["tokens"].(map[string]any)
	cache, _ := tokens["cache"].(map[string]any)
	number := func(value any) int {
		switch v := value.(type) {
		case float64:
			return int(v)
		case int:
			return v
		case json.Number:
			n, _ := v.Float64()
			return int(n)
		default:
			return 0
		}
	}
	usage := &sdk.AgentUsage{InputTokens: number(tokens["input"]), OutputTokens: number(tokens["output"]), CachedInputTokens: number(cache["read"]), TotalCostUSD: 0}
	used := usage.InputTokens + usage.OutputTokens + number(tokens["reasoning"]) + number(cache["read"]) + number(cache["write"])
	usage.ContextWindowUsedTokens = &used
	usage.TotalCostUSD, _ = part["cost"].(float64)
	if s.lastUsage != nil {
		usage.ContextWindowMaxTokens = s.lastUsage.ContextWindowMaxTokens
		if s.version == 1 {
			usage.TotalCostUSD += s.lastUsage.TotalCostUSD
		}
	}
	s.lastUsage = usage
}

func (s *OpenCodeSession) lastOpenCodeTimelineEventLocked() (sdk.TimelineItem, int, string, bool) {
	if len(s.timeline) == 0 {
		return sdk.TimelineItem{}, 0, "", false
	}
	if s.eventTimelineIndex < 0 || s.eventTimelineIndex >= len(s.timeline) {
		return sdk.TimelineItem{}, 0, "", false
	}
	entry := s.timeline[s.eventTimelineIndex]
	return entry.Item, entry.Seq, entry.TurnID, true
}

func publishOpenCodeTimeline(subs []func(map[string]any), seq int, turnID string, item sdk.TimelineItem) {
	for _, fn := range subs {
		fn(map[string]any{"type": "byspace_stream_timeline", "seq": seq, "turnId": turnID, "item": item})
	}
}

func (s *OpenCodeSession) dispatchOpenCodePrompt(ctx context.Context, message string, images []sdk.ImageContent, outputSchema map[string]any, delivery string) error {
	s.mu.Lock()
	sid, cwd := s.sessionID, s.cwd
	model, provider, mode, variant, system := s.model, s.modelProvider, s.modeID, s.thinking, s.systemPrompt
	s.mu.Unlock()
	body := map[string]any{}
	endpoint := ""
	if s.version == 2 {
		body["text"] = message
		if delivery == "" {
			delivery = "queue"
		}
		body["delivery"] = delivery
		files := make([]any, 0, len(images))
		for _, image := range images {
			files = append(files, map[string]any{"uri": "data:" + image.MimeType + ";base64," + image.Data})
		}
		body["files"] = files
		if outputSchema != nil {
			body["metadata"] = map[string]any{"byspaceOutputSchema": outputSchema}
		}
		endpoint = s.baseURL + "/api/session/" + url.PathEscape(sid) + "/prompt"
	} else {
		parts := []map[string]any{{"type": "text", "text": message}}
		parts = append(parts, imageBlocksForOpenCode(images)...)
		body["parts"] = parts
		body["messageID"] = fmt.Sprintf("byspace_%d", time.Now().UnixNano())
		if system != "" {
			body["system"] = system
		}
		if outputSchema != nil {
			body["format"] = map[string]any{"type": "json_schema", "schema": outputSchema}
		}
		endpoint = s.baseURL + "/session/" + url.PathEscape(sid) + "/prompt_async"
	}
	if s.version == 2 {
		if model != "" {
			provider, model = openCodeModelParts(provider, model)
			modelRef := map[string]any{"id": model, "providerID": provider}
			if variant != "" && variant != "default" {
				modelRef["variant"] = variant
			}
			if err := s.postOpenCodeV2(ctx, "/api/session/"+url.PathEscape(sid)+"/model", map[string]any{"model": modelRef}); err != nil {
				return err
			}
		}
		if mode != "" {
			if err := s.postOpenCodeV2(ctx, "/api/session/"+url.PathEscape(sid)+"/agent", map[string]any{"agent": mode}); err != nil {
				return err
			}
		}
	} else {
		if model != "" {
			provider, model = openCodeModelParts(provider, model)
			body["model"] = map[string]any{"providerID": provider, "modelID": model}
		}
		if mode != "" {
			body["agent"] = mode
		}
		if variant != "" && variant != "default" {
			body["variant"] = variant
		}
	}
	payload, _ := json.Marshal(body)
	endpoint += "?directory=" + url.QueryEscape(cwd)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("opencode prompt: %s: %s", resp.Status, strings.TrimSpace(string(message)))
	}
	return nil
}

func (s *OpenCodeSession) SubagentTimeline(_ string, subagentID string) ([]sdk.TimelineEntry, error) {
	child := &OpenCodeSession{baseURL: s.baseURL, version: s.version, httpClient: s.httpClient, sessionID: subagentID, cwd: s.cwd, activeTurnID: "native", partTypes: map[string]string{}, messageRoles: map[string]string{}, materializedText: map[string]string{}, closedParts: map[string]bool{}, toolIndexByID: map[string]int{}, pendingPermissions: map[string]map[string]any{}, eventSubscribers: map[int]func(map[string]any){}, eventTimelineIndex: -1}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := child.replayOpenCodeHistory(ctx, subagentID)
	return child.Timeline(), err
}

func readOpenCodeStream(ctx context.Context, body io.ReadCloser, firstTimeout, nextTimeout time.Duration, handle func(map[string]any)) (int, error) {
	type scanResult struct {
		line string
		ok   bool
	}
	lines := make(chan scanResult)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(body)
		scanner.Buffer(make([]byte, 4096), 4*1024*1024)
		for scanner.Scan() {
			select {
			case lines <- scanResult{line: scanner.Text(), ok: true}:
			case <-ctx.Done():
				return
			}
		}
	}()
	timer := time.NewTimer(firstTimeout)
	defer timer.Stop()
	records := 0
	for {
		select {
		case <-ctx.Done():
			return records, ctx.Err()
		case <-timer.C:
			_ = body.Close()
			return records, fmt.Errorf("opencode event stream timed out")
		case result, ok := <-lines:
			if !ok {
				return records, nil
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(nextTimeout)
			line := strings.TrimSpace(result.line)
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			var event map[string]any
			if json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &event) != nil {
				continue
			}
			records++
			handle(event)
		}
	}
}

func (s *OpenCodeSession) settleOpenCodeIdleTurn(turnID string) {
	if turnID == "" {
		return
	}
	s.mu.Lock()
	active := s.status == "running" && s.activeTurnID == turnID
	s.mu.Unlock()
	if !active {
		return
	}
	// The prompt can finish before the SSE stream observes its final parts. Native idle is
	// authoritative, so reconcile history once before exposing the completed timeline.
	var err error
	if s.baseURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err = s.replayOpenCodeHistory(ctx, s.sessionID)
	}
	s.finishOpenCodeTurnForID(turnID, err, false)
}

func (s *OpenCodeSession) repairOpenCodeTurn(ctx context.Context) {
	s.mu.Lock()
	active := s.status == "running" && s.activeTurnID != ""
	sid := s.sessionID
	expectedTurnID := s.activeTurnID
	s.mu.Unlock()
	if !active {
		return
	}
	completed, err := s.replayOpenCodeHistory(ctx, sid)
	if err == nil && completed {
		s.finishOpenCodeTurnForID(expectedTurnID, nil, false)
	}
}

func (s *OpenCodeSession) replayOpenCodeHistory(ctx context.Context, sessionID string) (bool, error) {
	s.mu.Lock()
	cwd := s.cwd
	endpoint := s.baseURL + "/session/" + url.PathEscape(sessionID) + "/message"
	if s.version == 2 {
		endpoint = s.baseURL + "/api/session/" + url.PathEscape(sessionID) + "/message"
	}
	s.mu.Unlock()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?directory="+url.QueryEscape(cwd), nil)
	if err != nil {
		return false, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, fmt.Errorf("opencode history: %s", resp.Status)
	}
	var payload any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false, err
	}
	messages, _ := payload.([]any)
	if object, _ := payload.(map[string]any); object != nil {
		messages, _ = object["data"].([]any)
	}
	sort.SliceStable(messages, func(i, j int) bool {
		return openCodeHistoryCreated(messages[i]) < openCodeHistoryCreated(messages[j])
	})
	lastAssistantComplete := false
	for _, raw := range messages {
		message, _ := raw.(map[string]any)
		info, _ := message["info"].(map[string]any)
		parts, _ := message["parts"].([]any)
		if info == nil {
			info = message
			if s.version == 2 {
				kind := openCodeString(message["type"])
				info = map[string]any{"id": message["id"], "sessionID": sessionID, "role": kind, "time": message["time"]}
				parts, _ = message["content"].([]any)
				if text := openCodeString(message["text"]); text != "" {
					parts = append([]any{map[string]any{"type": "text", "text": text}}, parts...)
				}
				partOrdinals := map[string]int{}
				for index, rawPart := range parts {
					part, _ := rawPart.(map[string]any)
					partType := openCodeString(part["type"])
					ordinal := partOrdinals[partType]
					partOrdinals[partType] = ordinal + 1
					if partType == "text" || partType == "reasoning" {
						part["id"] = fmt.Sprintf("%s:%s:%d", openCodeString(message["id"]), partType, ordinal)
					} else if openCodeString(part["id"]) == "" {
						part["id"] = fmt.Sprintf("%s-part-%d", openCodeString(message["id"]), index)
					}
					part["messageID"], part["sessionID"] = message["id"], sessionID
					if _, hasTime := part["time"]; !hasTime {
						part["time"] = map[string]any{"end": 1}
					}
				}
			}
		}
		if id := openCodeString(info["id"]); id != "" {
			s.handleOpenCodeEvent(map[string]any{"type": "message.updated", "properties": map[string]any{"info": info}})
		}
		if openCodeString(info["role"]) == "user" {
			text := ""
			for _, rawPart := range parts {
				part, _ := rawPart.(map[string]any)
				if openCodeString(part["type"]) == "text" {
					text += openCodeString(part["text"])
				}
			}
			s.appendOpenCodeImportedUser(openCodeString(info["id"]), text)
		}
		for _, rawPart := range parts {
			part, _ := rawPart.(map[string]any)
			s.handleOpenCodeEvent(map[string]any{"type": "message.part.updated", "properties": map[string]any{"part": part}})
		}
		switch openCodeString(info["role"]) {
		case "user":
			lastAssistantComplete = false
		case "assistant":
			timing, _ := info["time"].(map[string]any)
			_, completed := timing["completed"]
			if !completed {
				_, completed = timing["end"]
			}
			lastAssistantComplete = completed
		}
	}
	return lastAssistantComplete, nil
}

func openCodeHistoryCreated(raw any) float64 {
	message, _ := raw.(map[string]any)
	info, _ := message["info"].(map[string]any)
	if info == nil {
		info = message
	}
	timing, _ := info["time"].(map[string]any)
	created, _ := timing["created"].(float64)
	return created
}

func (s *OpenCodeSession) configureV2(ctx context.Context) error {
	names := make([]string, 0, len(s.mcpServers))
	for name := range s.mcpServers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		server := s.mcpServers[name]
		config := map[string]any{"codemode": false}
		if server.Type == "" || server.Type == "stdio" {
			config["type"] = "local"
			config["command"] = append([]string{server.Command}, server.Args...)
			config["environment"] = server.Env
		} else {
			config["type"] = "remote"
			config["url"] = server.URL
			config["headers"] = server.Headers
			config["oauth"] = false
		}
		if err := s.putOpenCodeV2(ctx, "/api/experimental/mcp/"+url.PathEscape(name), map[string]any{"config": config}); err != nil {
			return err
		}
	}
	if strings.TrimSpace(s.systemPrompt) != "" {
		return s.putOpenCodeV2(ctx, "/api/session/"+url.PathEscape(s.sessionID)+"/instructions/byspace", map[string]any{"value": s.systemPrompt})
	}
	return nil
}

func (s *OpenCodeSession) postOpenCodeV2(ctx context.Context, path string, body map[string]any) error {
	return s.requestOpenCodeV2(ctx, http.MethodPost, path, body)
}

func (s *OpenCodeSession) putOpenCodeV2(ctx context.Context, path string, body map[string]any) error {
	return s.requestOpenCodeV2(ctx, http.MethodPut, path, body)
}

func (s *OpenCodeSession) addOpenCodeQuestionLocked(properties map[string]any) map[string]any {
	rawQuestions, _ := properties["questions"].([]any)
	questions := make([]any, 0, len(rawQuestions))
	for _, raw := range rawQuestions {
		question, _ := raw.(map[string]any)
		header, text := openCodeString(question["header"]), openCodeString(question["question"])
		if header == "" || text == "" {
			continue
		}
		rawOptions, _ := question["options"].([]any)
		options := make([]any, 0, len(rawOptions))
		for _, raw := range rawOptions {
			option, _ := raw.(map[string]any)
			if label := openCodeString(option["label"]); label != "" {
				mapped := map[string]any{"label": label}
				if description := openCodeString(option["description"]); description != "" {
					mapped["description"] = description
				}
				options = append(options, mapped)
			}
		}
		mapped := map[string]any{"question": text, "header": header, "options": options, "allowOther": true}
		if multiple, _ := question["multiple"].(bool); multiple {
			mapped["multiSelect"] = true
		}
		questions = append(questions, mapped)
	}
	if len(questions) == 0 {
		return nil
	}
	id := openCodeString(properties["id"])
	if id == "" {
		return nil
	}
	request := map[string]any{"id": id, "provider": "opencode", "name": "question", "kind": "question", "title": "Question", "input": map[string]any{"questions": questions}, "metadata": map[string]any{"source": "opencode_question"}}
	if tool, _ := properties["tool"].(map[string]any); tool != nil {
		for key, value := range tool {
			request["metadata"].(map[string]any)[key] = value
		}
	}
	s.pendingPermissions[id] = request
	return request
}

func (s *OpenCodeSession) addOpenCodePermissionLocked(properties map[string]any) map[string]any {
	id := openCodeString(properties["id"])
	permission := openCodeString(properties["permission"])
	metadata, _ := properties["metadata"].(map[string]any)
	command := openCodeString(metadata["command"])
	reason := openCodeString(metadata["reason"])
	patterns, _ := properties["patterns"].([]any)
	description := reason
	if len(patterns) > 0 {
		rendered := make([]string, 0, len(patterns))
		for _, pattern := range patterns {
			rendered = append(rendered, openCodeString(pattern))
		}
		if description != "" {
			description += " - "
		}
		description += "Scope: " + strings.Join(rendered, ", ")
	}
	detail := map[string]any{"type": "unknown", "input": properties, "output": nil}
	if command != "" {
		detail = map[string]any{"type": "shell", "command": command}
	}
	request := map[string]any{
		"id": id, "provider": "opencode", "name": permission, "kind": "tool",
		"title": "Permission: " + permission, "description": description,
		"input": properties, "detail": detail,
		"actions": []map[string]any{
			{"id": "deny", "label": "Deny", "behavior": "deny", "variant": "danger", "intent": "dismiss"},
			{"id": "allow_always", "label": "Allow always", "behavior": "allow", "variant": "secondary"},
			{"id": "allow_once", "label": "Allow once", "behavior": "allow", "variant": "primary"},
		},
	}
	s.pendingPermissions[id] = request
	return request
}

func (s *OpenCodeSession) respondToOpenCodePermission(requestID string, response map[string]any) error {
	s.mu.Lock()
	request := s.pendingPermissions[requestID]
	sid, cwd := s.sessionID, s.cwd
	s.mu.Unlock()
	if request == nil {
		return fmt.Errorf("no pending OpenCode permission %q", requestID)
	}
	prefix := "/session/"
	if s.version == 2 {
		prefix = "/api/session/"
	}
	var body map[string]any
	operation := "permission/"
	if request["kind"] == "question" {
		operation = "question/"
		behavior, _ := response["behavior"].(string)
		if behavior == "deny" {
			operation += url.PathEscape(requestID) + "/reject"
			body = map[string]any{}
		} else {
			operation += url.PathEscape(requestID) + "/reply"
			answers, _ := response["updatedInput"].(map[string]any)
			byHeader, _ := answers["answers"].(map[string]any)
			input, _ := request["input"].(map[string]any)
			questions, _ := input["questions"].([]any)
			values := make([][]string, 0, len(questions))
			for _, raw := range questions {
				question, _ := raw.(map[string]any)
				header := openCodeString(question["header"])
				answer := openCodeString(byHeader[header])
				parts := []string{}
				for _, part := range strings.Split(answer, ",") {
					if trimmed := strings.TrimSpace(part); trimmed != "" {
						parts = append(parts, trimmed)
					}
				}
				values = append(values, parts)
			}
			body = map[string]any{"answers": values}
		}
	} else {
		reply := "once"
		if behavior, _ := response["behavior"].(string); behavior == "deny" {
			reply = "reject"
		} else if selected, _ := response["selectedActionId"].(string); selected == "allow_always" {
			reply = "always"
		}
		body = map[string]any{"reply": reply}
		if reply == "reject" {
			body["message"] = response["message"]
		}
		operation += url.PathEscape(requestID)
	}
	payload, _ := json.Marshal(body)
	endpoint := s.baseURL + prefix + url.PathEscape(sid) + "/" + operation + "?directory=" + url.QueryEscape(cwd)
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("opencode permission: %s", resp.Status)
	}
	s.mu.Lock()
	delete(s.pendingPermissions, requestID)
	s.mu.Unlock()
	return nil
}

func (s *OpenCodeSession) requestOpenCodeV2(ctx context.Context, method, path string, body map[string]any) error {
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, method, s.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("opencode v2 %s: %s: %s", path, resp.Status, strings.TrimSpace(string(message)))
	}
	return nil
}
