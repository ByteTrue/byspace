package server

import (
	"context"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

type shutdownBlockingSession struct {
	providers.ManagedSession
	started     chan struct{}
	release     chan struct{}
	closed      chan struct{}
	startOnce   sync.Once
	releaseOnce sync.Once
	closeOnce   sync.Once
}

func newShutdownBlockingSession() *shutdownBlockingSession {
	return &shutdownBlockingSession{
		started: make(chan struct{}),
		release: make(chan struct{}),
		closed:  make(chan struct{}),
	}
}

func (s *shutdownBlockingSession) GetState(ctx context.Context) (*sdk.SessionState, error) {
	s.startOnce.Do(func() { close(s.started) })
	select {
	case <-s.release:
		return &sdk.SessionState{SessionID: "native-session-after-shutdown"}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *shutdownBlockingSession) Close() error {
	s.closeOnce.Do(func() { close(s.closed) })
	return nil
}

func (s *shutdownBlockingSession) Usage(context.Context) *sdk.AgentUsage {
	return &sdk.AgentUsage{}
}

func (s *shutdownBlockingSession) Status() string { return "idle" }

func (s *shutdownBlockingSession) PendingPermissions() []map[string]any { return nil }

func (s *shutdownBlockingSession) ActiveTurn() (string, string) { return "", "" }

type shutdownDeliverySession struct {
	*shutdownBlockingSession
	deliveryDone <-chan struct{}
}

func (s *shutdownDeliverySession) CloseAndWait() error {
	_ = s.Close()
	<-s.deliveryDone
	return nil
}

func (s *shutdownBlockingSession) unblock() {
	s.releaseOnce.Do(func() { close(s.release) })
}

func TestServerCloseWaitsForAgentPersistenceSync(t *testing.T) {
	for _, tc := range []struct {
		name   string
		launch func(*Server, *managedPi)
	}{
		{name: "initial readiness", launch: (*Server).startInitialAgentPersistenceSync},
		{name: "turn completion", launch: (*Server).startAgentPersistenceSync},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, err := New(Options{HomeDir: t.TempDir(), Version: "test"})
			if err != nil {
				t.Fatal(err)
			}
			session := newShutdownBlockingSession()
			rec := store.AgentRecord{ID: "agt_shutdown_sync", Provider: "mock"}
			mp := &managedPi{record: rec, session: session}
			srv.mu.Lock()
			srv.agents[rec.ID] = mp
			srv.mu.Unlock()

			var closeOnce sync.Once
			var closeErr error
			closeServer := func() error {
				closeOnce.Do(func() { closeErr = srv.Close() })
				return closeErr
			}
			t.Cleanup(func() {
				session.unblock()
				_ = closeServer()
			})

			tc.launch(srv, mp)
			awaitShutdownSignal(t, session.started, "GetState")
			closeDone := make(chan error, 1)
			go func() { closeDone <- closeServer() }()
			awaitShutdownSignal(t, session.closed, "agent session Close")

			// The session has closed, so no completion path can still be launched. Close must
			// now be waiting for the gated persistence write, not racing test cleanup.
			runtime.Gosched()
			select {
			case err := <-closeDone:
				t.Fatalf("Close returned while GetState was blocked: %v", err)
			default:
			}

			session.unblock()
			select {
			case err := <-closeDone:
				if err != nil {
					t.Fatalf("Close: %v", err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("deadlock: Close did not finish after GetState was released")
			}

			persisted, err := srv.store.GetAgent(rec.ID)
			if err != nil {
				t.Fatalf("read persisted agent after Close: %v", err)
			}
			if persisted == nil || persisted.Persistence == nil {
				t.Fatalf("Close returned before agent JSON persistence: %+v", persisted)
			}
			if persisted.Persistence.SessionID != "native-session-after-shutdown" || persisted.Persistence.NativeHandle != "native-session-after-shutdown" {
				t.Fatalf("persisted native handle = %+v", persisted.Persistence)
			}
		})
	}
}

func TestServerCloseDrainsBlockedCompletionBeforePersistenceWait(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	deliveryDone := make(chan struct{})
	session := &shutdownDeliverySession{shutdownBlockingSession: newShutdownBlockingSession(), deliveryDone: deliveryDone}
	rec := store.AgentRecord{ID: "agt_shutdown_delivery", Provider: "codex"}
	mp := &managedPi{record: rec, session: session}
	srv.mu.Lock()
	srv.agents[rec.ID] = mp
	srv.mu.Unlock()

	var closeOnce sync.Once
	var closeErr error
	closeServer := func() error {
		closeOnce.Do(func() { closeErr = srv.Close() })
		return closeErr
	}
	t.Cleanup(func() {
		session.unblock()
		_ = closeServer()
	})

	deliveryStarted := make(chan struct{})
	releaseDelivery := make(chan struct{})
	go func() {
		close(deliveryStarted)
		<-releaseDelivery
		srv.handleTurnCompleted(mp, session, rec, "turn-blocked-by-shutdown", time.Now().UTC().Format(time.RFC3339Nano))
		close(deliveryDone)
	}()
	awaitShutdownSignal(t, deliveryStarted, "blocked agent_end delivery")

	closeDone := make(chan error, 1)
	go func() { closeDone <- closeServer() }()
	awaitShutdownSignal(t, session.closed, "nonblocking provider Close")
	runtime.Gosched()
	closeReturned := false
	select {
	case <-closeDone:
		closeReturned = true
	default:
	}

	close(releaseDelivery)
	awaitShutdownSignal(t, session.started, "completion GetState")
	select {
	case <-closeDone:
		closeReturned = true
	default:
	}
	if closeReturned {
		// Let the late write finish before TempDir cleanup, proving it happened after Close.
		session.unblock()
		srv.agentPersistence.Wait()
		t.Fatal("Close returned before an active agent_end delivery launched and completed persistence")
	}

	session.unblock()
	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("deadlock: Close did not drain delivery and persistence")
	}
	persisted, err := srv.store.GetAgent(rec.ID)
	if err != nil || persisted == nil || persisted.Persistence == nil {
		t.Fatalf("completion native handle was not persisted before Close returned: record=%+v err=%v", persisted, err)
	}
}

type shutdownChiefMessenger struct {
	started     chan struct{}
	release     chan struct{}
	startOnce   sync.Once
	releaseOnce sync.Once
}

func newShutdownChiefMessenger() *shutdownChiefMessenger {
	return &shutdownChiefMessenger{started: make(chan struct{}), release: make(chan struct{})}
}

func (m *shutdownChiefMessenger) GetAgentState(agentID string) chief.AgentRuntimeState {
	return chief.AgentRuntimeState{AgentID: agentID, Loaded: true, Status: "idle"}
}

func (m *shutdownChiefMessenger) EnsureLoaded(context.Context, string) error { return nil }

func (m *shutdownChiefMessenger) SendPrompt(context.Context, string, string) error {
	m.startOnce.Do(func() { close(m.started) })
	<-m.release
	return nil
}

func (m *shutdownChiefMessenger) unblock() {
	m.releaseOnce.Do(func() { close(m.release) })
}

func TestServerCloseWaitsForChiefTurnCompletionTasks(t *testing.T) {
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	messenger := newShutdownChiefMessenger()
	// Keep this test's pending bell out of the boot-time replay attached to the original bridge.
	chiefStore := chief.NewStore(t.TempDir())
	srv.chief = &chiefBridge{
		srv: srv, store: chiefStore,
		router: chief.NewRouter(chiefStore, chief.RouterHooks{Messenger: messenger}),
	}

	const (
		missionID = "msn_chief_shutdown"
		threadID  = "thr_chief_shutdown"
		authorID  = "agt_chief_shutdown"
	)
	baseCwd := t.TempDir()
	if _, err := srv.chief.store.CreateMission(chief.Mission{
		ID: missionID, BaseCwd: baseCwd, Tier: chief.TierL1, Status: chief.MissionStatusActive,
		Threads: []chief.Thread{{
			ID: threadID, MissionID: missionID, Cwd: baseCwd, Isolation: chief.IsolationNone,
			Status: chief.ThreadStatusAuthoring, AuthorAgentID: authorID,
		}},
	}); err != nil {
		t.Fatalf("CreateMission: %v", err)
	}
	event, err := srv.chief.store.AppendEvent(missionID, chief.Event{
		ThreadID: chiefStrPtr(threadID), Kind: chief.EventAuthorSubmitted,
		TargetAgentID: chiefStrPtr(authorID), Summary: "completion bell gated by shutdown test",
	})
	if err != nil {
		t.Fatalf("AppendEvent: %v", err)
	}

	rec := store.AgentRecord{
		ID: authorID, Provider: "mock", LastStatus: "running",
		Labels: chief.BuildOrchestrationLabels(missionID, threadID, chief.RoleAuthor, true),
	}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	session := newShutdownBlockingSession()
	session.unblock() // Agent persistence is immediate; the Chief SendPrompt is the only gate.
	mp := &managedPi{record: rec, session: session}
	srv.mu.Lock()
	srv.agents[rec.ID] = mp
	srv.mu.Unlock()

	var closeOnce sync.Once
	var closeErr error
	closeServer := func() error {
		closeOnce.Do(func() { closeErr = srv.Close() })
		return closeErr
	}
	t.Cleanup(func() {
		messenger.unblock()
		_ = closeServer()
	})

	go srv.handleTurnCompleted(mp, session, rec, "turn-chief-shutdown", time.Now().UTC().Format(time.RFC3339Nano))
	awaitShutdownSignal(t, messenger.started, "Chief pending-bell SendPrompt")
	during, err := srv.chief.store.GetMission(missionID)
	if err != nil || during == nil {
		t.Fatalf("read mission at SendPrompt gate: %v", err)
	}
	if during.Threads[0].LastProgressAt == "" {
		t.Fatal("SendPrompt gate was reached before RecordProgress")
	}
	if during.Cursors[authorID] != 0 || during.PendingBells[authorID] == nil {
		t.Fatalf("bell completed before SendPrompt was released: cursor=%d pending=%+v", during.Cursors[authorID], during.PendingBells[authorID])
	}

	closeDone := make(chan error, 1)
	go func() { closeDone <- closeServer() }()
	awaitShutdownSignal(t, session.closed, "agent session Close")
	runtime.Gosched()
	select {
	case err := <-closeDone:
		messenger.unblock()
		t.Fatalf("Close returned while Chief SendPrompt and MarkBellDelivered were pending: %v", err)
	default:
	}

	messenger.unblock()
	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("deadlock: Close did not finish after Chief SendPrompt was released")
	}
	after, err := srv.chief.store.GetMission(missionID)
	if err != nil || after == nil {
		t.Fatalf("read mission after Close: %v", err)
	}
	if after.Cursors[authorID] != event.Seq || after.PendingBells[authorID] != nil {
		t.Fatalf("Close returned before MarkBellDelivered: cursor=%d want=%d pending=%+v", after.Cursors[authorID], event.Seq, after.PendingBells[authorID])
	}
}

func awaitShutdownSignal(t *testing.T, ch <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(10 * time.Second):
		t.Fatalf("deadlock: timed out waiting for %s", name)
	}
}
