package agent

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPersistentManagerRoundTripRestoresTimelineAndDedupe(t *testing.T) {
	provider := &fakeProvider{}
	statePath := filepath.Join(t.TempDir(), "state", "agents-v1.json")
	cwd := t.TempDir()
	manager, err := OpenManager(context.Background(), map[string]Provider{"pi": provider}, statePath)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := manager.Create(context.Background(), Config{
		Provider: "pi",
		CWD:      cwd,
		Title:    "Persistent",
		Labels:   map[string]string{"test": "roundtrip"},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.Send(context.Background(), snapshot.ID, "client-persist", "first")
	if err != nil {
		t.Fatal(err)
	}
	provider.session.emit(ProviderEvent{
		Type:   ProviderEventTimeline,
		TurnID: result.TurnID,
		Item:   TimelineItem{Type: TimelineAssistantMessage, Text: "persisted answer"},
	})
	provider.session.emit(ProviderEvent{Type: ProviderEventTurnCompleted, TurnID: result.TurnID})
	waitFor(t, func() bool {
		current, getErr := manager.Get(snapshot.ID)
		return getErr == nil && current.Lifecycle == LifecycleIdle && current.TimelineHeadSeq == 2
	})
	beforeTimeline, err := manager.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	restored, err := OpenManager(context.Background(), map[string]Provider{"pi": provider}, statePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restored.Close(context.Background()) })
	entries := restored.List()
	if len(entries) != 1 || entries[0].ID != snapshot.ID || entries[0].Lifecycle != LifecycleIdle {
		t.Fatalf("restored entries = %+v", entries)
	}
	afterTimeline, err := restored.Timeline(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterTimeline.Epoch != beforeTimeline.Epoch || len(afterTimeline.Rows) != 2 || afterTimeline.Rows[1].Item.Text != "persisted answer" {
		t.Fatalf("restored timeline = %+v, before = %+v", afterTimeline, beforeTimeline)
	}
	provider.mu.Lock()
	resume := provider.session.config.Resume
	provider.mu.Unlock()
	if resume == nil || resume.SessionID != "native-session" || resume.NativeHandle != "/tmp/native-session.jsonl" {
		t.Fatalf("resume config = %+v", resume)
	}
	duplicate, err := restored.Send(context.Background(), snapshot.ID, "client-persist", "must not resend")
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate.Duplicate || duplicate.TurnID != result.TurnID || provider.session.promptCalls() != 0 {
		t.Fatalf("duplicate = %+v, prompt calls = %d", duplicate, provider.session.promptCalls())
	}
	if _, err := restored.Send(context.Background(), snapshot.ID, "client-new", "second"); err != nil {
		t.Fatal(err)
	}
	if provider.session.promptCalls() != 1 {
		t.Fatalf("new prompt calls = %d", provider.session.promptCalls())
	}
}

func TestPersistentManagerRestoresFailedDeliveryOutcome(t *testing.T) {
	provider := &fakeProvider{session: newFakeSession()}
	provider.session.promptErr = errors.New("prompt rejected")
	statePath := filepath.Join(t.TempDir(), "agents-v1.json")
	manager, err := OpenManager(context.Background(), map[string]Provider{"pi": provider}, statePath)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	original, err := manager.Send(context.Background(), snapshot.ID, "failed-message", "reject")
	if err == nil || !strings.Contains(err.Error(), "prompt rejected") {
		t.Fatalf("original delivery error = %v", err)
	}
	if err := manager.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenManager(context.Background(), map[string]Provider{"pi": provider}, statePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restored.Close(context.Background()) })
	duplicate, err := restored.Send(context.Background(), snapshot.ID, "failed-message", "do not retry")
	if err == nil || !strings.Contains(err.Error(), "prompt rejected") {
		t.Fatalf("restored delivery error = %v", err)
	}
	if !duplicate.Duplicate || duplicate.TurnID != original.TurnID || provider.session.promptCalls() != 0 {
		t.Fatalf("restored duplicate = %+v, prompts = %d", duplicate, provider.session.promptCalls())
	}
}

func TestPersistentManagerShutdownMarksActiveTurnInterrupted(t *testing.T) {
	provider := &fakeProvider{}
	statePath := filepath.Join(t.TempDir(), "agents-v1.json")
	manager, err := OpenManager(context.Background(), map[string]Provider{"pi": provider}, statePath)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(context.Background(), snapshot.ID, "active-message", "active"); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	restored, err := OpenManager(context.Background(), map[string]Provider{"pi": provider}, statePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restored.Close(context.Background()) })
	current, err := restored.Get(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Lifecycle != LifecycleError || current.ActiveTurnID != "" || current.LastError != restartInterruptedMessage {
		t.Fatalf("restored active turn = %+v", current)
	}
	if _, err := restored.Send(context.Background(), snapshot.ID, "after-restart", "continue"); err != nil {
		t.Fatalf("resumed Agent did not accept a new prompt: %v", err)
	}
}

func TestPersistentManagerRejectsInvalidStateWithoutRewriting(t *testing.T) {
	cwd := t.TempDir()
	now := time.Now().UTC()
	valid := persistedState{Agents: []persistedAgent{{
		Snapshot: Snapshot{
			ID: "agt_valid", Provider: "pi", CWD: cwd, Lifecycle: LifecycleIdle,
			CreatedAt: now, UpdatedAt: now, TimelineEpoch: "tl_valid",
		},
		Timeline: TimelineSnapshot{Epoch: "tl_valid", Rows: []TimelineRow{}},
	}}}
	tests := map[string]func(*persistedState){
		"duplicate Agent": func(state *persistedState) { state.Agents = append(state.Agents, state.Agents[0]) },
		"bad head":        func(state *persistedState) { state.Agents[0].Snapshot.TimelineHeadSeq = 1 },
		"bad lifecycle":   func(state *persistedState) { state.Agents[0].Snapshot.Lifecycle = Lifecycle("mystery") },
		"bad epoch":       func(state *persistedState) { state.Agents[0].Timeline.Epoch = "tl_other" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "agents-v1.json")
			state := valid
			state.Agents = append([]persistedAgent(nil), valid.Agents...)
			mutate(&state)
			store := newFileStateStore(path)
			if err := store.Save(state); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := OpenManager(context.Background(), map[string]Provider{"pi": &fakeProvider{}}, path); err == nil {
				t.Fatal("invalid state was accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(after) != string(before) {
				t.Fatal("invalid state was rewritten")
			}
		})
	}
}

func TestPersistentManagerHidesMutationUntilSaveCompletes(t *testing.T) {
	provider := &fakeProvider{}
	store := &scriptedStateStore{
		blockAt:     2,
		saveStarted: make(chan struct{}),
		saveRelease: make(chan struct{}),
	}
	manager := newManager(map[string]Provider{"pi": provider}, store)
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sendDone := make(chan error, 1)
	go func() {
		_, sendErr := manager.Send(context.Background(), snapshot.ID, "blocked-save", "prompt")
		sendDone <- sendErr
	}()
	select {
	case <-store.saveStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("Send did not reach state save")
	}
	getDone := make(chan Snapshot, 1)
	go func() {
		current, _ := manager.Get(snapshot.ID)
		getDone <- current
	}()
	select {
	case current := <-getDone:
		t.Fatalf("Get exposed unsaved mutation: %+v", current)
	case <-time.After(30 * time.Millisecond):
	}
	close(store.saveRelease)
	if err := <-sendDone; err != nil {
		t.Fatal(err)
	}
	select {
	case current := <-getDone:
		if current.Lifecycle != LifecycleRunning || current.TimelineHeadSeq != 1 {
			t.Fatalf("saved snapshot = %+v", current)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Get remained blocked after save")
	}
}

func TestPersistentManagerMutationFailuresDoNotEscapeBeforeSave(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		provider := &fakeProvider{}
		store := &scriptedStateStore{failAt: 1}
		manager := newManager(map[string]Provider{"pi": provider}, store)
		t.Cleanup(func() { _ = manager.Close(context.Background()) })
		if _, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()}); err == nil {
			t.Fatal("Create succeeded despite state failure")
		}
		if len(manager.List()) != 0 || !provider.session.wasClosed() {
			t.Fatalf("failed Create leaked Agent/session: entries=%+v closed=%v", manager.List(), provider.session.wasClosed())
		}
	})

	t.Run("send", func(t *testing.T) {
		provider := &fakeProvider{}
		store := &scriptedStateStore{failAt: 2}
		manager := newManager(map[string]Provider{"pi": provider}, store)
		t.Cleanup(func() { _ = manager.Close(context.Background()) })
		snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Send(context.Background(), snapshot.ID, "client", "not delivered"); err == nil {
			t.Fatal("Send succeeded despite state failure")
		}
		timeline, err := manager.Timeline(snapshot.ID)
		if err != nil {
			t.Fatal(err)
		}
		current, err := manager.Get(snapshot.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(timeline.Rows) != 0 || current.Lifecycle != LifecycleIdle || provider.session.promptCalls() != 0 {
			t.Fatalf("failed Send escaped: timeline=%+v snapshot=%+v prompts=%d", timeline, current, provider.session.promptCalls())
		}
	})

	t.Run("provider event", func(t *testing.T) {
		provider := &fakeProvider{}
		store := &scriptedStateStore{failAt: 4}
		manager := newManager(map[string]Provider{"pi": provider}, store)
		t.Cleanup(func() { _ = manager.Close(context.Background()) })
		snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		result, err := manager.Send(context.Background(), snapshot.ID, "client", "accepted")
		if err != nil {
			t.Fatal(err)
		}
		provider.session.emit(ProviderEvent{
			Type: ProviderEventTimeline, TurnID: result.TurnID,
			Item: TimelineItem{Type: TimelineAssistantMessage, Text: "cannot persist"},
		})
		waitFor(t, func() bool {
			current, getErr := manager.Get(snapshot.ID)
			return getErr == nil && current.Lifecycle == LifecycleError &&
				strings.Contains(current.LastError, "persist Agent state") && provider.session.wasClosed()
		})
		timeline, err := manager.Timeline(snapshot.ID)
		if err != nil {
			t.Fatal(err)
		}
		store.mu.Lock()
		persistedRows := len(store.state.Agents[0].Timeline.Rows)
		persistedHead := store.state.Agents[0].Snapshot.TimelineHeadSeq
		store.mu.Unlock()
		if len(timeline.Rows) != 1 || persistedRows != 1 || persistedHead != 1 {
			t.Fatalf("failed event remained visible: timeline=%+v persisted rows/head=%d/%d", timeline, persistedRows, persistedHead)
		}
	})
}

func TestPostReplaceFailureRejectsInFlightCreate(t *testing.T) {
	provider := &fakeProvider{}
	slowSession := newFakeSession()
	slowSession.info.Provider = "slow"
	slow := &gatedStartProvider{
		started: make(chan struct{}),
		release: make(chan struct{}),
		session: slowSession,
	}
	store := &scriptedStateStore{replaceFailAt: 2}
	manager := newManager(map[string]Provider{"pi": provider, "slow": slow}, store)
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	createResult := make(chan error, 1)
	go func() {
		_, createErr := manager.Create(context.Background(), Config{Provider: "slow", CWD: t.TempDir()})
		createResult <- createErr
	}()
	<-slow.started
	if _, err := manager.Send(context.Background(), snapshot.ID, "post-replace", "fail-stop"); err == nil {
		t.Fatal("Send succeeded despite post-replace failure")
	}
	close(slow.release)
	if err := <-createResult; err == nil || !strings.Contains(err.Error(), "injected directory sync failure") {
		t.Fatalf("in-flight Create error = %v, want latched persistence error", err)
	}
	waitFor(t, slow.session.wasClosed)
	if entries := manager.List(); len(entries) != 1 || entries[0].ID != snapshot.ID {
		t.Fatalf("in-flight Create leaked catalog entry: %+v", entries)
	}
}

func TestPostReplaceFailureCancelsInFlightCreate(t *testing.T) {
	provider := &fakeProvider{}
	slow := &blockingProvider{started: make(chan struct{})}
	store := &scriptedStateStore{replaceFailAt: 2}
	manager := newManager(map[string]Provider{"pi": provider, "slow": slow}, store)
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	createResult := make(chan error, 1)
	go func() {
		_, createErr := manager.Create(context.Background(), Config{Provider: "slow", CWD: t.TempDir()})
		createResult <- createErr
	}()
	<-slow.started
	if _, err := manager.Send(context.Background(), snapshot.ID, "post-replace", "cancel starts"); err == nil {
		t.Fatal("Send succeeded despite post-replace failure")
	}
	if err := <-createResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("in-flight provider start error = %v, want context cancellation", err)
	}
	if entries := manager.List(); len(entries) != 1 || entries[0].ID != snapshot.ID {
		t.Fatalf("canceled Create leaked catalog entry: %+v", entries)
	}
}

func TestExplicitCloseUpgradesConcurrentPersistentManagerShutdown(t *testing.T) {
	provider := &fakeProvider{}
	provider.session = newFakeSession()
	provider.session.closeStarted = make(chan struct{})
	provider.session.closeRelease = make(chan struct{})
	manager := newManager(map[string]Provider{"pi": provider}, &scriptedStateStore{})
	snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	entry, mutationDone, err := manager.beginMutation(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	managerClosed := make(chan error, 1)
	go func() { managerClosed <- manager.Close(context.Background()) }()
	<-provider.session.closeStarted

	entry.mu.Lock()
	entry.domainClosing = true
	entry.mu.Unlock()
	explicitClosed := make(chan error, 1)
	go func() { explicitClosed <- manager.closeEntry(context.Background(), entry) }()
	close(provider.session.closeRelease)
	if err := <-explicitClosed; err != nil {
		mutationDone()
		t.Fatal(err)
	}
	mutationDone()
	if err := <-managerClosed; err != nil {
		t.Fatal(err)
	}
	current, err := manager.Get(snapshot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Lifecycle != LifecycleClosed {
		t.Fatalf("explicit close returned without permanent close: %+v", current)
	}
}

func TestPostReplaceFailureFailStopsPersistentManagerWithoutRollback(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		provider := &fakeProvider{}
		store := &scriptedStateStore{replaceFailAt: 1}
		manager := newManager(map[string]Provider{"pi": provider}, store)
		t.Cleanup(func() { _ = manager.Close(context.Background()) })
		if _, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()}); err == nil {
			t.Fatal("Create succeeded despite post-replace failure")
		}
		waitFor(t, provider.session.wasClosed)
		store.mu.Lock()
		persistedAgents := len(store.state.Agents)
		store.mu.Unlock()
		if len(manager.List()) != 1 || persistedAgents != 1 {
			t.Fatalf("post-replace Create rolled back one side: memory=%+v persisted=%d", manager.List(), persistedAgents)
		}
		if _, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()}); err == nil {
			t.Fatal("manager accepted mutation after durability became unknown")
		}
	})

	t.Run("send", func(t *testing.T) {
		provider := &fakeProvider{}
		store := &scriptedStateStore{replaceFailAt: 2}
		manager := newManager(map[string]Provider{"pi": provider}, store)
		t.Cleanup(func() { _ = manager.Close(context.Background()) })
		snapshot, err := manager.Create(context.Background(), Config{Provider: "pi", CWD: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Send(context.Background(), snapshot.ID, "post-replace", "installed but not durable"); err == nil {
			t.Fatal("Send succeeded despite post-replace failure")
		}
		waitFor(t, provider.session.wasClosed)
		timeline, err := manager.Timeline(snapshot.ID)
		if err != nil {
			t.Fatal(err)
		}
		store.mu.Lock()
		persistedRows := len(store.state.Agents[0].Timeline.Rows)
		store.mu.Unlock()
		if len(timeline.Rows) != 1 || persistedRows != 1 || provider.session.promptCalls() != 0 {
			t.Fatalf("post-replace Send diverged: timeline=%+v persisted=%d prompts=%d", timeline, persistedRows, provider.session.promptCalls())
		}
		if _, err := manager.Send(context.Background(), snapshot.ID, "later", "must fail-stop"); err == nil {
			t.Fatal("manager accepted mutation after durability became unknown")
		}
	})
}

type gatedStartProvider struct {
	started chan struct{}
	release chan struct{}
	session *fakeSession
}

func (provider *gatedStartProvider) Start(context.Context, Config) (Session, error) {
	close(provider.started)
	<-provider.release
	return provider.session, nil
}

type scriptedStateStore struct {
	mu            sync.Mutex
	saves         int
	failAt        int
	replaceFailAt int
	blockAt       int
	saveStarted   chan struct{}
	saveRelease   chan struct{}
	state         persistedState
}

func (store *scriptedStateStore) Load() (persistedState, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.state, nil
}

func (store *scriptedStateStore) Save(state persistedState) error {
	store.mu.Lock()
	store.saves++
	saveNumber := store.saves
	if saveNumber == store.failAt {
		store.mu.Unlock()
		return errors.New("injected state failure")
	}
	if saveNumber == store.replaceFailAt {
		store.state = state
		store.mu.Unlock()
		return &stateSaveError{err: errors.New("injected directory sync failure"), replaced: true}
	}
	if saveNumber == store.blockAt {
		close(store.saveStarted)
		release := store.saveRelease
		store.mu.Unlock()
		<-release
		store.mu.Lock()
	}
	store.state = state
	store.mu.Unlock()
	return nil
}
