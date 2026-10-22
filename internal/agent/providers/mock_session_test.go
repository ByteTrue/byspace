package providers

import (
	"context"
	"testing"
	"time"
)

// newTestMockSession builds a session that only records what it emits.
func newTestMockSession(t *testing.T, model string) (*MockSession, *[]map[string]any) {
	t.Helper()
	session := StartMockSession(MockLaunchOptions{Cwd: t.TempDir(), Model: model})
	var events []map[string]any
	var mu = make(chan struct{}, 1)
	mu <- struct{}{}
	session.OnEvent(func(event map[string]any) {
		<-mu
		events = append(events, event)
		mu <- struct{}{}
	})
	return session, &events
}

// timelineTypes lists the timeline item types in order, which is what the client renders against.
func timelineTypes(session *MockSession) []string {
	types := make([]string, 0, 8)
	for _, entry := range session.Timeline() {
		types = append(types, entry.Item.Type)
	}
	return types
}

func contains(types []string, want string) bool {
	for _, entry := range types {
		if entry == want {
			return true
		}
	}
	return false
}

// Each directive turns into a distinct timeline shape; the specs assert on that shape, so the mapping is the contract.
func TestMockDirectivesProduceTheirShapes(t *testing.T) {
	cases := []struct {
		prompt  string
		want    string
		meaning string
	}{
		{"emit synthetic notification", "notification", "notification card"},
		{"emit synthetic custom message", "custom_message", "custom message card"},
		{"emit synthetic todowrite", "tool_call", "todo tool card"},
		{"emit 5 agent stream updates", "todo", "uncoalesced updates as todo items"},
		{"emit 5 coalesced agent stream updates", "assistant_message", "coalesced updates as assistant text"},
		{"emit settled assistant image markdown: ![a](./a.png)", "assistant_message", "image message"},
	}
	for _, testCase := range cases {
		session, _ := newTestMockSession(t, "e2e-fast-stream")
		ctx := context.Background()
		if err := session.Prompt(ctx, testCase.prompt, nil); err != nil {
			t.Fatalf("%s: prompt rejected: %v", testCase.meaning, err)
		}
		waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_ = session.WaitForFinish(waitCtx)
		cancel()
		if !contains(timelineTypes(session), testCase.want) {
			t.Fatalf("%s: timeline has %v, want a %q item", testCase.meaning, timelineTypes(session), testCase.want)
		}
	}
}

// A scripted failure is a turn outcome, not a rejected prompt: the run is accepted, the failure
// arrives as turn_failed, and the session has to be idle afterwards. A provider that fails and
// stays "running" spins the UI forever, and a client told accepted=false never learns the turn ran.
func TestMockTurnFailure(t *testing.T) {
	session, events := newTestMockSession(t, "e2e-fast-stream")
	if err := session.Prompt(context.Background(), "emit synthetic turn failure", nil); err != nil {
		t.Fatalf("a scripted turn failure rejected the prompt: %v", err)
	}
	waitCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()
	if got := session.Status(); got != "idle" {
		t.Fatalf("status = %q, want idle", got)
	}
	if got := session.LastError(); got != mockProviderFailureMessage {
		t.Fatalf("lastError = %q, want %q", got, mockProviderFailureMessage)
	}
	var failed bool
	for _, event := range *events {
		if typ, _ := event["type"].(string); typ == "byspace_turn_failed" {
			failed = true
		}
	}
	if !failed {
		t.Fatalf("no turn_failed event: %+v", *events)
	}
}

// A plan approval is a permission request: the client opens a modal for it, so it has to be pending until answered.
func TestMockPlanApprovalIsPending(t *testing.T) {
	session, _ := newTestMockSession(t, "e2e-fast-stream")
	ctx := context.Background()
	if err := session.Prompt(ctx, "emit synthetic plan approval", nil); err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()
	pending := session.PendingPermissions()
	if len(pending) != 1 {
		t.Fatalf("pending = %d, want 1", len(pending))
	}
	if kind, _ := pending[0]["kind"].(string); kind != "plan" {
		t.Fatalf("kind = %q", kind)
	}
	// Answering clears it, otherwise the modal cannot be dismissed.
	_ = session.RespondToPermission(pending[0]["id"].(string), map[string]any{"behavior": "allow"})
	if got := len(session.PendingPermissions()); got != 0 {
		t.Fatalf("pending after answering = %d", got)
	}
}

// A prompt rejection is consumed once: the spec asserts the second send succeeds.
func TestMockPromptRejectionIsOneShot(t *testing.T) {
	session := StartMockSession(MockLaunchOptions{
		Cwd: t.TempDir(), Model: "e2e-fast-stream",
		FeatureValues: map[string]any{"mockPromptRejections": float64(1)},
	})
	ctx := context.Background()
	if err := session.Prompt(ctx, "first", nil); err == nil {
		t.Fatal("the configured rejection did not fire")
	}
	if err := session.Prompt(ctx, "second", nil); err != nil {
		t.Fatalf("the second prompt was rejected too: %v", err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()
}

// A delayed echo leaves the turn started but the user message not yet landed; that window is what the
// "interrupt before the first turn" specs exercise.
func TestMockDelayedUserMessage(t *testing.T) {
	session, _ := newTestMockSession(t, "e2e-fast-stream")
	ctx := context.Background()
	if err := session.Prompt(ctx, "Delay synthetic user message by 300ms.", nil); err != nil {
		t.Fatal(err)
	}
	// Nothing echoed yet.
	if contains(timelineTypes(session), "user_message") {
		t.Fatal("the user message landed before its delay elapsed")
	}
	waitCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	_ = session.WaitForFinish(waitCtx)
	cancel()
	if !contains(timelineTypes(session), "user_message") {
		t.Fatalf("the delayed user message never landed: %v", timelineTypes(session))
	}
}

// Aborting inside the delay window has to leave the client with nothing running. The turn never emitted
// turn_started, so the abort emits the pair rather than a lone cancel.
func TestMockAbortInsideDelayWindow(t *testing.T) {
	session, _ := newTestMockSession(t, "two-minute-does-not-exist")
	if err := session.Prompt(context.Background(), "Delay synthetic user message by 1500ms.", nil); err != nil {
		t.Fatal(err)
	}
	if err := session.Abort(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := session.Status(); got != "idle" {
		t.Fatalf("status = %q, want idle", got)
	}
	if turnID, _ := session.ActiveTurn(); turnID != "" {
		t.Fatalf("the cancelled turn is still active: %q", turnID)
	}
	// The cancelled turn must not echo its user message afterwards.
	time.Sleep(1800 * time.Millisecond)
	if contains(timelineTypes(session), "user_message") {
		t.Fatalf("the cancelled turn still echoed its prompt: %v", timelineTypes(session))
	}
}
