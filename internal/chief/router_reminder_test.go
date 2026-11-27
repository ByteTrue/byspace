package chief

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func newUnreportedReminderFixture(t *testing.T) (*Store, *Router, *fakeMessenger, string) {
	t.Helper()
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	msg := newFakeMessenger()
	msg.states["ag_author"] = AgentRuntimeState{AgentID: "ag_author", Status: "idle", Loaded: true}
	router := NewRouter(st, RouterHooks{Messenger: msg})
	t.Cleanup(router.Close)
	_, err := st.CreateMission(Mission{
		ID: "msn_reminder", ChiefAgentID: "ag_chief", BaseCwd: homeDir,
		Tier: TierL1, Status: MissionStatusActive,
		Threads: []Thread{{
			ID: "thr_reminder", MissionID: "msn_reminder", Cwd: homeDir,
			Isolation: IsolationNone, Status: ThreadStatusAuthoring, AuthorAgentID: "ag_author",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return st, router, msg, filepath.Join(homeDir, "orchestration", "missions", "msn_reminder", "events.jsonl")
}

func unreportedTurn() TurnCompletionContext {
	return TurnCompletionContext{HasUnreportedChanges: true, ChangedFiles: []string{"main.go"}}
}

func TestRouterUnreportedTurnReminderRetriesAfterEventFailure(t *testing.T) {
	st, router, msg, eventsPath := newUnreportedReminderFixture(t)
	if err := os.WriteFile(eventsPath, nil, 0o400); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(eventsPath, 0o600) })

	if err := router.OnAgentTurnCompleted(context.Background(), "ag_author", unreportedTurn()); err == nil {
		t.Fatal("first OnAgentTurnCompleted() succeeded with read-only events.jsonl")
	}
	if err := os.Chmod(eventsPath, 0o600); err != nil {
		t.Fatal(err)
	}
	afterFailure, err := st.GetMission("msn_reminder")
	if err != nil {
		t.Fatal(err)
	}
	if afterFailure.Threads[0].UnreportedReminderSent {
		t.Error("failed reminder persisted UnreportedReminderSent")
	}
	if afterFailure.HeadSeq != 0 || len(afterFailure.PendingBells) != 0 {
		t.Errorf("failed reminder changed HeadSeq/bells: %+v", afterFailure)
	}
	events, err := st.ReadEvents("msn_reminder", 0, 0)
	if err != nil || len(events) != 0 {
		t.Fatalf("events after failure = %+v, error = %v", events, err)
	}
	if got := len(msg.sentFor("ag_author")); got != 0 {
		t.Fatalf("prompts after failure = %d, want 0", got)
	}

	if err := router.OnAgentTurnCompleted(context.Background(), "ag_author", unreportedTurn()); err != nil {
		t.Fatalf("retry OnAgentTurnCompleted() error = %v", err)
	}
	events, err = st.ReadEvents("msn_reminder", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Kind != EventUnreportedTurnReminded {
		t.Fatalf("retry emitted events = %+v, want one EventUnreportedTurnReminded", events)
	}
	if got := len(msg.sentFor("ag_author")); got != 1 {
		t.Fatalf("retry delivered prompts = %d, want 1", got)
	}
}

func TestRouterUnreportedTurnReminderConcurrentDuplicate(t *testing.T) {
	st, router, msg, _ := newUnreportedReminderFixture(t)
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- router.OnAgentTurnCompleted(context.Background(), "ag_author", unreportedTurn())
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("OnAgentTurnCompleted() error = %v", err)
		}
	}
	events, err := st.ReadEvents("msn_reminder", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Kind != EventUnreportedTurnReminded {
		t.Fatalf("concurrent completions emitted events = %+v, want exactly one reminder", events)
	}
	if got := len(msg.sentFor("ag_author")); got != 1 {
		t.Fatalf("concurrent completions delivered prompts = %d, want 1", got)
	}
}
