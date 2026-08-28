package agent

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestManagerLifecycleTimelineAndIdempotency(t *testing.T) {
	provider := &fakeProvider{}
	manager := NewManager(map[string]Provider{"pi": provider})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })

	var observedMu sync.Mutex
	var observed []Event
	unsubscribe := manager.Subscribe(func(event Event) {
		observedMu.Lock()
		observed = append(observed, event)
		observedMu.Unlock()
	})
	defer unsubscribe()

	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(snapshot.ID, "agt_") || snapshot.Lifecycle != LifecycleIdle {
		t.Fatalf("unexpected created snapshot: %+v", snapshot)
	}
	if snapshot.Persistence == nil || snapshot.Persistence.SessionID != "native-session" {
		t.Fatalf("missing provider persistence: %+v", snapshot.Persistence)
	}

	result, err := manager.Send(context.Background(), snapshot.ID, "client-1", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Accepted || result.Duplicate || !strings.HasPrefix(result.TurnID, "turn_") {
		t.Fatalf("unexpected send result: %+v", result)
	}
	if calls := provider.session.promptCalls(); calls != 1 {
		t.Fatalf("prompt calls = %d, want 1", calls)
	}

	provider.session.emit(ProviderEvent{Type: ProviderEventTurnStarted, TurnID: result.TurnID})
	provider.session.emit(ProviderEvent{
		Type:   ProviderEventTimeline,
		TurnID: result.TurnID,
		Item:   TimelineItem{Type: TimelineAssistantMessage, Text: "hel"},
	})
	provider.session.emit(ProviderEvent{
		Type:   ProviderEventTimeline,
		TurnID: result.TurnID,
		Item:   TimelineItem{Type: TimelineAssistantMessage, Text: "lo"},
	})
	provider.session.emit(ProviderEvent{Type: ProviderEventTurnCompleted, TurnID: result.TurnID})

	waitFor(t, func() bool {
		got, getErr := manager.Get(snapshot.ID)
		return getErr == nil && got.Lifecycle == LifecycleIdle && got.ActiveTurnID == ""
	})

	timeline, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if timeline.Epoch == "" || len(timeline.Rows) != 3 {
		t.Fatalf("unexpected timeline: %+v", timeline)
	}
	wantTypes := []TimelineItemType{TimelineUserMessage, TimelineAssistantMessage, TimelineAssistantMessage}
	for index, row := range timeline.Rows {
		if row.Seq != uint64(index+1) || row.Item.Type != wantTypes[index] {
			t.Fatalf("row %d = %+v", index, row)
		}
	}
	if timeline.Rows[0].Item.ClientMessageID != "client-1" || timeline.Rows[0].TurnID != result.TurnID {
		t.Fatalf("unexpected submitted prompt row: %+v", timeline.Rows[0])
	}

	duplicate, err := manager.Send(context.Background(), snapshot.ID, "client-1", "different text")
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate.Accepted || !duplicate.Duplicate || duplicate.TurnID != result.TurnID {
		t.Fatalf("unexpected duplicate result: %+v", duplicate)
	}
	if calls := provider.session.promptCalls(); calls != 1 {
		t.Fatalf("duplicate prompted provider; calls = %d", calls)
	}

	// Returned snapshots and rows must not alias manager state.
	timeline.Rows[0].Item.Text = "mutated"
	again, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.Rows[0].Item.Text != "hello" {
		t.Fatalf("timeline state was externally mutated: %+v", again.Rows[0])
	}

	observedMu.Lock()
	defer observedMu.Unlock()
	if len(observed) == 0 {
		t.Fatal("subscriber observed no events")
	}
}

func TestManagerSendInterruptDuplicateDoesNotAbortOriginalTurn(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	manager := NewManager(map[string]Provider{"pi": provider})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })

	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	original, err := manager.Send(context.Background(), snapshot.ID, "client-retry", "original")
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := manager.SendInterrupt(context.Background(), snapshot.ID, "client-retry", "retried")
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate.Duplicate || !duplicate.Accepted || duplicate.TurnID != original.TurnID {
		t.Fatalf("duplicate = %+v, original = %+v", duplicate, original)
	}
	if provider.session.abortCalls() != 0 || provider.session.promptCalls() != 1 {
		t.Fatalf("abort calls = %d, prompt calls = %d", provider.session.abortCalls(), provider.session.promptCalls())
	}
	current, err := manager.Get(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.ActiveTurnID != original.TurnID || current.Lifecycle != LifecycleRunning {
		t.Fatalf("original turn was mutated: %+v", current)
	}
	timeline, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Rows) != 1 || timeline.Rows[0].Item.Text != "original" {
		t.Fatalf("timeline = %+v", timeline.Rows)
	}
}

func TestManagerRejectsBusyTurnAndAbortWinsSettleRace(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	provider.session.abortStarted = make(chan struct{})
	provider.session.abortRelease = make(chan struct{})
	manager := NewManager(map[string]Provider{"pi": provider})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })

	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	first, err := manager.Send(context.Background(), snapshot.ID, "client-1", "block")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(context.Background(), snapshot.ID, "client-2", "busy"); !errors.Is(err, ErrAgentBusy) {
		t.Fatalf("busy send error = %v", err)
	}

	var terminalMu sync.Mutex
	var terminal []ProviderEventType
	unsubscribe := manager.Subscribe(func(event Event) {
		if event.Stream == nil || event.Stream.TurnID != first.TurnID {
			return
		}
		if event.Stream.Type == ProviderEventTurnCompleted || event.Stream.Type == ProviderEventTurnCanceled {
			terminalMu.Lock()
			terminal = append(terminal, event.Stream.Type)
			terminalMu.Unlock()
		}
	})
	defer unsubscribe()

	abortResult := make(chan error, 1)
	go func() { abortResult <- manager.Abort(context.Background(), snapshot.ID) }()
	<-provider.session.abortStarted
	provider.session.emit(ProviderEvent{Type: ProviderEventTurnCompleted, TurnID: first.TurnID})
	close(provider.session.abortRelease)
	if err := <-abortResult; err != nil {
		t.Fatal(err)
	}

	waitFor(t, func() bool {
		got, getErr := manager.Get(snapshot.ID)
		return getErr == nil && got.Lifecycle == LifecycleIdle && got.ActiveTurnID == ""
	})
	waitFor(t, func() bool {
		terminalMu.Lock()
		defer terminalMu.Unlock()
		return len(terminal) == 1
	})
	terminalMu.Lock()
	defer terminalMu.Unlock()
	if len(terminal) != 1 || terminal[0] != ProviderEventTurnCanceled {
		t.Fatalf("terminal events = %v, want one canceled", terminal)
	}
}

func TestManagerAbortFailureReplaysBufferedSettlement(t *testing.T) {
	provider := &fakeProvider{}
	manager := NewManager(map[string]Provider{"pi": provider})
	defer manager.Close(context.Background())
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.Send(context.Background(), snapshot.ID, "message-1", "hello")
	if err != nil {
		t.Fatal(err)
	}
	provider.session.abortStarted = make(chan struct{})
	provider.session.abortRelease = make(chan struct{})
	provider.session.abortErr = errors.New("abort rejected")
	abortDone := make(chan error, 1)
	go func() { abortDone <- manager.Abort(context.Background(), snapshot.ID) }()
	<-provider.session.abortStarted
	provider.session.emit(ProviderEvent{Type: ProviderEventTurnCompleted, TurnID: result.TurnID})
	close(provider.session.abortRelease)
	if err := <-abortDone; err == nil || !strings.Contains(err.Error(), "abort rejected") {
		t.Fatalf("Abort() error = %v", err)
	}
	waitFor(t, func() bool {
		got, getErr := manager.Get(snapshot.ID)
		return getErr == nil && got.Lifecycle == LifecycleIdle && got.ActiveTurnID == ""
	})
}

func TestManagerDropsProviderEventsWithoutActiveTurnIdentity(t *testing.T) {
	provider := &fakeProvider{}
	manager := NewManager(map[string]Provider{"pi": provider})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.Send(context.Background(), snapshot.ID, "message", "hello")
	if err != nil {
		t.Fatal(err)
	}
	provider.session.emit(ProviderEvent{Type: ProviderEventTimeline, Item: TimelineItem{Type: TimelineAssistantMessage, Text: "uncorrelated"}})
	provider.session.emit(ProviderEvent{Type: ProviderEventTurnStarted})
	provider.session.emit(ProviderEvent{Type: ProviderEventTurnCompleted, TurnID: result.TurnID})
	waitFor(t, func() bool {
		got, getErr := manager.Get(snapshot.ID)
		return getErr == nil && got.Lifecycle == LifecycleIdle
	})
	timeline, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Rows) != 1 || timeline.Rows[0].Item.Type != TimelineUserMessage {
		t.Fatalf("uncorrelated provider event reached timeline: %+v", timeline.Rows)
	}
}

func TestManagerFailuresAndClose(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	manager := NewManager(map[string]Provider{"pi": provider})

	if _, err := manager.Create(context.Background(), Config{Provider: "missing", CWD: t.TempDir()}); !errors.Is(err, ErrProviderNotFound) {
		t.Fatalf("unknown provider error = %v", err)
	}
	if _, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: "relative"}); err == nil {
		t.Fatal("relative cwd was accepted")
	}

	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	provider.session.promptErr = errors.New("prompt rejected")
	if _, err := manager.Send(context.Background(), snapshot.ID, "client-1", "fail"); err == nil {
		t.Fatal("prompt failure was accepted")
	}
	failed, err := manager.Get(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if failed.Lifecycle != LifecycleError || failed.LastError != "prompt rejected" {
		t.Fatalf("unexpected failed snapshot: %+v", failed)
	}
	timeline, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Rows) != 2 || timeline.Rows[1].Item.Type != TimelineError {
		t.Fatalf("prompt failure timeline = %+v", timeline.Rows)
	}

	provider.session.promptErr = nil
	second, err := manager.Send(context.Background(), snapshot.ID, "client-2", "again")
	if err != nil {
		t.Fatal(err)
	}
	provider.session.emit(ProviderEvent{Type: ProviderEventProcessExited, TurnID: second.TurnID, Error: "process exited"})
	waitFor(t, func() bool {
		got, getErr := manager.Get(snapshot.ID)
		return getErr == nil && got.Lifecycle == LifecycleError && got.LastError == "process exited"
	})
	beforeExitedSend, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(context.Background(), snapshot.ID, "client-3", "must not append"); !errors.Is(err, ErrProviderExited) {
		t.Fatalf("send after provider exit error = %v", err)
	}
	afterExitedSend, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(afterExitedSend.Rows) != len(beforeExitedSend.Rows) {
		t.Fatalf("send after provider exit appended timeline row: before=%d after=%d", len(beforeExitedSend.Rows), len(afterExitedSend.Rows))
	}

	if err := manager.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !provider.session.wasClosed() {
		t.Fatal("manager did not close provider session")
	}
	closed, err := manager.Get(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Lifecycle != LifecycleClosed {
		t.Fatalf("closed lifecycle = %q", closed.Lifecycle)
	}
	if _, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()}); !errors.Is(err, ErrManagerClosed) {
		t.Fatalf("create after close error = %v", err)
	}
}

func TestManagerCloseCancelsInFlightCreate(t *testing.T) {
	provider := &blockingProvider{started: make(chan struct{})}
	manager := NewManager(map[string]Provider{"pi": provider})
	createDone := make(chan error, 1)
	go func() {
		_, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
		createDone <- err
	}()
	<-provider.started
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := manager.Close(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-createDone; err == nil {
		t.Fatal("in-flight Create was not canceled")
	}
}

func TestCloseAgentFailureDoesNotClaimClosed(t *testing.T) {
	provider := &fakeProvider{}
	manager := NewManager(map[string]Provider{"pi": provider})
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	provider.session.closeErr = errors.New("close failed")
	if err := manager.CloseAgent(context.Background(), snapshot.ID); err == nil {
		t.Fatal("CloseAgent unexpectedly succeeded")
	}
	failed, err := manager.Get(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if failed.Lifecycle != LifecycleError {
		t.Fatalf("lifecycle after failed close = %q", failed.Lifecycle)
	}
	provider.session.closeErr = nil
	if err := manager.CloseAgent(context.Background(), snapshot.ID); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentDuplicateSendWaitsForOriginalResult(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	provider.session.promptStarted = make(chan struct{})
	provider.session.promptRelease = make(chan struct{})
	manager := NewManager(map[string]Provider{"pi": provider})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	firstDone := make(chan struct {
		result SendResult
		err    error
	}, 1)
	go func() {
		result, sendErr := manager.Send(context.Background(), snapshot.ID, "same-message", "hello")
		firstDone <- struct {
			result SendResult
			err    error
		}{result, sendErr}
	}()
	<-provider.session.promptStarted
	duplicateDone := make(chan struct {
		result SendResult
		err    error
	}, 1)
	go func() {
		result, sendErr := manager.Send(context.Background(), snapshot.ID, "same-message", "ignored")
		duplicateDone <- struct {
			result SendResult
			err    error
		}{result, sendErr}
	}()
	select {
	case got := <-duplicateDone:
		t.Fatalf("duplicate returned before original delivery: %+v", got)
	case <-time.After(20 * time.Millisecond):
	}
	provider.session.promptReleaseOnce.Do(func() { close(provider.session.promptRelease) })
	first := <-firstDone
	duplicate := <-duplicateDone
	if first.err != nil || duplicate.err != nil {
		t.Fatalf("delivery errors: first=%v duplicate=%v", first.err, duplicate.err)
	}
	if !first.result.Accepted || first.result.Duplicate || !duplicate.result.Accepted || !duplicate.result.Duplicate || duplicate.result.TurnID != first.result.TurnID {
		t.Fatalf("results: first=%+v duplicate=%+v", first.result, duplicate.result)
	}
	if calls := provider.session.promptCalls(); calls != 1 {
		t.Fatalf("prompt calls = %d, want 1", calls)
	}
}

func TestQueuedDuplicateSendHonorsContextCancellation(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	provider.session.promptStarted = make(chan struct{})
	provider.session.promptRelease = make(chan struct{})
	manager := NewManager(map[string]Provider{"pi": provider})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	firstDone := make(chan error, 1)
	go func() {
		_, sendErr := manager.Send(context.Background(), snapshot.ID, "same-message", "original")
		firstDone <- sendErr
	}()
	<-provider.session.promptStarted

	ctx, cancel := context.WithCancel(context.Background())
	duplicateDone := make(chan error, 1)
	go func() {
		_, sendErr := manager.SendInterrupt(ctx, snapshot.ID, "same-message", "retry")
		duplicateDone <- sendErr
	}()
	cancel()
	select {
	case duplicateErr := <-duplicateDone:
		if !errors.Is(duplicateErr, context.Canceled) {
			t.Fatalf("duplicate error = %v", duplicateErr)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled duplicate remained queued behind original prompt")
	}

	provider.session.promptReleaseOnce.Do(func() { close(provider.session.promptRelease) })
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if provider.session.abortCalls() != 0 || provider.session.promptCalls() != 1 {
		t.Fatalf("abort calls = %d, prompt calls = %d", provider.session.abortCalls(), provider.session.promptCalls())
	}
}

func TestConcurrentAbortWaitsForOwnerResult(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	provider.session.abortStarted = make(chan struct{})
	provider.session.abortRelease = make(chan struct{})
	provider.session.abortErr = errors.New("abort rejected")
	manager := NewManager(map[string]Provider{"pi": provider})
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(context.Background(), snapshot.ID, "message", "hello"); err != nil {
		t.Fatal(err)
	}

	firstDone := make(chan error, 1)
	go func() { firstDone <- manager.Abort(context.Background(), snapshot.ID) }()
	<-provider.session.abortStarted
	secondDone := make(chan error, 1)
	go func() { secondDone <- manager.Abort(context.Background(), snapshot.ID) }()
	select {
	case err := <-secondDone:
		t.Fatalf("concurrent abort returned before owner: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(provider.session.abortRelease)
	firstErr, secondErr := <-firstDone, <-secondDone
	if !strings.Contains(firstErr.Error(), "abort rejected") || !strings.Contains(secondErr.Error(), "abort rejected") {
		t.Fatalf("abort errors: first=%v second=%v", firstErr, secondErr)
	}
}

func TestManagerCloseWaitsForInFlightSend(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	provider.session.promptStarted = make(chan struct{})
	provider.session.promptRelease = make(chan struct{})
	provider.session.promptReturn = make(chan struct{})
	provider.session.closeUnblocksPrompt = true
	manager := NewManager(map[string]Provider{"pi": provider})
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sendDone := make(chan error, 1)
	go func() {
		_, sendErr := manager.Send(context.Background(), snapshot.ID, "message", "hello")
		sendDone <- sendErr
	}()
	<-provider.session.promptStarted
	closeDone := make(chan error, 1)
	go func() { closeDone <- manager.Close(context.Background()) }()
	select {
	case err := <-closeDone:
		t.Fatalf("Close returned before in-flight send: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(provider.session.promptReturn)
	if err := <-sendDone; err != nil {
		t.Fatal(err)
	}
	if err := <-closeDone; err != nil {
		t.Fatal(err)
	}
}

func TestSubscriberCanUnsubscribeItself(t *testing.T) {
	manager := NewManager(nil)
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	called := make(chan struct{})
	ready := make(chan struct{})
	var unsubscribe func()
	unsubscribe = manager.Subscribe(func(Event) {
		<-ready
		unsubscribe()
		close(called)
	})
	close(ready)
	manager.dispatch(Event{Type: EventAgentState})
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("subscriber deadlocked while unsubscribing itself")
	}
}

func TestManagerConcurrentCloseWaitsForOwner(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	provider.session.closeStarted = make(chan struct{})
	provider.session.closeRelease = make(chan struct{})
	manager := NewManager(map[string]Provider{"pi": provider})
	if _, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()}); err != nil {
		t.Fatal(err)
	}

	firstDone := make(chan error, 1)
	go func() { firstDone <- manager.Close(context.Background()) }()
	<-provider.session.closeStarted
	secondDone := make(chan error, 1)
	go func() { secondDone <- manager.Close(context.Background()) }()
	select {
	case err := <-secondDone:
		t.Fatalf("concurrent Close returned before provider cleanup: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(provider.session.closeRelease)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if err := <-secondDone; err != nil {
		t.Fatal(err)
	}
}

type blockingProvider struct {
	started chan struct{}
	once    sync.Once
}

func (provider *blockingProvider) Start(ctx context.Context, _ Config) (Session, error) {
	provider.once.Do(func() { close(provider.started) })
	<-ctx.Done()
	return nil, ctx.Err()
}

type fakeProvider struct {
	mu      sync.Mutex
	session *fakeSession
}

func (provider *fakeProvider) Start(_ context.Context, config Config) (Session, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.session == nil || provider.session.wasClosed() {
		provider.session = newFakeSession()
	}
	provider.session.config = config
	return provider.session, nil
}

func newFakeSession() *fakeSession {
	return &fakeSession{
		events: make(chan ProviderEvent, 32),
		info: RuntimeInfo{
			Provider:         "pi",
			SessionID:        "native-session",
			NativeHandle:     "/tmp/native-session.jsonl",
			Model:            "test-model",
			ThinkingOptionID: "medium",
		},
		capabilities: Capabilities{
			SupportsStreaming:          true,
			SupportsSessionPersistence: true,
			SupportsReasoningStream:    true,
			SupportsToolInvocations:    true,
		},
	}
}

type fakeSession struct {
	mu                  sync.Mutex
	config              Config
	events              chan ProviderEvent
	info                RuntimeInfo
	capabilities        Capabilities
	prompts             []string
	promptErr           error
	promptStarted       chan struct{}
	promptStartOnce     sync.Once
	promptRelease       chan struct{}
	promptReleaseOnce   sync.Once
	promptReturn        chan struct{}
	closeUnblocksPrompt bool
	abortStarted        chan struct{}
	abortRelease        chan struct{}
	abortErr            error
	aborts              int
	closeStarted        chan struct{}
	closeRelease        chan struct{}
	closeOnce           sync.Once
	closeErr            error
	closed              bool
}

func (session *fakeSession) RuntimeInfo() RuntimeInfo     { return session.info }
func (session *fakeSession) Capabilities() Capabilities   { return session.capabilities }
func (session *fakeSession) Events() <-chan ProviderEvent { return session.events }

func (session *fakeSession) Prompt(ctx context.Context, _ string, prompt string) error {
	session.mu.Lock()
	session.prompts = append(session.prompts, prompt)
	promptErr := session.promptErr
	started := session.promptStarted
	release := session.promptRelease
	session.mu.Unlock()
	if started != nil {
		session.promptStartOnce.Do(func() { close(started) })
	}
	if release != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
		}
	}
	if session.promptReturn != nil {
		<-session.promptReturn
	}
	return promptErr
}

func (session *fakeSession) Abort(ctx context.Context) error {
	session.mu.Lock()
	session.aborts++
	started := session.abortStarted
	release := session.abortRelease
	abortErr := session.abortErr
	session.mu.Unlock()
	if started != nil {
		close(started)
	}
	if release != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
		}
	}
	return abortErr
}

func (session *fakeSession) Close(ctx context.Context) error {
	if session.closeErr != nil {
		return session.closeErr
	}
	if session.closeUnblocksPrompt && session.promptRelease != nil {
		session.promptReleaseOnce.Do(func() { close(session.promptRelease) })
	}
	if session.closeStarted != nil {
		session.closeOnce.Do(func() { close(session.closeStarted) })
	}
	if session.closeRelease != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-session.closeRelease:
		}
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	if !session.closed {
		session.closed = true
		close(session.events)
	}
	return nil
}

func (session *fakeSession) emit(event ProviderEvent) { session.events <- event }
func (session *fakeSession) abortCalls() int {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.aborts
}

func (session *fakeSession) promptCalls() int {
	session.mu.Lock()
	defer session.mu.Unlock()
	return len(session.prompts)
}
func (session *fakeSession) wasClosed() bool {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.closed
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition did not become true")
}
