package providers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// mockOnePixelPNG is the image the large-payload directive pads.
const mockOnePixelPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4Kj8AAAAASUVORK5CYII="

var (
	mockUserPromptTag    = regexp.MustCompile(`(?s)<user-prompt>\n(.*?)\n</user-prompt>`)
	mockAttachmentsTag   = regexp.MustCompile(`(?s)<attachments>\n(.*?)\n</attachments>`)
	mockTitleQuotes      = regexp.MustCompile(`^["'` + "`" + `]+|["'` + "`" + `]+$`)
	mockBranchDisallowed = regexp.MustCompile(`[^a-z0-9]+`)
	mockBranchEdgeDashes = regexp.MustCompile(`^-+|-+$`)
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
	// turnStartedAt is the second value of ActiveTurn(): a timestamp, not the assistant message id.
	// The daemon puts it straight into the snapshot's activeTurn.startedAt.
	turnStartedAt string
	// turnStarted tracks whether turn_started went out, so an abort inside the delay window can still emit the
	// pair the client needs to clear its running state.
	turnStarted bool

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

	// Usage the cycle stream reports. Node emits usage_updated per cycle; that event is not in the
	// outbound schema, so the daemon reads it through Usage() on its own poll instead.
	usageCycle  int
	usageTokens int

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

// AppendTimelineItem stores one item in the session's own timeline and returns the entry.
//
// It does not broadcast: the daemon emits the timeline event itself, so a provider cannot re-enter
// its own event loop. The entry deliberately carries no turn id — the daemon uses this for rows that
// belong to no turn, such as the system-error row a failed turn leaves behind.
func (s *MockSession) AppendTimelineItem(item sdk.TimelineItem) sdk.TimelineEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.streamSeq++
	entry := sdk.TimelineEntry{
		Seq:       s.streamSeq,
		SeqEnd:    s.streamSeq,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Item:      sdk.LimitTimelineItemContent(item),
	}
	s.timeline = append(s.timeline, entry)
	return entry
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
// The cycle stream reports Node's formula — cycle * 32 input, one output token per emitted token.
// Paths that never run a cycle (a settled response, a stress turn) fall back to the size of the
// timeline, so the meter still has something to render.
func (s *MockSession) Usage(ctx context.Context) *sdk.AgentUsage {
	s.mu.Lock()
	cycle := s.usageCycle
	tokens := s.usageTokens
	used := 0
	if cycle == 0 {
		for _, entry := range s.timeline {
			used += len(entry.Item.Text)
		}
	}
	s.mu.Unlock()
	if cycle > 0 {
		max := mockContextWindowMaxTokens
		windowUsed := tokens * 2
		return &sdk.AgentUsage{
			InputTokens:             cycle * 32,
			OutputTokens:            tokens,
			ContextWindowMaxTokens:  &max,
			ContextWindowUsedTokens: &windowUsed,
		}
	}
	if used == 0 {
		return nil
	}
	total := mockContextWindowMaxTokens
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
	if s.status != "running" || s.activeTurnID == "" {
		return "", ""
	}
	return s.activeTurnID, s.turnStartedAt
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
	// A command the provider answers itself is out-of-band: it produces a reply without opening a
	// turn, so it neither cancels a running one nor shows the running affordance. Node routes this
	// through tryHandleOutOfBand; the prompt has to match exactly, or a sentence quoting the command
	// would be swallowed. The client message id is consumed here only on this path — startTurn reads
	// it for every turn it opens, so it must stay set on the main path.
	handled := message == MockHandledCommand
	clientMessageID := ""
	if handled {
		clientMessageID = s.nextClientMessageID
		s.nextClientMessageID = ""
	}
	s.mu.Unlock()

	if handled {
		// No provider message id on this row. Node records a daemon-handled command through
		// recordSubmittedPrompt with only the client id, and the client renders the rewind trigger on
		// `capabilities && messageId` — so a message the provider never took ownership of has nothing
		// to rewind to and must not offer one.
		s.appendItem(sdk.TimelineItem{
			Type:            "user_message",
			ClientMessageID: clientMessageID,
			Text:            message,
		})
		s.appendItem(sdk.TimelineItem{
			Type:      "assistant_message",
			MessageID: newMockID("msg"),
			Text:      mockHandledCommandReply,
		})
		s.mu.Lock()
		s.lastAssistantText = mockHandledCommandReply
		s.mu.Unlock()
		return nil
	}

	return s.startTurn(ctx, message)
}

// Steer appends to the running turn.
func (s *MockSession) Steer(ctx context.Context, message string, images []sdk.ImageContent) error {
	s.mu.Lock()
	if s.remainingSteerFailures > 0 {
		s.remainingSteerFailures--
		s.mu.Unlock()
		// The spec asserts this exact message.
		return errors.New("Requested mock steer transport failure")
	}
	active := s.activeTurnID != ""
	clientMessageID := s.nextClientMessageID
	s.nextClientMessageID = ""
	s.mu.Unlock()
	if !active {
		// No turn to join: the caller's message becomes its own turn, which is what the daemon does when
		// steer has nothing to attach to.
		s.mu.Lock()
		s.nextClientMessageID = clientMessageID
		s.mu.Unlock()
		return s.Prompt(ctx, message, images)
	}
	s.appendItem(sdk.TimelineItem{
		Type:            "user_message",
		MessageID:       newMockID("msg"),
		ClientMessageID: clientMessageID,
		Text:            message,
	})
	return nil
}

// Abort cancels the running turn.
//
// It has to do more than stop the emitter: the client ends the "running" state on turn_canceled, and a turn that just
// stops producing events leaves the row spinning forever. Node emits the same event and clears its active turn.
func (s *MockSession) Abort(ctx context.Context) error {
	s.mu.Lock()
	cancel := s.cancel
	turnID := s.activeTurnID
	started := s.turnStarted
	s.mu.Unlock()
	if turnID == "" {
		return nil
	}
	if cancel != nil {
		cancel()
	}
	s.mu.Lock()
	s.pendingPermissions = nil
	s.mu.Unlock()
	// State goes before the event: the daemon snapshots Status() and ActiveTurn() into the agent_update
	// it broadcasts beside turn_canceled, and a snapshot that still names a turn re-opens it on the client.
	if !s.endTurn(turnID) {
		return nil
	}
	// A turn cancelled inside the delay window never emitted turn_started. The client still ends the run on
	// turn_canceled, but it needs the pair to leave the row clean, and emitting only the cancel left the running
	// affordance up in the "interrupt before the first turn" case.
	if !started {
		s.emit(map[string]any{
			"type":   "byspace_turn_started",
			"turnId": turnID,
		})
	}
	s.emit(map[string]any{
		"type":   "byspace_turn_canceled",
		"turnId": turnID,
		"reason": "Interrupted",
	})
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
	// Matched on `id`, which is what the request carries and what the client answers with. Comparing
	// `requestId` (the RPC envelope's field) removed nothing, so a dismissed modal stayed pending.
	var answered map[string]any
	remaining := make([]map[string]any, 0, len(s.pendingPermissions))
	for _, request := range s.pendingPermissions {
		if id, _ := request["id"].(string); id == requestID {
			answered = request
			continue
		}
		remaining = append(remaining, request)
	}
	s.pendingPermissions = remaining
	turnID := s.activeTurnID
	s.mu.Unlock()

	if answered == nil || turnID == "" {
		return nil
	}
	// The request owned the turn: a plan approval or a question set parks it until answered, so
	// answering is what ends it. Leaving the turn open kept the running affordance up after the
	// modal closed.
	kind, _ := answered["kind"].(string)
	reply := "Synthetic plan approval resolved"
	if kind == "question" {
		reply = "Synthetic questions resolved"
	}
	s.completeTurn(turnID, reply, nil)
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
func (s *MockSession) startTurn(ctx context.Context, message string) error {
	profile := ResolveMockModel(s.modelID)

	s.mu.Lock()
	turnID := newMockID("turn")
	assistantMsgID := newMockID("msg")
	s.turnToken = turnID
	s.activeTurnID = turnID
	s.activeTurnAssistantMsg = assistantMsgID
	s.turnStartedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.status = "running"
	s.lastError = ""
	// Per-turn, not per-session: a stale true from the previous turn makes an abort inside this
	// turn's delay window skip the turn_started it still owes the client.
	s.turnStarted = false
	finished := make(chan struct{})
	s.finished = finished
	turnCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	clientMessageID := s.nextClientMessageID
	s.nextClientMessageID = ""
	s.mu.Unlock()

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

	// Ordering is a contract the client is written against. By default the turn starts first and the echoed
	// user message follows; a prompt asking for the echo first exercises the opposite case, which is where the
	// duplicate-bubble bugs live. Both go through the same emit path so the client cannot tell them apart
	// except by sequence.
	directives := ParseMockDirectives(message)

	// "Emit N assistant messages before synthetic user message" is its own turn shape in node, not a
	// prefix on the default one: it streams N pre-echo messages, then the user message, then finishes
	// right away with no cycle stream. Falling through to the cycle left the turn running for the whole
	// model duration (60s on one-minute-stream) after a shape that node completes immediately, so the
	// agent never went idle and expectVisibleAgentSurfacesIdle watched a spinner that never stopped.
	if directives.AssistantBeforeUser > 0 {
		go func() {
			defer func() {
				s.endTurn(turnID)
				close(finished)
			}()
			s.emit(map[string]any{
				"type":   "byspace_turn_started",
				"turnId": turnID,
			})
			s.mu.Lock()
			s.turnStarted = true
			s.mu.Unlock()
			for index := 0; index < directives.AssistantBeforeUser; index++ {
				s.appendItem(sdk.TimelineItem{
					Type:      "assistant_message",
					Text:      "Synthetic pre-echo message " + strconv.Itoa(index+1),
					MessageID: fmt.Sprintf("%s-%d", assistantMsgID, index+1),
				})
			}
			s.appendItem(userItem)
			s.completeTurn(turnID, "Synthetic pre-echo stream complete", nil)
		}()
		return nil
	}

	startedFirst := !directives.UserMessageFirst
	if startedFirst {
		s.emit(map[string]any{
			"type":   "byspace_turn_started",
			"turnId": turnID,
		})
		s.mu.Lock()
		s.turnStarted = true
		s.mu.Unlock()
	}

	// A withheld prompt never runs a turn body: the session holds it open until something cancels
	// it, which is the window "interrupt before the first turn" exercises. The user's row still has
	// to land, carrying the client's own id: that echo is what retires the optimistic bubble's
	// pending state, and without it the row stays aria-busy and the tab keeps spinning after the
	// interrupt. Node supplies this from the daemon's recordSubmittedPrompt; Go's providers each
	// echo their own user message, so the mock does it here.
	if directives.WithholdUserMessage {
		s.appendItem(userItem)
		go func() {
			defer func() {
				s.endTurn(turnID)
				close(finished)
			}()
			<-turnCtx.Done()
		}()
		return nil
	}

	// A delayed echo holds the whole turn back, not just the message: node only schedules the body after the echo
	// lands, so the stream cannot outrun its own prompt. The window before it is what the "interrupt before the
	// first turn" specs exercise — the session is running, nothing has been echoed, and an abort has to leave
	// nothing behind.
	if directives.UserMessageDelayMs == 0 {
		s.appendItem(userItem)
		if !startedFirst {
			s.emit(map[string]any{
				"type":   "byspace_turn_started",
				"turnId": turnID,
			})
			s.mu.Lock()
			s.turnStarted = true
			s.mu.Unlock()
		}
	}

	go func() {
		defer func() {
			// A backstop for the paths that leave the turn standing (a cancelled sleep, an early return).
			// completeTurn and Abort already cleared it; endTurn reports false and this only closes finished.
			s.endTurn(turnID)
			close(finished)
		}()
		if directives.UserMessageDelayMs > 0 {
			if !mockSleep(turnCtx, time.Duration(directives.UserMessageDelayMs)*time.Millisecond) {
				return
			}
			s.mu.Lock()
			if s.activeTurnID != turnID {
				s.mu.Unlock()
				return
			}
			s.mu.Unlock()
			s.appendItem(userItem)
			if !startedFirst {
				s.emit(map[string]any{
					"type":   "byspace_turn_started",
					"turnId": turnID,
				})
				s.mu.Lock()
				s.turnStarted = true
				s.mu.Unlock()
			}
		}
		s.runScriptedTurn(turnCtx, turnID, assistantMsgID, message, profile, directives)
	}()
	return nil
}

// runScriptedTurn emits the turn's content on the model's cadence.
//
// Branch order mirrors node's scheduleTurn: each phrase a spec can send selects one shape, and the
// default is the cycle stream that runs until the model's duration elapses.
func (s *MockSession) runScriptedTurn(
	ctx context.Context,
	turnID string,
	assistantMsgID string,
	message string,
	profile MockModel,
	directives MockDirectives,
) {
	interval := time.Duration(profile.IntervalMs) * time.Millisecond

	if directives.SteeringReplay != "" {
		s.runSteeringReplayTurn(ctx, turnID, assistantMsgID, directives.SteeringReplay)
		return
	}
	if directives.TurnFailure {
		// The failure is a turn outcome, not a rejected prompt: the client surfaces it as a system-error
		// card and keeps the run's idle-recovery path intact.
		s.failTurn(turnID)
		return
	}
	if s.streamingResponse != "" {
		s.runStreamingAssistantTurn(ctx, turnID, assistantMsgID, s.streamingResponse)
		return
	}
	if s.assistantResponse != "" {
		s.emitSettledAssistantTurn(turnID, assistantMsgID, s.assistantResponse)
		return
	}
	if directives.StructuredBranch {
		if branch := structuredBranchName(message); branch != "" {
			s.emitSettledAssistantTurn(turnID, assistantMsgID, branch)
			return
		}
	}
	if directives.ImageMarkdown != "" {
		s.emitSettledAssistantTurn(turnID, assistantMsgID, directives.ImageMarkdown)
		return
	}
	if directives.PlanApproval {
		// The turn stays open until the request is answered; RespondToPermission closes it.
		s.emitPlanApprovalRequest(turnID)
		return
	}
	if directives.CustomMessage {
		s.appendItem(sdk.TimelineItem{
			Type:       "custom_message",
			CustomType: "background-exit",
			Display:    true,
			Content:    buildSyntheticCustomMessageContent(),
		})
		s.completeTurn(turnID, "Synthetic custom message emitted", nil)
		return
	}
	if directives.Notification {
		s.appendItem(sdk.TimelineItem{
			Type:    "notification",
			Level:   "info",
			Message: "## Historian recovery\n\nHistorian previously failed 3 time(s), so Magic Context is retrying history comparting immediately after restart.",
		})
		s.completeTurn(turnID, "Synthetic notification emitted", nil)
		return
	}
	if directives.ToolCallTodo {
		// One running row and one completed row under the same call id: the panel reads the todo list
		// out of the completion's detail, and an empty list renders as a card with no rows.
		todos := []map[string]any{
			{"content": "Setup scaffold", "status": "completed"},
			{"content": "Implement tool call parser", "status": "completed"},
			{"content": "Verify Tasks track button in browser", "status": "in_progress"},
			{"content": "Submit PR", "status": "pending"},
		}
		callID := "mock-todowrite-" + turnID
		s.appendItem(sdk.TimelineItem{
			Type: "tool_call", CallID: callID, Name: "todowrite", Status: "running",
			Detail: map[string]any{"type": "unknown", "input": map[string]any{"todos": todos}, "output": nil},
		})
		s.appendItem(sdk.TimelineItem{
			Type: "tool_call", CallID: callID, Name: "todowrite", Status: "completed",
			Detail: map[string]any{"type": "unknown", "input": map[string]any{"todos": todos}, "output": nil},
		})
		s.completeTurn(turnID, "Synthetic todowrite tool call emitted", nil)
		return
	}
	if directives.Questions {
		s.emitQuestionsRequest(turnID, directives.QuestionFreeWrite)
		return
	}
	if directives.LargePayloadKind != "" {
		s.emitLargePayloadTurn(turnID, assistantMsgID, directives.LargePayloadKind, directives.LargePayloadBytes)
		return
	}
	if directives.StreamUpdates > 0 {
		s.emitStressTurn(turnID, assistantMsgID, directives.StreamUpdates, directives.StreamCoalesced)
		return
	}

	s.runCycleStream(ctx, turnID, assistantMsgID, profile, interval)
}

// failTurn ends the turn with a failure. Node's scripted failure resolves the run normally; the
// failure reaches the client as a turn_failed event, which the daemon turns into a system-error
// timeline entry.
func (s *MockSession) failTurn(turnID string) {
	s.mu.Lock()
	s.lastError = mockProviderFailureMessage
	s.mu.Unlock()
	s.endTurn(turnID)
	s.emit(map[string]any{
		"type":   "byspace_turn_failed",
		"turnId": turnID,
		"error":  mockProviderFailureMessage,
	})
}

// runCycleStream is the default turn: cycles of scripted content until the model's duration
// elapses, closed by the end-of-stream marker.
//
// The duration is the point. A turn that answers once and ends cannot be interrupted, and most of
// the specs using this provider exist to exercise a turn that is still running.
func (s *MockSession) runCycleStream(
	ctx context.Context,
	turnID string,
	assistantMsgID string,
	profile MockModel,
	interval time.Duration,
) {
	started := time.Now()
	duration := time.Duration(profile.DurationMs) * time.Millisecond
	var queue []mockCycleEvent
	cycle := 0
	burstIndex := 0
	emitted := 0

	for {
		if time.Since(started) >= duration {
			break
		}
		events := 1
		gap := interval
		if profile.Burst != nil {
			events = nextMockBurstSize(profile.Burst, burstIndex)
			burstIndex++
			gap = time.Duration(profile.Burst.GapMs) * time.Millisecond
		}
		for count := 0; count < events; count++ {
			if len(queue) == 0 {
				cycle++
				s.mu.Lock()
				s.usageCycle = cycle
				repeat := s.reasoningRepeat
				s.mu.Unlock()
				if profile.Burst != nil {
					queue = buildMockBurstyQueue(cycle)
				} else {
					queue = buildMockCycleQueue(turnID, cycle, repeat)
				}
			}
			event := queue[0]
			queue = queue[1:]
			if !s.dispatchCycleEvent(turnID, assistantMsgID, event) {
				return
			}
			emitted++
		}
		s.mu.Lock()
		s.usageTokens = emitted
		s.mu.Unlock()
		if gap > 0 && !mockSleep(ctx, gap) {
			return
		}
	}

	s.appendItem(sdk.TimelineItem{
		Type:      "assistant_message",
		Text:      mockSyntheticStreamEnd,
		MessageID: assistantMsgID,
	})
	s.completeTurn(turnID, "Synthetic load test complete", mockCycleUsage(cycle, emitted))
}

// dispatchCycleEvent emits one cycle step, reporting false when the turn ended underneath it.
func (s *MockSession) dispatchCycleEvent(turnID, assistantMsgID string, event mockCycleEvent) bool {
	switch event.Kind {
	case "assistant_token":
		s.appendItem(sdk.TimelineItem{
			Type:      "assistant_message",
			Text:      event.Text,
			MessageID: assistantMsgID,
		})
	case "reasoning_token":
		// No messageId: the protocol's reasoning branch carries only type and text, and the client
		// appends to the open thought instead of looking the item up.
		s.appendItem(sdk.TimelineItem{Type: "reasoning", Text: event.Text})
	case "tool_running":
		s.appendItem(mockToolCallItem(event, "running"))
	case "tool_completed":
		s.appendItem(mockToolCallItem(event, "completed"))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activeTurnID == turnID
}

// runStreamingAssistantTurn streams a configured response token by token on its own interval.
func (s *MockSession) runStreamingAssistantTurn(
	ctx context.Context,
	turnID string,
	assistantMsgID string,
	finalText string,
) {
	interval := time.Duration(s.streamingIntervalMs) * time.Millisecond
	for _, token := range mockTokenize(finalText) {
		s.appendItem(sdk.TimelineItem{
			Type:      "assistant_message",
			Text:      token,
			MessageID: assistantMsgID,
		})
		if !mockSleep(ctx, interval) {
			return
		}
	}
	s.completeTurn(turnID, finalText, nil)
}

// emitSettledAssistantTurn delivers a response whole, in one item.
func (s *MockSession) emitSettledAssistantTurn(turnID, assistantMsgID, finalText string) {
	s.appendItem(sdk.TimelineItem{
		Type:      "assistant_message",
		Text:      finalText,
		MessageID: assistantMsgID,
	})
	s.completeTurn(turnID, finalText, nil)
}

// emitStressTurn produces a fixed number of updates in one burst.
//
// The shape differs by directive: coalesced updates arrive as assistant messages, the rest as todo
// items. Specs count arrival frames, so both shapes land unpaced rather than one per interval.
func (s *MockSession) emitStressTurn(turnID, assistantMsgID string, count int, coalesced bool) {
	for index := 0; index < count; index++ {
		if coalesced {
			s.appendItem(sdk.TimelineItem{
				Type:      "assistant_message",
				Text:      "stress-update-" + strconv.Itoa(index),
				MessageID: assistantMsgID,
			})
			continue
		}
		s.appendItem(sdk.TimelineItem{
			Type: "todo",
			Items: []sdk.TaskItem{{
				Text:      "stress-update-" + strconv.Itoa(index),
				Completed: index%2 == 0,
			}},
		})
	}
	s.completeTurn(turnID, "Synthetic agent stream stress complete", mockFixedUsage(1, count))
}

// emitLargePayloadTurn produces one oversized item of the requested kind.
func (s *MockSession) emitLargePayloadTurn(turnID, assistantMsgID, kind string, bytes int) {
	payload := buildMockRepeatedPayload(bytes, kind)
	switch kind {
	case "diff":
		s.appendItem(sdk.TimelineItem{
			Type: "tool_call", CallID: turnID + ":edit:large", Name: "edit", Status: "completed",
			Detail: map[string]any{
				"type": "edit", "filePath": "src/large-diff.ts",
				"unifiedDiff": "diff --git a/src/large-diff.ts b/src/large-diff.ts\n" + payload,
			},
		})
	case "file":
		s.appendItem(sdk.TimelineItem{
			Type: "tool_call", CallID: turnID + ":read:large", Name: "read", Status: "completed",
			Detail: map[string]any{
				"type": "read", "filePath": "src/large-file.txt", "content": payload,
			},
		})
	default:
		image := make([]byte, 0, max(bytes, len(mockOnePixelPNG)))
		image = append(image, mockOnePixelPNG...)
		for len(image) < bytes {
			image = append(image, 0)
		}
		s.appendItem(sdk.TimelineItem{
			Type: "assistant_message", MessageID: assistantMsgID,
			Text: "![Synthetic image](data:image/png;base64," + base64.StdEncoding.EncodeToString(image) + ")",
		})
	}
	s.completeTurn(turnID, "Synthetic large payload complete", mockFixedUsage(1, bytes))
}

// runSteeringReplayTurn replays a provider-shaped foreground shell call: a long-running bash whose
// completion arrives after the steering window, which is what the steering specs watch.
func (s *MockSession) runSteeringReplayTurn(ctx context.Context, turnID, assistantMsgID, shape string) {
	if shape == "codex" {
		s.appendItem(sdk.TimelineItem{
			Type: "assistant_message", MessageID: assistantMsgID,
			Text: "Running the foreground command.",
		})
	}
	callID := turnID + ":steering-replay-shell"
	detail := map[string]any{"type": "shell", "command": "sleep 5", "cwd": "/tmp/byspace-mock-load"}
	s.appendItem(sdk.TimelineItem{
		Type: "tool_call", CallID: callID, Name: "bash", Status: "running", Detail: detail,
	})
	if !mockSleep(ctx, 5*time.Second) {
		return
	}
	s.appendItem(sdk.TimelineItem{
		Type: "tool_call", CallID: callID, Name: "bash", Status: "completed",
		Detail: mergeMockDetail(detail, map[string]any{"output": "", "exitCode": 0}),
	})
	s.appendItem(sdk.TimelineItem{
		Type: "assistant_message", MessageID: assistantMsgID,
		Text: "Foreground command completed after steering.",
	})
	s.completeTurn(turnID, "Foreground command completed after steering.", nil)
}

// mockFixedUsage is the usage the stress and large-payload turns report.
func mockFixedUsage(input, output int) *sdk.AgentUsage {
	maxTokens := mockContextWindowMaxTokens
	used := output
	return &sdk.AgentUsage{
		InputTokens:             input,
		OutputTokens:            output,
		ContextWindowUsedTokens: &used,
		ContextWindowMaxTokens:  &maxTokens,
	}
}

// mockCycleUsage is the usage the cycle stream reports, matching node's per-cycle formula.
func mockCycleUsage(cycle, emitted int) *sdk.AgentUsage {
	return mockFixedUsage(cycle*32, emitted)
}

// buildMockRepeatedPayload fills a byte budget with recognizable lines.
func buildMockRepeatedPayload(bytes int, prefix string) string {
	line := prefix + " " + strings.Repeat("x", 96) + "\n"
	var out strings.Builder
	for out.Len() < bytes {
		out.WriteString(line)
	}
	text := out.String()
	if len(text) > bytes {
		text = text[:bytes]
	}
	return text
}

// buildSyntheticCustomMessageContent mirrors a real extension-injected custom_message: a summary
// line plus one entry per finished task, long enough to exercise the collapsed preview.
func buildSyntheticCustomMessageContent() string {
	return strings.Join([]string{
		"2 background tasks finished:",
		`[bg_2bc2494e69199b6a] cd /Users/example/workspace/project && npm run dev:server > /tmp/dev-server.log 2>&1 & echo "server pid: $!" exited with code 0. Last line: server pid: 43229 Output: /tmp/pi-background-terminal/bg_2bc2494e69199b6a.log`,
		"[bg_eb37efed6b1968a8] cd /Users/example/workspace/project && npm run dev:app -- --port 8081 exited with code 0. Last line: app pid: 44822 Output: /tmp/pi-background-terminal/bg_eb37efed6b1968a8.log",
	}, "\n")
}

// completeTurn ends the turn and reports it, carrying the usage the turn accumulated.
func (s *MockSession) completeTurn(turnID, fullText string, usage *sdk.AgentUsage) {
	s.mu.Lock()
	token := s.turnToken
	s.lastAssistantText = fullText
	s.mu.Unlock()
	s.endTurn(turnID)
	event := map[string]any{
		"type":   "byspace_turn_completed",
		"turnId": turnID,
		// The daemon drops a completion whose token belongs to an older turn, so a slow cycle
		// stream cannot end the turn that replaced it.
		"turnToken": token,
	}
	if usage != nil {
		event["usage"] = usage
	}
	s.emit(event)
}

// endTurn clears the session's turn state, reporting whether it owned this turn.
//
// It runs before the terminal event is emitted, the way pi does it. The daemon builds the agent
// snapshot it broadcasts alongside turn_completed out of Status() and ActiveTurn(), and the client
// re-opens a closed turn from a snapshot that still names one — emitting first left the spinner up
// after every completed turn.
func (s *MockSession) endTurn(turnID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeTurnID != turnID {
		return false
	}
	s.activeTurnID = ""
	s.activeTurnAssistantMsg = ""
	s.turnStartedAt = ""
	s.status = "idle"
	s.turnStarted = false
	s.cancel = nil
	return true
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
func (s *MockSession) emitQuestionsRequest(turnID string, freeWrite bool) {
	requestID := "mock-questions-" + turnID
	request := map[string]any{
		"id":       requestID,
		"provider": MockProviderID,
		"name":     "MockQuestions",
		"kind":     "question",
		"title":    "Questions",
		"input": map[string]any{
			"questions": mockQuestions(freeWrite),
		},
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

// mockQuestions is the question set the prompt asks for. The two shapes are what
// question-prompt-pagination.spec.ts drives: three selectable questions by default, two free-write
// ones when the prompt names them.
func mockQuestions(freeWrite bool) []map[string]any {
	if freeWrite {
		return []map[string]any{
			{
				"question":    "What is the GitHub private repo URL to push to?",
				"header":      "repoUrl",
				"options":     []map[string]any{},
				"multiSelect": false,
				"placeholder": "git@github.com:user/repo.git",
			},
			{
				"question":    "What should the first commit message be?",
				"header":      "commitMessage",
				"options":     []map[string]any{},
				"multiSelect": false,
				"placeholder": "Initial commit",
			},
		}
	}
	return []map[string]any{
		{
			"question":    "Which surface should this apply to?",
			"header":      "surface",
			"options":     []map[string]any{{"label": "App"}, {"label": "Desktop"}},
			"multiSelect": false,
		},
		{
			"question":    "Which rollout should we use?",
			"header":      "rollout",
			"options":     []map[string]any{{"label": "Immediately"}, {"label": "Behind feature flag"}},
			"multiSelect": false,
		},
		{
			"question":    "What success criteria should we use?",
			"header":      "success",
			"options":     []map[string]any{},
			"multiSelect": false,
			"placeholder": "Describe success...",
		},
	}
}

// structuredBranchName answers the workspace auto-name request, which asks for JSON and nothing
// else: the daemon derives a title and a branch slug from the prompt.
func structuredBranchName(message string) string {
	seed := ""
	if match := mockUserPromptTag.FindStringSubmatch(message); match != nil {
		seed = strings.TrimSpace(match[1])
	} else if match := mockAttachmentsTag.FindStringSubmatch(message); match != nil {
		seed = strings.TrimSpace(match[1])
	}
	first := ""
	for _, line := range strings.Split(seed, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			first = trimmed
			break
		}
	}
	if first == "" {
		first = "Mock task"
	}
	title := strings.TrimSpace(mockTitleQuotes.ReplaceAllString(first, ""))
	title = strings.Join(strings.Fields(title), " ")
	if len(title) > 80 {
		title = strings.TrimSpace(title[:80])
	}
	if title == "" {
		title = "Mock task"
	}
	branch := strings.ToLower(title)
	branch = mockBranchDisallowed.ReplaceAllString(branch, "-")
	branch = mockBranchEdgeDashes.ReplaceAllString(branch, "")
	if len(branch) > 100 {
		branch = branch[:100]
	}
	if branch == "" {
		branch = "mock-task"
	}
	encoded, err := json.Marshal(map[string]string{"title": title, "branch": branch})
	if err != nil {
		return ""
	}
	return string(encoded)
}

// RewindConversation truncates the scripted history back to its first echoed prompt.
//
// Node's mock does exactly this (keepFirstUserMessageHistory): a conversation rewind drops every
// entry except the first user_message, which is what the ui-contract spec asserts — one user row
// left, the assistant content gone. A configured mockRewindError fails first, exercising the
// client's error path without touching the timeline.
func (s *MockSession) RewindConversation(_ context.Context, messageID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rewindError != "" {
		return errors.New(s.rewindError)
	}
	if err := s.validateRewindTargetLocked(messageID); err != nil {
		return err
	}
	// A rewind interrupts whatever turn is running; clear it so the client leaves the running state.
	if s.activeTurnID != "" {
		s.activeTurnID = ""
		s.activeTurnAssistantMsg = ""
		s.turnStartedAt = ""
		s.status = "idle"
		s.turnStarted = false
		if s.cancel != nil {
			s.cancel()
			s.cancel = nil
		}
	}
	kept := make([]sdk.TimelineEntry, 0, 1)
	for _, entry := range s.timeline {
		if entry.Item.Type == "user_message" {
			kept = append(kept, entry)
			break
		}
	}
	// Renumber what survived and rewind the counter with it. A rewind drops every row after the
	// target, and leaving their seq numbers behind would punch a hole in the middle of the range
	// that no later row can fill: the next row continues from the old counter, so a client sitting
	// on the retained row sees a gap, drops every event after it, and asks for a catch-up that
	// starts inside the hole. Compacting the range means the next row continues right after the
	// retained one, so clients accept it without a rehydration.
	for i, entry := range kept {
		entry.Seq = i + 1
		entry.SeqEnd = i + 1
		kept[i] = entry
	}
	s.streamSeq = len(kept)
	s.timeline = kept
	return nil
}

// validateRewindTargetLocked rejects a rewind to a message this session never echoed. The client
// sends the provider message id; an older client that sends a cursor reaches the daemon as the
// message text, so both are accepted.
func (s *MockSession) validateRewindTargetLocked(messageID string) error {
	target := strings.TrimSpace(messageID)
	if target == "" {
		return errors.New("mock rewind needs a message id")
	}
	for _, entry := range s.timeline {
		if entry.Item.Type != "user_message" {
			continue
		}
		if entry.Item.MessageID == target || entry.Item.Text == target {
			return nil
		}
	}
	return fmt.Errorf("Mock rewind target %s was not found in session history", target)
}

// TreeEntryForMessage is pi's text→tree-entry mapping. The mock keys its timeline by the message id
// the client already holds, so there is nothing to resolve: reporting not-found makes the daemon use
// the target verbatim.
func (s *MockSession) TreeEntryForMessage(string) (string, bool) {
	return "", false
}
