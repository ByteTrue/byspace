package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// OpenCodeSession hosts an OpenCode agent via its HTTP/SSE server (`opencode serve`)
// or an ACP/JSON-RPC compatible OpenCode binary.
type OpenCodeSession struct {
	baseURL          string
	version          int
	httpClient       *http.Client
	streamHTTPClient *http.Client
	cmd              *exec.Cmd
	acpFallbk        *ACPSession

	mu                  sync.Mutex
	status              string
	sessionID           string
	cwd                 string
	model               string
	modelProvider       string
	modeID              string
	thinking            string
	systemPrompt        string
	mcpServers          map[string]sdk.MCPServerConfig
	turnCounter         int
	nextClientMessageID string
	// nextOutputSchema constrains the next reply (the prompt's json_schema format), then clears.
	nextOutputSchema map[string]any
	activeTurnID     string
	timeline         []sdk.TimelineEntry
	finishWaiters    []chan error
	// lastUsage is the token accounting from the most recent turn, for the context ring.
	lastUsage *sdk.AgentUsage
	// lastError is the provider's own text for the most recent failure.
	lastError          string
	eventSubscribers   map[int]func(map[string]any)
	nextSubID          int
	eventCancel        context.CancelFunc
	dispatchCancel     context.CancelFunc
	closed             bool
	partTypes          map[string]string
	messageRoles       map[string]string
	materializedText   map[string]string
	closedParts        map[string]bool
	toolIndexByID      map[string]int
	pendingPermissions map[string]map[string]any
	eventTimelineIndex int
}

// StartOpenCodeSession starts or attaches to an OpenCode agent session.
func StartOpenCodeSession(cfg LaunchConfig, cmdOverride string) (ManagedSession, error) {
	return startOpenCodeSessionWithArgs(cfg, cmdOverride, nil)
}

func startOpenCodeSessionWithArgs(cfg LaunchConfig, cmdOverride string, commandArgs []string) (ManagedSession, error) {
	urlOverride := strings.TrimSpace(os.Getenv("OPENCODE_SERVER_URL"))
	if strings.HasPrefix(cmdOverride, "http://") || strings.HasPrefix(cmdOverride, "https://") {
		urlOverride = cmdOverride
	}

	if urlOverride != "" {
		return newHTTPOpenCodeSessionForVersion(cfg, strings.TrimRight(urlOverride, "/"), 2, os.Getenv("OPENCODE_SERVER_PASSWORD"))
	}

	// No override and no explicit ACP request: start (or reuse) an `opencode serve` process. Without this
	// an OpenCode agent on a machine with no manually started server did not work at all — the session
	// appeared to exist and every request failed.
	if !strings.HasSuffix(cmdOverride, "acp") {
		// Only configured command-tail arguments are forwarded. Provider default args contain
		// "acp" and must not turn the server launch into `opencode acp serve`.
		pool := sharedOpenCodePool(cfg.HomeDir, cmdOverride, commandArgs, openCodePoolEnv(cfg.Env))
		server, err := pool.Acquire(context.Background())
		if err == nil && server != nil {
			return newHTTPOpenCodeSessionForVersion(cfg, server.URL, server.Version, server.Password)
		}
		// Fall through to ACP: a machine without the server binary can still drive the agent through
		// stdio, and that is better than failing the create.
	}

	// If command override points to a stdio script/binary or `opencode acp`, drive via ACP/stdio
	spec := GetProviderSpec("opencode")
	spec.DefaultArgs = append(append([]string{}, commandArgs...), "acp")
	return StartACPSession(cfg, spec, cmdOverride)
}

func newHTTPOpenCodeSession(cfg LaunchConfig, baseURL string) (*OpenCodeSession, error) {
	return newHTTPOpenCodeSessionForVersion(cfg, baseURL, 1, "")
}

func newHTTPOpenCodeSessionForVersion(cfg LaunchConfig, baseURL string, version int, password string) (*OpenCodeSession, error) {
	if version == 2 {
		return newOpenCodeV2Session(cfg, baseURL, password)
	}
	if version != 1 {
		return nil, fmt.Errorf("unsupported OpenCode protocol version %d", version)
	}
	client := newOpenCodeHTTPClient(password)
	s := &OpenCodeSession{
		baseURL:          baseURL,
		version:          version,
		httpClient:       client,
		streamHTTPClient: newOpenCodeStreamHTTPClient(password),
		status:           "idle",
		cwd:              cfg.Cwd,
		model:            cfg.Model,
		modelProvider:    cfg.ModelProvider,
		modeID:           cfg.ModeID,
		thinking:         cfg.ThinkingOptionID,
		sessionID:        cfg.SessionHandle,
		eventSubscribers: make(map[int]func(map[string]any)),
		partTypes:        make(map[string]string), messageRoles: make(map[string]string),
		materializedText: make(map[string]string), closedParts: make(map[string]bool),
		toolIndexByID: make(map[string]int), pendingPermissions: make(map[string]map[string]any),
		systemPrompt: cfg.SystemPrompt, mcpServers: cfg.MCPServers, eventTimelineIndex: -1,
	}

	if s.sessionID == "" {
		body, _ := json.Marshal(map[string]any{"cwd": cfg.Cwd})
		resp, err := client.Post(baseURL+"/session", "application/json", bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("opencode create session: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			return nil, fmt.Errorf("opencode v1 create session: %s: %s", resp.Status, strings.TrimSpace(string(message)))
		}
		var res map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
			return nil, fmt.Errorf("opencode create session: %w", err)
		}
		id, _ := res["id"].(string)
		if id == "" {
			return nil, fmt.Errorf("opencode create session: response has no id")
		}
		s.sessionID = id
	}
	s.startEventStream()
	return s, nil
}

func (s *OpenCodeSession) Status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *OpenCodeSession) Timeline() []sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *OpenCodeSession) SeedTimeline(entries []sdk.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]sdk.TimelineEntry, len(entries))
	copy(s.timeline, entries)
}

func (s *OpenCodeSession) SetNextClientMessageID(id string) {
	s.mu.Lock()
	s.nextClientMessageID = id
	s.mu.Unlock()
}

// SetNextOutputSchema constrains the next reply to schema.
func (s *OpenCodeSession) SetNextOutputSchema(schema any) error {
	if s.version == 2 {
		return errors.New("OpenCode v2 does not support BySpace structured outputs")
	}
	object, ok := schema.(map[string]any)
	if !ok {
		return errors.New("OpenCode structured outputs require a JSON object schema.")
	}
	s.mu.Lock()
	s.nextOutputSchema = object
	s.mu.Unlock()
	return nil
}

func (s *OpenCodeSession) LastError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastError
}

// TurnToken returns "" for providers without an explicit turn token; the daemon then relies
// on its own turn id comparison.
func (s *OpenCodeSession) TurnToken() string { return "" }

// Usage reports token/cost accounting when the provider exposes it.
// Usage reports the token accounting from the most recent turn.
//
// The composer's context ring reads this; without it an OpenCode agent showed no usage at all
// even though every step reports it.
func (s *OpenCodeSession) Usage(_ context.Context) *sdk.AgentUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastUsage == nil {
		return nil
	}
	usage := *s.lastUsage
	return &usage
}

func (s *OpenCodeSession) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.timeline)
}

func (s *OpenCodeSession) ActiveTurn() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status != "running" {
		return "", ""
	}
	return s.activeTurnID, ""
}

func (s *OpenCodeSession) LastAssistantText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.timeline) - 1; i >= 0; i-- {
		if s.timeline[i].Item.Type == "assistant_message" {
			return s.timeline[i].Item.Text
		}
	}
	return ""
}

// AppendTimelineItem stores one item in the session's own timeline and returns the entry.
//
// It does not broadcast: the daemon emits the timeline event itself, so a provider cannot re-enter
// its own event loop. The entry deliberately carries no turn id — the daemon uses this for rows that
// belong to no turn, such as the system-error row a failed turn leaves behind.
func (s *OpenCodeSession) AppendTimelineItem(item sdk.TimelineItem) sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := sdk.TimelineEntry{
		Seq:       len(s.timeline) + 1,
		SeqEnd:    len(s.timeline) + 1,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      sdk.LimitTimelineItemContent(item),
	}
	s.timeline = append(s.timeline, entry)
	return entry
}

func (s *OpenCodeSession) Prompt(_ context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fmt.Errorf("OpenCode session is closed")
	}
	if s.status == "running" {
		s.mu.Unlock()
		return fmt.Errorf("OpenCode turn is already running")
	}
	s.resetOpenCodeTurnUsageLocked()
	s.turnCounter++
	s.activeTurnID = fmt.Sprintf("turn_%d", s.turnCounter)
	turnID := s.activeTurnID
	dispatchCtx, dispatchCancel := context.WithCancel(context.Background())
	s.dispatchCancel = dispatchCancel
	s.status = "running"
	clientMsgID := takeClientMessageID(&s.nextClientMessageID)
	userEntry := sdk.TimelineEntry{
		Seq: len(s.timeline) + 1, TurnID: s.activeTurnID, Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item: userMessage(message, clientMsgID),
	}
	s.timeline = append(s.timeline, userEntry)
	outputSchema := s.nextOutputSchema
	s.nextOutputSchema = nil
	subs := s.copyOpenCodeSubscribersLocked()
	s.mu.Unlock()
	for _, fn := range subs {
		fn(map[string]any{"type": "turn_start"})
	}
	publishOpenCodeTimeline(subs, userEntry.Seq, userEntry.TurnID, userEntry.Item)
	go func() {
		requestCtx, cancel := context.WithTimeout(dispatchCtx, 30*time.Second)
		defer cancel()
		if err := s.dispatchOpenCodePrompt(requestCtx, message, images, outputSchema, "queue"); err != nil {
			// A dispatch timeout is a terminal dispatch failure, not permission to leave the turn
			// running forever. A late error still cannot settle a newer turn.
			s.finishOpenCodeTurnForID(turnID, err, false)
		}
	}()
	return nil
}

func (s *OpenCodeSession) resetOpenCodeTurnUsageLocked() {
	if s.version != 1 || s.lastUsage == nil {
		return
	}
	usage := *s.lastUsage
	usage.TotalCostUSD = 0
	s.lastUsage = &usage
}

func (s *OpenCodeSession) copyOpenCodeSubscribersLocked() []func(map[string]any) {
	subs := make([]func(map[string]any), 0, len(s.eventSubscribers))
	for _, fn := range s.eventSubscribers {
		subs = append(subs, fn)
	}
	return subs
}

func (s *OpenCodeSession) finishOpenCodeTurn(turnErr error, canceled bool) {
	s.mu.Lock()
	turnID := s.activeTurnID
	s.mu.Unlock()
	s.finishOpenCodeTurnForID(turnID, turnErr, canceled)
}

func (s *OpenCodeSession) finishOpenCodeTurnForID(expectedTurnID string, turnErr error, canceled bool) {
	s.mu.Lock()
	turnID := s.activeTurnID
	if turnID == "" || turnID != expectedTurnID {
		s.mu.Unlock()
		return
	}
	if s.dispatchCancel != nil {
		s.dispatchCancel()
		s.dispatchCancel = nil
	}
	if turnErr != nil {
		s.lastError = turnErr.Error()
	}
	s.status = "idle"
	s.activeTurnID = ""
	waiters := s.finishWaiters
	s.finishWaiters = nil
	subs := s.copyOpenCodeSubscribersLocked()
	s.mu.Unlock()
	for _, ch := range waiters {
		ch <- turnErr
		close(ch)
	}
	for _, fn := range subs {
		switch {
		case canceled:
			fn(map[string]any{"type": "byspace_turn_canceled", "turnId": turnID, "reason": "Interrupted"})
		case turnErr != nil:
			fn(map[string]any{"type": "byspace_turn_failed", "turnId": turnID, "error": turnErr.Error()})
		default:
			fn(map[string]any{"type": "byspace_turn_completed", "turnId": turnID})
		}
	}
}

func (s *OpenCodeSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	if s.status != "running" || s.activeTurnID == "" {
		s.mu.Unlock()
		return fmt.Errorf("OpenCode has no active turn to steer")
	}
	s.mu.Unlock()
	if err := s.dispatchOpenCodePrompt(ctx, message, images, nil, "steer"); err != nil {
		return err
	}
	s.mu.Lock()
	clientMsgID := takeClientMessageID(&s.nextClientMessageID)
	turnID := s.activeTurnID
	entry := sdk.TimelineEntry{Seq: len(s.timeline) + 1, TurnID: turnID, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Item: userMessage(message, clientMsgID)}
	s.timeline = append(s.timeline, entry)
	subs := s.copyOpenCodeSubscribersLocked()
	s.mu.Unlock()
	publishOpenCodeTimeline(subs, entry.Seq, turnID, entry.Item)
	return nil
}

func (s *OpenCodeSession) Abort(ctx context.Context) error {
	s.mu.Lock()
	sid := s.sessionID
	// Bind the native interrupt and local cleanup to the turn that was active when Abort began.
	// A slow HTTP response must not cancel a turn started after the native idle event.
	expectedTurnID := s.activeTurnID
	endpoint := s.baseURL + "/session/" + url.PathEscape(sid) + "/abort"
	if s.version == 2 {
		endpoint = s.baseURL + "/api/session/" + url.PathEscape(sid) + "/interrupt"
	}
	s.mu.Unlock()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader("{}"))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("opencode interrupt: %s", resp.Status)
	}

	s.mu.Lock()
	if expectedTurnID == "" || s.activeTurnID != expectedTurnID {
		s.mu.Unlock()
		return nil
	}
	for _, index := range failRunningToolCalls(s.timeline, "Interrupted") {
		entry := &s.timeline[index]
		if entry.SeqEnd == 0 {
			entry.SeqEnd = entry.Seq
		}
	}
	s.mu.Unlock()
	s.finishOpenCodeTurnForID(expectedTurnID, nil, true)
	return nil
}

func (s *OpenCodeSession) WaitForFinish(ctx context.Context) error {
	s.mu.Lock()
	if s.status != "running" {
		s.mu.Unlock()
		return nil
	}
	ch := make(chan error, 1)
	s.finishWaiters = append(s.finishWaiters, ch)
	s.mu.Unlock()

	select {
	case err := <-ch:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *OpenCodeSession) ArchiveNative(ctx context.Context, archived bool) error {
	s.mu.Lock()
	sid, cwd := s.sessionID, s.cwd
	endpoint := s.baseURL + "/session/" + url.PathEscape(sid)
	if s.version == 2 {
		endpoint = s.baseURL + "/api/session/" + url.PathEscape(sid)
	}
	s.mu.Unlock()
	var body map[string]any
	if s.version == 2 {
		body = map[string]any{"archived": archived}
	} else {
		archivedAt := int64(0)
		if archived {
			archivedAt = time.Now().UnixMilli()
		}
		body = map[string]any{"time": map[string]any{"archived": archivedAt}}
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint+"?directory="+url.QueryEscape(cwd), bytes.NewReader(payload))
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
		return fmt.Errorf("opencode archive: %s: %s", resp.Status, strings.TrimSpace(string(message)))
	}
	return nil
}

func (s *OpenCodeSession) Capabilities() sdk.AgentCapabilities {
	return sdk.AgentCapabilities{SupportsStreaming: true, SupportsSessionPersistence: true, SupportsMcpServers: true, SupportsReasoningStream: true, SupportsToolInvocations: true, CanCancel: true, CanSelectModel: true, CanSelectThinking: true, SupportsImages: true, SupportsAttachments: true, SupportsNativeArchive: true, SupportsHistoryImport: true, SupportsNativeSubagents: true}
}

func (s *OpenCodeSession) GetState(_ context.Context) (*sdk.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &sdk.SessionState{
		SessionID:     s.sessionID,
		ThinkingLevel: s.thinking,
		IsStreaming:   s.status == "running",
	}, nil
}

func (s *OpenCodeSession) SetModel(_ context.Context, provider, modelID string) (*sdk.Model, error) {
	s.mu.Lock()
	s.model = modelID
	s.modelProvider = provider
	s.mu.Unlock()
	return &sdk.Model{Provider: provider, ID: modelID, Name: modelID}, nil
}

func (s *OpenCodeSession) SetMode(_ context.Context, modeID string) error {
	s.mu.Lock()
	s.modeID = modeID
	s.mu.Unlock()
	return nil
}

func (s *OpenCodeSession) SetThinkingLevel(_ context.Context, level string) error {
	s.mu.Lock()
	s.thinking = level
	s.mu.Unlock()
	return nil
}

// GetCommands asks the server for the commands it knows.
//
// OpenCode keeps the list server-side (built-ins, project commands and skills), so a hardcoded
// answer hid every project command. The static list below is only the fallback when the server
// cannot answer.
func (s *OpenCodeSession) GetCommands(ctx context.Context) ([]sdk.SlashCommand, error) {
	if commands := s.listCommandsFromServer(ctx); len(commands) > 0 {
		return commands, nil
	}
	return []sdk.SlashCommand{
		{Name: "compact", Description: "Compact session", Source: "builtin"},
	}, nil
}

func (s *OpenCodeSession) PendingPermissions() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]map[string]any, 0, len(s.pendingPermissions))
	for _, request := range s.pendingPermissions {
		out = append(out, request)
	}
	return out
}

func (s *OpenCodeSession) RespondToPermission(requestID string, response map[string]any) error {
	return s.respondToOpenCodePermission(requestID, response)
}

func (s *OpenCodeSession) ListSubagents(parentAgentID string) []sdk.SubagentDescriptor {
	s.mu.Lock()
	sid, cwd := s.sessionID, s.cwd
	endpoint := s.baseURL + "/session/" + url.PathEscape(sid) + "/children"
	if s.version == 2 {
		// OpenCode 2.3 removed the v1 children route. Its flat session list retains
		// parentID, which is the native ownership relation.
		endpoint = s.baseURL + "/api/session"
	}
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?directory="+url.QueryEscape(cwd), nil)
	if err != nil {
		return []sdk.SubagentDescriptor{}
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return []sdk.SubagentDescriptor{}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return []sdk.SubagentDescriptor{}
	}
	var payload any
	if json.NewDecoder(resp.Body).Decode(&payload) != nil {
		return []sdk.SubagentDescriptor{}
	}
	children, _ := payload.([]any)
	if object, _ := payload.(map[string]any); object != nil {
		children, _ = object["data"].([]any)
	}
	result := make([]sdk.SubagentDescriptor, 0, len(children))
	for _, raw := range children {
		child, _ := raw.(map[string]any)
		id := openCodeString(child["id"])
		if id == "" || (s.version == 2 && openCodeString(child["parentID"]) != sid) {
			continue
		}
		title := openCodeString(child["title"])
		status := openCodeString(child["status"])
		if status == "" {
			status = "completed"
		}
		childCwd := openCodeString(child["directory"])
		if childCwd == "" {
			childCwd = cwd
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		descriptor := sdk.SubagentDescriptor{ID: id, ParentAgentID: parentAgentID, Provider: "opencode", Title: &title, Description: nil, Status: status, CreatedAt: now, UpdatedAt: now, ToolCallID: nil, Cwd: &childCwd, SessionID: id}
		applyOpenCodeSubagentFacts(child, &descriptor)
		if s.version == 2 {
			s.addOpenCodeSubagentFacts(ctx, id, childCwd, &descriptor)
		} else {
			descriptor.Subtitle = sdk.BuildSubagentSubtitle(descriptor.Kind, descriptor.Model, descriptor.Effort, descriptor.TotalTokens)
		}
		result = append(result, descriptor)
	}
	return result
}

func (s *OpenCodeSession) addOpenCodeSubagentFacts(ctx context.Context, sessionID, cwd string, descriptor *sdk.SubagentDescriptor) {
	endpoint := s.baseURL + "/api/session/" + url.PathEscape(sessionID) + "/message?directory=" + url.QueryEscape(cwd)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return
	}
	var payload any
	if json.NewDecoder(resp.Body).Decode(&payload) != nil {
		return
	}
	messages, _ := payload.([]any)
	if object, _ := payload.(map[string]any); object != nil {
		messages, _ = object["data"].([]any)
	}
	for _, raw := range messages {
		message, _ := raw.(map[string]any)
		if openCodeString(message["type"]) == "assistant" {
			applyOpenCodeSubagentFacts(message, descriptor)
		}
	}
	descriptor.Subtitle = sdk.BuildSubagentSubtitle(descriptor.Kind, descriptor.Model, descriptor.Effort, descriptor.TotalTokens)
}

func applyOpenCodeSubagentFacts(message map[string]any, descriptor *sdk.SubagentDescriptor) {
	if agent := openCodeString(message["agent"]); agent != "" {
		descriptor.Kind = &agent
	}
	if model, _ := message["model"].(map[string]any); model != nil {
		if id := openCodeString(model["id"]); id != "" {
			descriptor.Model = &id
		}
		if variant := openCodeString(model["variant"]); variant != "" && variant != "default" {
			descriptor.Effort = &variant
		}
	}
	if tokens, _ := message["tokens"].(map[string]any); tokens != nil {
		total := 0
		for _, key := range []string{"input", "output", "reasoning"} {
			value, _ := numericParam(tokens, key)
			total += value
		}
		if cache, _ := tokens["cache"].(map[string]any); cache != nil {
			for _, key := range []string{"read", "write"} {
				value, _ := numericParam(cache, key)
				total += value
			}
		}
		total64 := int64(total)
		descriptor.TotalTokens = &total64
	}
}

func (s *OpenCodeSession) GetSubagent(parentAgentID, subagentID string) (sdk.SubagentDescriptor, bool) {
	for _, subagent := range s.ListSubagents(parentAgentID) {
		if subagent.ID == subagentID {
			return subagent, true
		}
	}
	return sdk.SubagentDescriptor{}, false
}

func (s *OpenCodeSession) OnEvent(fn func(map[string]any)) func() {
	s.mu.Lock()
	id := s.nextSubID
	s.nextSubID++
	s.eventSubscribers[id] = fn
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.eventSubscribers, id)
		s.mu.Unlock()
	}
}

func (s *OpenCodeSession) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	turnID := s.activeTurnID
	cmd := s.cmd
	s.mu.Unlock()
	if s.eventCancel != nil {
		s.eventCancel()
	}
	s.finishOpenCodeTurnForID(turnID, fmt.Errorf("OpenCode session is closed"), false)
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	return nil
}

// ConversationFSRewind reports what this provider can rewind.
//
// OpenCode's revert restores the conversation and the files the session changed, so both are true.
func (s *OpenCodeSession) RewindCapabilities() RewindCapabilities {
	if s.version == 2 {
		return RewindCapabilities{Conversation: true, Both: true}
	}
	return RewindCapabilities{Both: true}
}

// Rewind reverts the conversation to a message.
//
// Ported from opencode/rewind.ts: `session.revert` with the message id. OpenCode keeps unrevert available only until a
// later prompt triggers its cleanup, which permanently drops the reverted messages, so there is nothing to undo here
// even if a caller asks.
func (s *OpenCodeSession) RewindConversation(ctx context.Context, messageID string) error {
	return s.RewindConversationMode(ctx, messageID, "both")
}

// RewindConversationMode keeps v2 conversation-only rewinds from touching files.
// The native revert endpoint cannot restore files without changing conversation history.
func (s *OpenCodeSession) RewindConversationMode(ctx context.Context, messageID, mode string) error {
	if mode == "files" {
		return errors.New("OpenCode does not support files-only rewind")
	}
	trimmed := strings.TrimSpace(messageID)
	if trimmed == "" {
		return errors.New("rewind needs a message id")
	}
	s.mu.Lock()
	sid := s.sessionID
	base := s.baseURL
	s.mu.Unlock()
	if sid == "" {
		return errors.New("rewind needs a session")
	}
	resolved, err := s.resolveOpenCodeMessageID(ctx, trimmed)
	if err != nil {
		return err
	}
	trimmed = resolved
	if s.version == 2 {
		if err := s.postOpenCodeV2(ctx, "/api/session/"+url.PathEscape(sid)+"/revert/stage", map[string]any{"messageID": trimmed, "files": mode == "both"}); err != nil {
			return err
		}
		if err := s.postOpenCodeV2(ctx, "/api/session/"+url.PathEscape(sid)+"/revert/commit", map[string]any{}); err != nil {
			return err
		}
		s.mu.Lock()
		s.status = "idle"
		s.mu.Unlock()
		return nil
	}

	if mode == "conversation" {
		return errors.New("OpenCode v1 does not support conversation-only rewind")
	}
	s.mu.Lock()
	directory := s.cwd
	s.mu.Unlock()
	body, err := json.Marshal(map[string]any{"messageID": trimmed, "directory": directory})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+"/session/"+sid+"/revert", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("opencode revert failed (%d): %s", response.StatusCode, strings.TrimSpace(string(raw)))
	}

	// The reverted messages are gone, so the transcript the client holds is wrong until it is re-read.
	s.mu.Lock()
	s.status = "idle"
	s.mu.Unlock()
	return nil
}

func (s *OpenCodeSession) RewindFiles(context.Context, string) error {
	return errors.New("OpenCode does not support files-only rewind")
}

func (s *OpenCodeSession) resolveOpenCodeMessageID(ctx context.Context, messageID string) (string, error) {
	lookup := func() string {
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, entry := range s.timeline {
			item := entry.Item
			if item.Type != "user_message" || (item.MessageID != messageID && item.ClientMessageID != messageID) {
				continue
			}
			if item.MessageID != "" && item.MessageID != item.ClientMessageID {
				return item.MessageID
			}
		}
		return ""
	}
	if resolved := lookup(); resolved != "" {
		return resolved, nil
	}
	s.mu.Lock()
	sessionID := s.sessionID
	s.mu.Unlock()
	if _, err := s.replayOpenCodeHistory(ctx, sessionID); err != nil {
		return "", err
	}
	if resolved := lookup(); resolved != "" {
		return resolved, nil
	}
	return messageID, nil
}

// TreeEntryForMessage maps a message id to the provider's own reference.
//
// OpenCode addresses messages by id directly, so the mapping is the identity. The pi session needs a translation
// because its rewind goes through a tree whose entries are not message ids.
func (s *OpenCodeSession) TreeEntryForMessage(messageID string) (string, bool) {
	trimmed := strings.TrimSpace(messageID)
	return trimmed, trimmed != ""
}

// openCodeUsageFromParts reads the token accounting the turn's step-finish parts carry.
//
// OpenCode reports it per step: fresh input, output, reasoning and the two cache buckets. The
// context ring's "used" is their sum — reading only `input` showed a long conversation as nearly
// empty — and the cost accumulates across steps.
func openCodeUsageFromParts(parts []any) *sdk.AgentUsage {
	usage := &sdk.AgentUsage{}
	seen := false
	for _, raw := range parts {
		part, ok := raw.(map[string]any)
		if !ok || part["type"] != "step-finish" {
			continue
		}
		tokens, _ := part["tokens"].(map[string]any)
		cache, _ := tokens["cache"].(map[string]any)
		used := intField(tokens, "input") + intField(tokens, "output") +
			intField(tokens, "reasoning") + intField(cache, "read") + intField(cache, "write")
		if used == 0 {
			continue
		}
		seen = true
		usage.InputTokens = intField(tokens, "input")
		usage.CachedInputTokens = intField(cache, "read")
		usage.OutputTokens = intField(tokens, "output")
		usage.ContextWindowUsedTokens = &used
		if cost, ok := part["cost"].(float64); ok {
			usage.TotalCostUSD += cost
		}
	}
	if !seen {
		return nil
	}
	return usage
}

// listCommandsFromServer reads GET /command, which returns the commands for one directory.
func (s *OpenCodeSession) listCommandsFromServer(ctx context.Context) []sdk.SlashCommand {
	s.mu.Lock()
	baseURL := s.baseURL
	cwd := s.cwd
	path := "/command"
	if s.version == 2 {
		path = "/api/command"
	}
	s.mu.Unlock()
	if baseURL == "" {
		return nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return nil
	}
	if cwd != "" {
		query := request.URL.Query()
		query.Set("directory", cwd)
		request.URL.RawQuery = query.Encode()
	}
	resp, err := s.httpClient.Do(request)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	type commandEntry struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Hints       []string `json:"hints"`
		Source      string   `json:"source"`
	}
	var entries []commandEntry
	if s.version == 2 {
		var envelope struct {
			Data []commandEntry `json:"data"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
			return nil
		}
		entries = envelope.Data
	} else if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil
	}
	out := make([]sdk.SlashCommand, 0, len(entries))
	for _, entry := range entries {
		if strings.TrimSpace(entry.Name) == "" {
			continue
		}
		kind := "command"
		if entry.Source == "skill" {
			kind = "skill"
		}
		out = append(out, sdk.SlashCommand{
			Name:         entry.Name,
			Description:  entry.Description,
			ArgumentHint: strings.Join(entry.Hints, " "),
			Source:       kind,
		})
	}
	return out
}

// openCodePoolEnv extracts the environment a pooled server can carry.
//
// The BySpace identity is dropped: one server hosts many sessions and cannot vary it per session, so
// including it would give every agent its own server. The host variables stay, so `byspace` inside
// OpenCode reaches the daemon — as the host's own CLI principal, which is the documented limit.
func openCodePoolEnv(env []string) map[string]string {
	out := make(map[string]string, len(env))
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || strings.TrimSpace(key) == "" {
			continue
		}
		switch key {
		case "BYSPACE_AGENT_ID", "BYSPACE_AGENT_CWD", "BYSPACE_SUBAGENT_REPORT_TOKEN", "BYSPACE_SUBAGENT_REPORT_URL":
			continue
		}
		out[key] = value
	}
	return out
}
