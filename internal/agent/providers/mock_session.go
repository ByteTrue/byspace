package providers

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// MockSession is the scripted agent behind the `mock` provider.
//
// Ported from `MockLoadTestAgentSession`. It holds a timeline, streams tokens on a timer, and turns certain
// prompt phrases into specific behaviours (a permission prompt, a failed turn, a synthetic notification).
// That vocabulary is what the Playwright specs send, so the regexes below are the contract.
type MockSession struct {
	mu sync.Mutex

	id       string
	cwd      string
	modelID  string
	modeID   string
	thinking string

	timeline  []sdk.TimelineEntry
	streamSeq int
	status    string
	lastError string

	// turnToken identifies the turn that owns the session; a late completion from a previous turn is
	// discarded rather than ending the new one.
	turnToken              string
	activeTurnID           string
	activeTurnAssistantMsg string

	nextClientMessageID string
	lastAssistantText   string

	pendingPermissions []map[string]any
	subagents          []sdk.SubagentDescriptor

	listeners map[int]func(map[string]any)
	nextSubID int

	// cancel stops the running turn's emitter.
	cancel context.CancelFunc
	// finished is closed when the active turn ends, so WaitForFinish can block on it.
	finished chan struct{}

	// Scripted state.
	assistantResponse         string
	streamingResponse         string
	streamingIntervalMs       int
	rewindError               string
	remainingPromptRejections int
	remainingSteerFailures    int
	reasoningRepeat           int

	// FeatureValues the specs pass at creation; kept for behaviour that reads them per-turn.
	featureValues map[string]any
}

// MockLaunchOptions is what the daemon hands the session.
type MockLaunchOptions struct {
	Cwd           string
	Model         string
	ModeID        string
	ThinkingID    string
	SessionID     string
	FeatureValues map[string]any
}

// StartMockSession builds a scripted session.
func StartMockSession(opts MockLaunchOptions) *MockSession {
	sessionID := strings.TrimSpace(opts.SessionID)
	if sessionID == "" {
		sessionID = newMockID("mock")
	}
	modeID := strings.TrimSpace(opts.ModeID)
	if modeID == "" {
		modeID = MockModeID
	}
	model := ResolveMockModel(opts.Model)

	s := &MockSession{
		id:                  sessionID,
		cwd:                 opts.Cwd,
		modelID:             model.ID,
		modeID:              modeID,
		thinking:            opts.ThinkingID,
		status:              "idle",
		listeners:           make(map[int]func(map[string]any)),
		streamingIntervalMs: mockIntervalMs,
		featureValues:       opts.FeatureValues,
	}
	if s.thinking == "" {
		s.thinking = model.DefaultThink
	}

	// featureValues are the knobs the specs turn; each one exists because a spec asserts on its effect.
	if values := opts.FeatureValues; values != nil {
		if text, ok := values["mockAssistantResponse"].(string); ok {
			s.assistantResponse = text
		}
		if text, ok := values["mockStreamingAssistantResponse"].(string); ok {
			s.streamingResponse = text
		}
		if raw, ok := values["mockStreamingAssistantIntervalMs"].(float64); ok && raw >= 1 {
			// Capped so a spec cannot make the suite wait a minute per token.
			interval := int(raw)
			if interval > 1000 {
				interval = 1000
			}
			s.streamingIntervalMs = interval
		}
		if text, ok := values["mockRewindError"].(string); ok {
			s.rewindError = text
		}
		if raw, ok := values["mockReasoningRepeat"].(float64); ok && raw > 0 {
			s.reasoningRepeat = int(raw)
		}
		if raw, ok := values["mockPromptRejections"].(float64); ok && raw > 0 {
			s.remainingPromptRejections = int(raw)
		}
		if raw, ok := values["mockSteerAmbiguousFailures"].(float64); ok && raw > 0 {
			s.remainingSteerFailures = int(raw)
		}
	}
	return s
}

// ---------------------------------------------------------------- ManagedSession

func (s *MockSession) Status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *MockSession) Timeline() []sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.TimelineEntry, len(s.timeline))
	copy(out, s.timeline)
	return out
}

func (s *MockSession) SeedTimeline(entries []sdk.TimelineEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeline = make([]sdk.TimelineEntry, len(entries))
	copy(s.timeline, entries)
	for _, entry := range entries {
		if entry.SeqEnd > s.streamSeq {
			s.streamSeq = entry.SeqEnd
		}
	}
}

func (s *MockSession) StreamSeq() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streamSeq
}

// Usage reports context consumption.
//
// The mock has no real context, but the specs assert that the meter fills during a turn, so it reports the
// number of characters emitted against a fixed window.
func (s *MockSession) Usage(ctx context.Context) *sdk.AgentUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	used := 0
	for _, entry := range s.timeline {
		used += len(entry.Item.Text)
	}
	if used == 0 {
		return nil
	}
	total := 200000
	return &sdk.AgentUsage{
		InputTokens:             used,
		OutputTokens:            used,
		ContextWindowMaxTokens:  &total,
		ContextWindowUsedTokens: &used,
	}
}

func (s *MockSession) TurnToken() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turnToken
}

func (s *MockSession) LastError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastError
}

func (s *MockSession) ActiveTurn() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activeTurnID, s.activeTurnAssistantMsg
}

func (s *MockSession) LastAssistantText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastAssistantText
}

func (s *MockSession) SetNextClientMessageID(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextClientMessageID = strings.TrimSpace(id)
}

// Prompt starts a turn.
//
// The phases mirror node: the user message lands first (so the client can render the optimistic bubble
// merge), then reasoning and text stream on the model's cadence, then the turn completes.
func (s *MockSession) Prompt(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	if s.activeTurnID != "" {
		s.mu.Unlock()
		return errors.New("mock provider already has an active turn")
	}
	if s.remainingPromptRejections > 0 {
		s.remainingPromptRejections--
		s.mu.Unlock()
		return errors.New("Requested mock prompt rejection")
	}
	s.mu.Unlock()
	return s.startTurn(ctx, message, len(images) > 0)
}

// Steer appends to the running turn.
func (s *MockSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	if s.remainingSteerFailures > 0 {
		s.remainingSteerFailures--
		s.mu.Unlock()
		return errors.New("Ambiguous mock steer target")
	}
	active := s.activeTurnID != ""
	s.mu.Unlock()
	if !active {
		// No turn to join: the caller's message becomes its own turn, which is what the daemon does when
		// steer has nothing to attach to.
		return s.Prompt(ctx, message, images)
	}
	s.appendItem(sdk.TimelineItem{
		Type:      "user_message",
		MessageID: newMockID("msg"),
		Text:      message,
	})
	return nil
}

func (s *MockSession) Abort(ctx context.Context) error {
	s.mu.Lock()
	cancel := s.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

// WaitForFinish blocks until the active turn ends.
func (s *MockSession) WaitForFinish(ctx context.Context) error {
	s.mu.Lock()
	finished := s.finished
	s.mu.Unlock()
	if finished == nil {
		return nil
	}
	select {
	case <-finished:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *MockSession) GetState(ctx context.Context) (*sdk.SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &sdk.SessionState{
		SessionID:     s.id,
		Model:         &sdk.Model{Provider: MockProviderID, ID: s.modelID, Name: s.modelID},
		ThinkingLevel: s.thinking,
		IsStreaming:   s.activeTurnID != "",
	}, nil
}

func (s *MockSession) SetModel(ctx context.Context, provider, modelID string) (*sdk.Model, error) {
	resolved := ResolveMockModel(modelID)
	s.mu.Lock()
	s.modelID = resolved.ID
	s.mu.Unlock()
	return &sdk.Model{Provider: MockProviderID, ID: resolved.ID, Name: resolved.Label}, nil
}

func (s *MockSession) SetThinkingLevel(ctx context.Context, level string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.thinking = level
	return nil
}

// GetCommands reports the one command the provider answers itself.
func (s *MockSession) GetCommands(ctx context.Context) ([]sdk.SlashCommand, error) {
	return []sdk.SlashCommand{
		{Name: "handled-command", Description: "Handled by the mock provider", ArgumentHint: ""},
	}, nil
}

func (s *MockSession) PendingPermissions() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]map[string]any, len(s.pendingPermissions))
	copy(out, s.pendingPermissions)
	return out
}

func (s *MockSession) RespondToPermission(requestID string, resp map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	remaining := s.pendingPermissions[:0]
	for _, request := range s.pendingPermissions {
		if id, _ := request["requestId"].(string); id == requestID {
			continue
		}
		remaining = append(remaining, request)
	}
	s.pendingPermissions = remaining
	return nil
}

func (s *MockSession) ListSubagents(parentAgentID string) []sdk.SubagentDescriptor {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sdk.SubagentDescriptor, len(s.subagents))
	copy(out, s.subagents)
	return out
}

func (s *MockSession) GetSubagent(parentAgentID, subagentID string) (sdk.SubagentDescriptor, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entry := range s.subagents {
		if entry.ID == subagentID {
			return entry, true
		}
	}
	return sdk.SubagentDescriptor{}, false
}

func (s *MockSession) OnEvent(fn func(map[string]any)) func() {
	s.mu.Lock()
	id := s.nextSubID
	s.nextSubID++
	s.listeners[id] = fn
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.listeners, id)
		s.mu.Unlock()
	}
}

func (s *MockSession) Close() error {
	s.mu.Lock()
	cancel := s.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

// ---------------------------------------------------------------- emit helpers

// emit sends an event to the daemon.
//
// Copied under the lock so a listener that re-enters the session (checking status, for instance) does not
// deadlock, and so a listener added mid-emit does not see a half-built map.
func (s *MockSession) emit(event map[string]any) {
	s.mu.Lock()
	listeners := make([]func(map[string]any), 0, len(s.listeners))
	for _, fn := range s.listeners {
		listeners = append(listeners, fn)
	}
	s.mu.Unlock()
	for _, fn := range listeners {
		fn(event)
	}
}

// appendItem adds a timeline entry and emits it.
func (s *MockSession) appendItem(item sdk.TimelineItem) {
	s.mu.Lock()
	s.streamSeq++
	seq := s.streamSeq
	entry := sdk.TimelineEntry{
		Seq:       seq,
		SeqEnd:    seq,
		TurnID:    s.activeTurnID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      item,
	}
	s.timeline = append(s.timeline, entry)
	turnID := s.activeTurnID
	s.mu.Unlock()
	s.emit(map[string]any{
		"type":   "byspace_stream_timeline",
		"seq":    seq,
		"turnId": turnID,
		"item":   item,
	})
}

// newMockID makes a unique id with a readable prefix.
//
// Not a uuid: nothing validates the shape, and a counter keeps test output diffable.
func newMockID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

// toTimelineItem converts an event-side map into the timeline item the store and the wire use.
//
// The two shapes differ: events travel as loose maps because each provider emits what it has, while a
// timeline entry is typed. Converting here keeps the emit path readable and keeps the entry shape in one
// place.
func toTimelineItem(item map[string]any) sdk.TimelineItem {
	out := sdk.TimelineItem{}
	if text, ok := item["type"].(string); ok {
		out.Type = text
	}
	if text, ok := item["text"].(string); ok {
		out.Text = text
	}
	if text, ok := item["messageId"].(string); ok {
		out.MessageID = text
	}
	if text, ok := item["clientMessageId"].(string); ok {
		out.ClientMessageID = text
	}
	if text, ok := item["callId"].(string); ok {
		out.CallID = text
	}
	if text, ok := item["name"].(string); ok {
		out.Name = text
	}
	if text, ok := item["status"].(string); ok {
		out.Status = text
	}
	if value, ok := item["detail"]; ok {
		out.Detail = value
	}
	if value, ok := item["error"]; ok {
		out.Error = value
	}
	if text, ok := item["level"].(string); ok {
		out.Level = text
	}
	if text, ok := item["message"].(string); ok {
		out.Message = text
	}
	return out
}

// startTurn runs one scripted turn.
//
// Order matters and mirrors node: user message, then turn_started, then reasoning and text deltas, then
// completion. The client merges its optimistic bubble on the user message's clientMessageId, and treats
// turn_started as the moment the run is legitimately in progress.
func (s *MockSession) startTurn(ctx context.Context, message string, hasImages bool) error {
	profile := ResolveMockModel(s.modelID)

	s.mu.Lock()
	turnID := newMockID("turn")
	assistantMsgID := newMockID("msg")
	s.turnToken = turnID
	s.activeTurnID = turnID
	s.activeTurnAssistantMsg = assistantMsgID
	s.status = "running"
	s.lastError = ""
	finished := make(chan struct{})
	s.finished = finished
	turnCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	clientMessageID := s.nextClientMessageID
	s.nextClientMessageID = ""
	s.mu.Unlock()

	// A prompt that asks for a failed turn fails before anything else is emitted: the client's whole
	// failure path (error banner, retry affordance, idle recovery) depends on there being no assistant text.
	if directives := ParseMockDirectives(message); directives.TurnFailure {
		s.mu.Lock()
		s.activeTurnID = ""
		s.activeTurnAssistantMsg = ""
		s.status = "idle"
		s.lastError = "Requested mock turn failure"
		s.cancel = nil
		s.mu.Unlock()
		s.emit(map[string]any{
			"type":   "byspace_turn_failed",
			"turnId": turnID,
			"error":  "Requested mock turn failure",
		})
		close(finished)
		return errors.New("Requested mock turn failure")
	}

	// The prompt is recorded as a user message with the client's own id, so the optimistic bubble the
	// composer already rendered is merged rather than duplicated.
	userItem := sdk.TimelineItem{
		Type:      "user_message",
		MessageID: newMockID("msg"),
		Text:      message,
	}
	if clientMessageID != "" {
		userItem.ClientMessageID = clientMessageID
	}
	s.appendItem(userItem)

	s.emit(map[string]any{
		"type":   "byspace_turn_started",
		"turnId": turnID,
	})

	go func() {
		defer func() {
			s.mu.Lock()
			if s.activeTurnID == turnID {
				s.activeTurnID = ""
				s.activeTurnAssistantMsg = ""
				s.status = "idle"
				s.cancel = nil
			}
			s.mu.Unlock()
			close(finished)
		}()
		s.runScriptedTurn(turnCtx, turnID, assistantMsgID, message, hasImages, profile)
	}()
	return nil
}

// runScriptedTurn emits the turn's content on the model's cadence.
func (s *MockSession) runScriptedTurn(
	ctx context.Context,
	turnID string,
	assistantMsgID string,
	message string,
	hasImages bool,
	profile MockModel,
) {
	interval := time.Duration(profile.IntervalMs) * time.Millisecond

	// Reasoning first: the client renders a collapsible Thinking block, and several specs assert it
	// appears before any assistant text.
	reasoning := "Considering the request."
	s.emitReasoningDelta(reasoning, assistantMsgID)
	if interval > 0 {
		if !mockSleep(ctx, interval) {
			return
		}
	}

	directives := ParseMockDirectives(message)
	if directives.PlanApproval {
		s.emitPlanApprovalRequest(turnID)
		s.completeTurn(turnID, assistantMsgID, "")
		return
	}
	if directives.Questions {
		s.emitQuestionsRequest(turnID)
		s.completeTurn(turnID, assistantMsgID, "")
		return
	}
	if directives.StreamUpdates > 0 {
		// Emitting a fixed count lets the client's coalescer be measured: the spec asserts how many frames
		// survive the window rather than inferring it from timing.
		for index := 0; index < directives.StreamUpdates; index++ {
			if !mockSleep(ctx, interval) {
				return
			}
			s.emitTextDelta("chunk "+strconv.Itoa(index+1)+" ", assistantMsgID)
		}
		s.completeTurn(turnID, assistantMsgID, "streamed "+strconv.Itoa(directives.StreamUpdates)+" updates")
		return
	}
	if directives.ImageMarkdown != "" {
		s.emitTextDelta(directives.ImageMarkdown, assistantMsgID)
		s.completeTurn(turnID, assistantMsgID, directives.ImageMarkdown)
		return
	}

	// A prompt naming the slash command is answered by the provider itself.
	if strings.Contains(strings.ToLower(message), strings.ToLower(MockHandledCommand)) {
		s.emitTextDelta("Handled by the mock provider.", assistantMsgID)
		s.completeTurn(turnID, assistantMsgID, "Handled by the mock provider.")
		return
	}

	body := s.assistantResponse
	if body == "" {
		body = "Acknowledged: " + firstLine(message)
	}
	if hasImages {
		body += "\n\nI can see the attached image."
	}

	// Stream in token-sized pieces rather than one blob: the paced reveal and the coalescing window are
	// both invisible if the text arrives whole.
	for _, token := range splitMockTokens(body) {
		if !mockSleep(ctx, interval) {
			return
		}
		s.emitTextDelta(token, assistantMsgID)
	}
	s.completeTurn(turnID, assistantMsgID, body)
}

// emitReasoningDelta streams one reasoning chunk.
func (s *MockSession) emitReasoningDelta(text, assistantMsgID string) {
	s.appendItem(sdk.TimelineItem{
		Type:      "reasoning",
		Text:      text,
		MessageID: assistantMsgID,
		Status:    "running",
	})
}

// emitTextDelta streams one assistant text chunk.
func (s *MockSession) emitTextDelta(text, assistantMsgID string) {
	s.appendItem(sdk.TimelineItem{
		Type:      "assistant_message",
		Text:      text,
		MessageID: assistantMsgID,
		Status:    "running",
	})
}

// completeTurn closes the assistant message and ends the turn.
func (s *MockSession) completeTurn(turnID, assistantMsgID, fullText string) {
	s.mu.Lock()
	s.lastAssistantText = fullText
	s.mu.Unlock()
	s.appendItem(sdk.TimelineItem{
		Type:      "assistant_message",
		Text:      "",
		MessageID: assistantMsgID,
		Status:    "completed",
	})
	s.emit(map[string]any{
		"type":   "byspace_turn_completed",
		"turnId": turnID,
	})
}

// mockSleep waits, reporting false when the turn was cancelled first.
func mockSleep(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		select {
		case <-ctx.Done():
			return false
		default:
			return true
		}
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// splitMockTokens breaks text into the sub-word pieces the stream emits.
//
// Word plus trailing space, so the client's coalescer sees several frames per sentence and the paced
// reveal has something to smooth.
func splitMockTokens(text string) []string {
	if text == "" {
		return nil
	}
	fields := strings.SplitAfter(text, " ")
	out := make([]string, 0, len(fields))
	for _, field := range fields {
		if field != "" {
			out = append(out, field)
		}
	}
	return out
}

// firstLine returns the first non-empty line, used to acknowledge a prompt without echoing all of it.
func firstLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// emitPlanApprovalRequest asks the client to review a plan.
//
// The plan body is deliberately awkward — `(c)`, a quoted flag, `---` — because three markdown typographer rules
// fire on it. A spec asserts all three render verbatim, which is the only guard against the plan card losing its
// parser configuration.
func (s *MockSession) emitPlanApprovalRequest(turnID string) {
	requestID := "mock-plan-" + turnID
	request := map[string]any{
		"id":          requestID,
		"provider":    MockProviderID,
		"name":        "MockPlanApproval",
		"kind":        "plan",
		"title":       "Plan",
		"description": "Review the proposed plan before implementation starts.",
		"input": map[string]any{
			"plan": "1. Add the (c) README note.\n2. Run --name=\"my repo\".\n3. Verify ---buzz in the diff.",
		},
		"actions": []map[string]any{
			{"id": "implement", "label": "Implement", "behavior": "allow", "variant": "primary", "intent": "implement"},
			{"id": "dismiss", "label": "Dismiss", "behavior": "deny", "variant": "secondary", "intent": "dismiss"},
		},
		"metadata": map[string]any{"source": "mock_plan_approval"},
	}
	s.mu.Lock()
	s.pendingPermissions = append(s.pendingPermissions, request)
	s.mu.Unlock()
	s.emit(map[string]any{
		"type":     "permission_requested",
		"provider": MockProviderID,
		"request":  request,
		"turnId":   turnID,
	})
}

// emitQuestionsRequest asks the user a structured question.
//
// Two questions with options: the client renders them as a picker, and the spec drives it by option label.
func (s *MockSession) emitQuestionsRequest(turnID string) {
	requestID := "mock-questions-" + turnID
	request := map[string]any{
		"id":          requestID,
		"provider":    MockProviderID,
		"name":        "MockQuestions",
		"kind":        "question",
		"title":       "Questions",
		"description": "The agent needs two answers before continuing.",
		"input": map[string]any{
			"questions": []map[string]any{
				{
					"question": "Which environment?",
					"header":   "Environment",
					"options": []map[string]any{
						{"label": "Staging", "description": "Use the staging deployment"},
						{"label": "Production", "description": "Use production"},
					},
					"multiSelect": false,
				},
				{
					"question": "Which checks should run?",
					"header":   "Checks",
					"options": []map[string]any{
						{"label": "Unit", "description": "Unit tests only"},
						{"label": "E2E", "description": "End-to-end only"},
					},
					"multiSelect": true,
				},
			},
		},
		"actions":  []map[string]any{{"id": "submit", "label": "Submit", "behavior": "allow", "variant": "primary"}},
		"metadata": map[string]any{"source": "mock_questions"},
	}
	s.mu.Lock()
	s.pendingPermissions = append(s.pendingPermissions, request)
	s.mu.Unlock()
	s.emit(map[string]any{
		"type":     "permission_requested",
		"provider": MockProviderID,
		"request":  request,
		"turnId":   turnID,
	})
}
