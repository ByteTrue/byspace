package providers

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// eventTypes lists the provider event types in emission order.
func eventTypes(events []map[string]any) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		if typ, _ := event["type"].(string); typ != "" {
			out = append(out, typ)
		}
	}
	return out
}

func hasEvent(events []map[string]any, want string) bool {
	for _, event := range events {
		if typ, _ := event["type"].(string); typ == want {
			return true
		}
	}
	return false
}

// timelineTexts is the concatenated text of every item of one type.
func timelineTexts(session *MockSession, itemType string) string {
	var parts []string
	for _, entry := range session.Timeline() {
		if entry.Item.Type == itemType {
			parts = append(parts, entry.Item.Text)
		}
	}
	return strings.Join(parts, "")
}

func decodeItem(t *testing.T, item sdk.TimelineItem) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

// The default turn is the cycle stream: it runs until the model's duration elapses rather than
// answering once. A turn that ends immediately cannot be interrupted, which is what most of the
// specs using this provider exist to exercise.
func TestMockDefaultTurnStreamsTheCycleUntilItsDuration(t *testing.T) {
	session, events := newTestMockSession(t, "e2e-fast-stream")
	start := time.Now()
	if err := session.Prompt(context.Background(), "Look at the scroll anchor behavior.", nil); err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()

	if elapsed := time.Since(start); elapsed < 1500*time.Millisecond {
		t.Fatalf("the turn finished after %v; the model's duration is 2s", elapsed)
	}
	text := timelineTexts(session, "assistant_message")
	if !strings.Contains(text, "## Cycle 1") {
		t.Fatalf("the cycle heading never streamed; got %q", text)
	}
	if !strings.Contains(text, "(end of synthetic stream)") {
		t.Fatalf("the stream end marker never landed; got %q", text)
	}
	// The cycle's prose lands first; its tool calls come after roughly 160 tokens, which a 2s
	// model at a 20ms interval never reaches. buildMockCycleQueue covers the tool shape directly.
	var tokens int
	for _, entry := range session.Timeline() {
		if entry.Item.Type == "assistant_message" {
			tokens++
		}
	}
	if tokens < 50 {
		t.Fatalf("assistant tokens = %d, want the cycle's prose streamed in pieces", tokens)
	}
	if !hasEvent(*events, "byspace_turn_completed") {
		t.Fatalf("no turn_completed: %v", eventTypes(*events))
	}
	// A completion that leaves the session running re-arms the client's spinner.
	if got := session.Status(); got != "idle" {
		t.Fatalf("status = %q, want idle", got)
	}
	if turnID, _ := session.ActiveTurn(); turnID != "" {
		t.Fatalf("the finished turn is still active: %q", turnID)
	}
}

// The cycle's codemode call carries its nested calls by metadata, which is how the client folds
// them under the parent instead of presenting them as calls of their own.
func TestMockCycleNestsItsCodemodeCalls(t *testing.T) {
	queue := buildMockCycleQueue("turn-1", 1, 1)
	var parentCallID string
	var nested int
	var summary map[string]any
	var names []string
	for _, event := range queue {
		if event.Kind != "tool_running" && event.Kind != "tool_completed" {
			continue
		}
		names = append(names, event.Name)
		if event.Name == "codemode" {
			if event.Kind == "tool_running" {
				parentCallID = event.CallID
				continue
			}
			summary, _ = event.Metadata["nestedSummary"].(map[string]any)
			continue
		}
		if parent, _ := event.Metadata["parentToolCallId"].(string); parent != "" {
			if parent != parentCallID {
				t.Fatalf("nested call points at %q, want %q", parent, parentCallID)
			}
			nested++
		}
	}
	if parentCallID == "" {
		t.Fatal("the cycle never produced its codemode call")
	}
	if nested != 6 {
		t.Fatalf("nested codemode calls = %d, want 6 (3 running + 3 completed)", nested)
	}
	if len(summary) == 0 {
		t.Fatal("no nestedSummary on the codemode completion")
	}
	// The badges the spec looks for come from these tool names, not from prose.
	for _, want := range []string{"read", "grep", "edit", "bash", "codemode", "find"} {
		var found bool
		for _, name := range names {
			if name == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("the cycle produced no %q call: %v", want, names)
		}
	}
	// Usage closes the cycle, which is what the context meter reads.
	if last := queue[len(queue)-1]; last.Kind != "usage" {
		t.Fatalf("the cycle ends with %q, want usage", last.Kind)
	}
}

// A withheld prompt lands its user message — carrying the client's own id, which is what retires
// the optimistic bubble's pending state — but never runs a turn body. The turn stays open until
// something cancels it, and the cancellation still has to reach the client as turn_canceled.
func TestMockWithholdsTheTurnBodyUntilInterrupted(t *testing.T) {
	session, events := newTestMockSession(t, "one-minute-stream")
	ctx := context.Background()
	session.SetNextClientMessageID("client-withhold-1")
	if err := session.Prompt(ctx, "Withhold synthetic user message until interrupted.", nil); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	if got := session.Status(); got != "running" {
		t.Fatalf("status = %q, want running while the prompt is withheld", got)
	}
	// The echo has to carry the client's id, or the optimistic row never leaves aria-busy.
	var echoed bool
	for _, entry := range session.Timeline() {
		if entry.Item.Type == "user_message" && entry.Item.ClientMessageID == "client-withhold-1" {
			echoed = true
		}
	}
	if !echoed {
		t.Fatalf("the withheld prompt never landed its user message: %v", timelineTypes(session))
	}
	// Withholding means no turn body: no assistant output streamed before the interrupt.
	if contains(timelineTypes(session), "assistant_message") {
		t.Fatalf("the withheld turn produced assistant output: %v", timelineTypes(session))
	}
	if err := session.Abort(ctx); err != nil {
		t.Fatal(err)
	}
	if !hasEvent(*events, "byspace_turn_canceled") {
		t.Fatalf("the cancellation never reached the client: %v", eventTypes(*events))
	}
	if got := session.Status(); got != "idle" {
		t.Fatalf("status = %q, want idle after the interrupt", got)
	}
}

// ActiveTurn's second value is a timestamp, not the assistant message id: the daemon puts it
// straight into the snapshot's activeTurn.startedAt.
func TestMockActiveTurnReportsATimestamp(t *testing.T) {
	session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: "one-minute-stream"})
	ctx := context.Background()
	if err := session.Prompt(ctx, "Keep this turn open.", nil); err != nil {
		t.Fatal(err)
	}
	turnID, startedAt := session.ActiveTurn()
	if turnID == "" {
		t.Fatal("no active turn")
	}
	if _, err := time.Parse(time.RFC3339Nano, startedAt); err != nil {
		t.Fatalf("activeTurn startedAt = %q, not a timestamp: %v", startedAt, err)
	}
	// Once the turn is over the snapshot must not name one, or the client re-opens it.
	_ = session.Abort(ctx)
	if id, started := session.ActiveTurn(); id != "" || started != "" {
		t.Fatalf("active turn survived the abort: %q %q", id, started)
	}
}

// A scripted failure is a turn outcome the client renders, not a rejected prompt.
func TestMockTurnFailureReachesTheClientAsAnEvent(t *testing.T) {
	session, events := newTestMockSession(t, "e2e-fast-stream")
	if err := session.Prompt(context.Background(), "Emit a synthetic turn failure.", nil); err != nil {
		t.Fatalf("the prompt was rejected: %v", err)
	}
	waitCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()
	if !hasEvent(*events, "byspace_turn_failed") {
		t.Fatalf("no turn_failed event: %v", eventTypes(*events))
	}
	if got := session.LastError(); got != mockProviderFailureMessage {
		t.Fatalf("lastError = %q, want %q", got, mockProviderFailureMessage)
	}
}

// The question set the specs drive: three selectable questions by default, two free-write ones when
// the prompt names them.
func TestMockQuestionShapes(t *testing.T) {
	cases := []struct {
		prompt       string
		wantCount    int
		wantQuestion string
		wantPlace    string
	}{
		{"Emit synthetic questions.", 3, "Which surface should this apply to?", ""},
		{
			"Emit synthetic questions: two free-write questions.",
			2,
			"What is the GitHub private repo URL to push to?",
			"git@github.com:user/repo.git",
		},
	}
	for _, testCase := range cases {
		session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: "e2e-fast-stream"})
		ctx := context.Background()
		if err := session.Prompt(ctx, testCase.prompt, nil); err != nil {
			t.Fatal(err)
		}
		var pending []map[string]any
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			pending = session.PendingPermissions()
			if len(pending) > 0 {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if len(pending) != 1 {
			t.Fatalf("%s: pending = %d, want 1", testCase.prompt, len(pending))
		}
		input, _ := pending[0]["input"].(map[string]any)
		questions, _ := input["questions"].([]map[string]any)
		if len(questions) != testCase.wantCount {
			t.Fatalf("%s: questions = %d, want %d", testCase.prompt, len(questions), testCase.wantCount)
		}
		if got, _ := questions[0]["question"].(string); got != testCase.wantQuestion {
			t.Fatalf("%s: first question = %q", testCase.prompt, got)
		}
		if got, _ := questions[0]["placeholder"].(string); got != testCase.wantPlace {
			t.Fatalf("%s: placeholder = %q, want %q", testCase.prompt, got, testCase.wantPlace)
		}
		// Answering ends the turn; leaving it open kept the running affordance up after the modal closed.
		id, _ := pending[0]["id"].(string)
		if err := session.RespondToPermission(id, map[string]any{"behavior": "allow"}); err != nil {
			t.Fatal(err)
		}
		waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		_ = session.WaitForFinish(waitCtx)
		cancel()
		if got := session.Status(); got != "idle" {
			t.Fatalf("%s: status = %q after answering, want idle", testCase.prompt, got)
		}
	}
}

// The steer failure message is asserted verbatim by the spec.
func TestMockSteerFailureMessage(t *testing.T) {
	session := StartMockSession(MockLaunchOptions{
		Cwd: t.TempDir(), Model: "one-minute-stream",
		FeatureValues: map[string]any{"mockSteerAmbiguousFailures": float64(1)},
	})
	ctx := context.Background()
	if err := session.Prompt(ctx, "Start a turn to steer.", nil); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = session.Abort(ctx) }()
	err := session.Steer(ctx, "Steer it.", nil)
	if err == nil || err.Error() != "Requested mock steer transport failure" {
		t.Fatalf("steer error = %v, want the transport failure message", err)
	}
}

// A steered message joins the running turn carrying the client's own id, so the optimistic bubble
// merges instead of duplicating.
func TestMockSteerCarriesTheClientMessageID(t *testing.T) {
	session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: "one-minute-stream"})
	ctx := context.Background()
	if err := session.Prompt(ctx, "First turn.", nil); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = session.Abort(ctx) }()
	session.SetNextClientMessageID("client-steer-1")
	if err := session.Steer(ctx, "Steer this turn.", nil); err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, entry := range session.Timeline() {
		if entry.Item.Type == "user_message" && entry.Item.ClientMessageID == "client-steer-1" {
			found = true
		}
	}
	if !found {
		t.Fatal("the steered message lost its clientMessageId")
	}
}

// The command the provider answers itself is out-of-band: it replies without opening a turn, so it
// neither cancels a running one nor shows the running affordance.
func TestMockHandledCommandIsOutOfBand(t *testing.T) {
	session, events := newTestMockSession(t, "one-minute-stream")
	ctx := context.Background()
	if err := session.Prompt(ctx, MockHandledCommand, nil); err != nil {
		t.Fatal(err)
	}
	if got := session.Status(); got != "idle" {
		t.Fatalf("status = %q, want idle: the command opens no turn", got)
	}
	for _, typ := range eventTypes(*events) {
		if typ != "byspace_stream_timeline" {
			t.Fatalf("the out-of-band command emitted %q; it opens no turn", typ)
		}
	}
	if got := timelineTexts(session, "assistant_message"); got != mockHandledCommandReply {
		t.Fatalf("reply = %q, want %q", got, mockHandledCommandReply)
	}
}

// A sentence quoting the command is an ordinary prompt, not a command.
func TestMockHandledCommandMatchesExactly(t *testing.T) {
	session, events := newTestMockSession(t, "e2e-fast-stream")
	if err := session.Prompt(context.Background(), "Please run "+MockHandledCommand+" for me.", nil); err != nil {
		t.Fatal(err)
	}
	if !hasEvent(*events, "byspace_turn_started") {
		t.Fatalf("a prompt quoting the command did not open a turn: %v", eventTypes(*events))
	}
}

// Uncoalesced stream updates arrive as todo items; coalesced ones as assistant text.
func TestMockStressShapes(t *testing.T) {
	cases := []struct {
		prompt   string
		wantType string
	}{
		{"emit 5 coalesced agent stream updates", "assistant_message"},
		{"emit 5 agent stream updates", "todo"},
	}
	for _, testCase := range cases {
		session, events := newTestMockSession(t, "e2e-fast-stream")
		ctx := context.Background()
		if err := session.Prompt(ctx, testCase.prompt, nil); err != nil {
			t.Fatal(err)
		}
		waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_ = session.WaitForFinish(waitCtx)
		cancel()
		if !contains(timelineTypes(session), testCase.wantType) {
			t.Fatalf("%s: timeline %v has no %q item", testCase.prompt, timelineTypes(session), testCase.wantType)
		}
		if !hasEvent(*events, "byspace_turn_completed") {
			t.Fatalf("%s: no turn_completed: %v", testCase.prompt, eventTypes(*events))
		}
	}
}

// The stress prompt is plural: "emit 1 ... update" is not a stress request and falls through to the
// cycle stream, which is how provider-usage-tooltip starts a long turn.
func TestMockStressPatternIsPluralOnly(t *testing.T) {
	directives := ParseMockDirectives("emit 1 coalesced agent stream update for provider usage tooltip.")
	if directives.StreamUpdates != 0 {
		t.Fatalf("a singular stress phrase parsed as %d updates", directives.StreamUpdates)
	}
	if directives.hasAny() {
		t.Fatalf("the singular phrase produced directives: %+v", directives)
	}
	if got := ParseMockDirectives("emit 3 coalesced agent stream updates"); got.StreamUpdates != 3 || !got.StreamCoalesced {
		t.Fatalf("plural phrase parsed as %+v", got)
	}
}

// The auto-name request is answered with JSON and nothing else.
func TestMockStructuredBranchName(t *testing.T) {
	session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: "e2e-fast-stream"})
	prompt := "Generate a title and a git branch name for a coding agent.\n\nReturn JSON only with fields 'title' and 'branch'.\n\n<user-prompt>\nFix the Login Flow!\n</user-prompt>"
	ctx := context.Background()
	if err := session.Prompt(ctx, prompt, nil); err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()

	text := timelineTexts(session, "assistant_message")
	var decoded map[string]string
	if err := json.Unmarshal([]byte(text), &decoded); err != nil {
		t.Fatalf("the answer was not JSON: %q (%v)", text, err)
	}
	if decoded["title"] != "Fix the Login Flow!" {
		t.Fatalf("title = %q", decoded["title"])
	}
	if decoded["branch"] != "fix-the-login-flow" {
		t.Fatalf("branch = %q", decoded["branch"])
	}
}

// Tokenizing is sub-word: the coalescing and paced-reveal specs measure frame counts against it.
func TestMockTokenizeSplitsSubWords(t *testing.T) {
	cases := []struct {
		input string
		want  []string
	}{
		{"hi there", []string{"hi", " there"}},
		{"abcdefgh", []string{"abcd", "efgh"}},
		{" abcdefghij", []string{" abcd", "efgh", "ij"}},
	}
	for _, testCase := range cases {
		if got := mockTokenize(testCase.input); strings.Join(got, "|") != strings.Join(testCase.want, "|") {
			t.Fatalf("mockTokenize(%q) = %v, want %v", testCase.input, got, testCase.want)
		}
	}
}

// Timeline items serialize to exactly the fields their protocol branch requires. A stray field or a
// missing required one fails the union and takes the whole timeline response with it.
func TestTimelineItemSerializesPerProtocolBranch(t *testing.T) {
	cases := []struct {
		name     string
		item     sdk.TimelineItem
		wantKeys []string
		banned   []string
	}{
		{
			name:     "notification",
			item:     sdk.TimelineItem{Type: "notification", Level: "info", Message: "hi"},
			wantKeys: []string{"type", "level", "message"},
			banned:   []string{"text", "messageId"},
		},
		{
			name:     "reasoning",
			item:     sdk.TimelineItem{Type: "reasoning", Text: "thinking"},
			wantKeys: []string{"type", "text"},
			banned:   []string{"messageId", "status"},
		},
		{
			name:     "todo",
			item:     sdk.TimelineItem{Type: "todo", Items: []sdk.TaskItem{{Text: "one", Completed: true}}},
			wantKeys: []string{"type", "items"},
			banned:   []string{"text"},
		},
		{
			name: "custom_message",
			item: sdk.TimelineItem{
				Type: "custom_message", CustomType: "background-exit", Display: true, Content: "body",
			},
			wantKeys: []string{"type", "customType", "display", "content"},
			banned:   []string{"text"},
		},
		{
			name: "tool_call",
			item: sdk.TimelineItem{
				Type: "tool_call", CallID: "c1", Name: "bash", Status: "running",
				Detail:   map[string]any{"type": "shell"},
				Metadata: map[string]any{"parentToolCallId": "p1"},
			},
			wantKeys: []string{"type", "callId", "name", "status", "detail", "error", "metadata"},
			banned:   []string{"text"},
		},
	}
	for _, testCase := range cases {
		decoded := decodeItem(t, testCase.item)
		for _, key := range testCase.wantKeys {
			if _, ok := decoded[key]; !ok {
				t.Fatalf("%s: missing %q in %v", testCase.name, key, decoded)
			}
		}
		for _, key := range testCase.banned {
			if _, ok := decoded[key]; ok {
				t.Fatalf("%s: leaked %q into %v", testCase.name, key, decoded)
			}
		}
	}
	// display has to survive being false: the protocol requires it, and omitempty would drop it.
	hidden := decodeItem(t, sdk.TimelineItem{
		Type: "custom_message", CustomType: "quiet", Display: false, Content: "body",
	})
	if value, ok := hidden["display"].(bool); !ok || value {
		t.Fatalf("display = %v, want an explicit false", hidden["display"])
	}
}

// The steering replay holds a foreground shell call open long enough to steer into.
func TestMockSteeringReplayHoldsAShellCall(t *testing.T) {
	session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: "e2e-fast-stream"})
	ctx := context.Background()
	if err := session.Prompt(ctx, "Replay a codex-shaped foreground shell tool call while the user steers this turn.", nil); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = session.Abort(ctx) }()
	deadline := time.Now().Add(3 * time.Second)
	var running bool
	for time.Now().Before(deadline) {
		for _, entry := range session.Timeline() {
			if entry.Item.Type == "tool_call" && entry.Item.Name == "bash" && entry.Item.Status == "running" {
				running = true
			}
		}
		if running {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !running {
		t.Fatalf("no running shell call in %v", timelineTypes(session))
	}
	// The codex shape leads with an assistant line before the call; the claude shape does not.
	if got := timelineTexts(session, "assistant_message"); !strings.Contains(got, "Running the foreground command.") {
		t.Fatalf("the codex-shaped replay lost its lead-in: %q", got)
	}
	if got := session.Status(); got != "running" {
		t.Fatalf("status = %q, want running while the shell call is held open", got)
	}
}

// A large payload produces one item of the requested kind.
func TestMockLargePayloadKinds(t *testing.T) {
	cases := []struct {
		prompt   string
		wantType string
		wantName string
	}{
		{"emit 4096 byte large diff agent stream update", "tool_call", "edit"},
		{"emit 4096 byte large file agent stream update", "tool_call", "read"},
		{"emit 4096 byte large image agent stream update", "assistant_message", ""},
	}
	for _, testCase := range cases {
		session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: "e2e-fast-stream"})
		ctx := context.Background()
		if err := session.Prompt(ctx, testCase.prompt, nil); err != nil {
			t.Fatal(err)
		}
		waitCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		_ = session.WaitForFinish(waitCtx)
		cancel()
		var found bool
		for _, entry := range session.Timeline() {
			if entry.Item.Type != testCase.wantType {
				continue
			}
			if testCase.wantName != "" && entry.Item.Name != testCase.wantName {
				continue
			}
			found = true
		}
		if !found {
			t.Fatalf("%s: no %s/%s item in %v", testCase.prompt, testCase.wantType, testCase.wantName, timelineTypes(session))
		}
	}
}

// The bursty model still streams its cycles, in uneven runs.
func TestMockBurstyStreamProducesCycles(t *testing.T) {
	session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: "bursty-stream"})
	ctx := context.Background()
	if err := session.Prompt(ctx, "Stream unevenly for a moment.", nil); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = session.Abort(ctx) }()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(timelineTexts(session, "assistant_message"), "## Cycle 1") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("the bursty model never streamed its first cycle: %v", timelineTypes(session))
}

// "Emit N assistant messages before synthetic user message" is its own turn shape: N pre-echo
// messages, then the user message, then the turn finishes immediately. It must NOT fall through to
// the cycle stream — on one-minute-stream that would leave the turn running for 60s after a shape
// node completes at once, and the agent would never go idle.
func TestMockAssistantBeforeUserCompletesImmediately(t *testing.T) {
	session, events := newTestMockSession(t, "one-minute-stream")
	start := time.Now()
	if err := session.Prompt(context.Background(), "Emit 205 assistant messages before synthetic user message.", nil); err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()

	// The model's duration is 60s; this shape finishes in well under a second.
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("the pre-echo turn took %v; it should complete immediately, not run the cycle stream", elapsed)
	}
	if got := session.Status(); got != "idle" {
		t.Fatalf("status = %q, want idle after the pre-echo turn", got)
	}
	if !hasEvent(*events, "byspace_turn_completed") {
		t.Fatalf("no turn_completed: %v", eventTypes(*events))
	}

	types := timelineTypes(session)
	// 205 pre-echo assistant messages, then exactly one user message, and nothing after it.
	var assistant, user int
	lastUser := -1
	for i, typ := range types {
		switch typ {
		case "assistant_message":
			assistant++
		case "user_message":
			user++
			lastUser = i
		}
	}
	if assistant != 205 {
		t.Fatalf("pre-echo assistant messages = %d, want 205", assistant)
	}
	if user != 1 {
		t.Fatalf("user messages = %d, want exactly 1", user)
	}
	// The user message is the last row: node emits the pre-echo messages, then the echo, then finishes.
	if lastUser != len(types)-1 {
		t.Fatalf("the user message is at index %d of %d, want it last", lastUser, len(types))
	}
	// No cycle-stream tool calls: this shape produces prose only.
	if contains(types, "tool_call") {
		t.Fatalf("the pre-echo turn ran the cycle stream: %v", types)
	}
	if got := session.LastAssistantText(); got != "Synthetic pre-echo stream complete" {
		t.Fatalf("lastAssistantText = %q, want the pre-echo completion text", got)
	}
}
