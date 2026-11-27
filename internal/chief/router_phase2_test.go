package chief

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

type phase2Fixture struct {
	homeDir   string
	store     *Store
	router    *Router
	messenger *fakeMessenger
}

type phase2Snapshot struct {
	missionRaw      []byte
	eventsRaw       []byte
	mission         *Mission
	events          []Event
	authorPrompts   int
	verifierPrompts int
	chiefPrompts    int
}

func TestRouterPhase2SubmitSourceStates(t *testing.T) {
	legal := []struct {
		name          string
		threadStatus  string
		missionStatus string
	}{
		{name: "queued", threadStatus: ThreadStatusQueued, missionStatus: MissionStatusActive},
		{name: "authoring", threadStatus: ThreadStatusAuthoring, missionStatus: MissionStatusActive},
		{name: "needs rebase", threadStatus: ThreadStatusNeedsRebase, missionStatus: MissionStatusActive},
		{name: "waiting human is not terminal", threadStatus: ThreadStatusAuthoring, missionStatus: MissionStatusWaitingHuman},
	}
	for _, tt := range legal {
		t.Run("legal "+tt.name, func(t *testing.T) {
			f := newPhase2Fixture(t, tt.threadStatus, tt.missionStatus)
			m, err := f.router.SubmitThread(context.Background(), phase2SubmitInput())
			if err != nil {
				t.Fatalf("SubmitThread() error = %v", err)
			}
			if m.Threads[0].Status != ThreadStatusVerifying || m.SharedLocks["owned/file.go"] != "thr_phase2" {
				t.Fatalf("submission did not transition and claim locks: %+v", m.Threads[0])
			}
			events, err := f.store.ReadEvents("msn_phase2", 0, 0)
			if err != nil || len(events) != 1 || events[0].Kind != EventAuthorSubmitted {
				t.Fatalf("events = %+v, error = %v", events, err)
			}
		})
	}
	for _, status := range []string{
		ThreadStatusVerifying, ThreadStatusMergeChecking, ThreadStatusReadyToLand,
		ThreadStatusLanded, ThreadStatusBlocked, ThreadStatusFailed, ThreadStatusCanceled,
	} {
		t.Run("reject "+status, func(t *testing.T) {
			f := newPhase2Fixture(t, status, MissionStatusActive)
			before := capturePhase2Snapshot(t, f)
			if _, err := f.router.SubmitThread(context.Background(), phase2SubmitInput()); !errors.Is(err, ErrInvalidThreadState) {
				t.Fatalf("SubmitThread() error = %v, want ErrInvalidThreadState for %s", err, status)
			}
			assertPhase2Unchanged(t, f, before)
		})
	}
	for _, status := range []string{MissionStatusCompleted, MissionStatusFailed, MissionStatusCanceled} {
		t.Run("reject mission "+status, func(t *testing.T) {
			f := newPhase2Fixture(t, ThreadStatusAuthoring, status)
			before := capturePhase2Snapshot(t, f)
			if _, err := f.router.SubmitThread(context.Background(), phase2SubmitInput()); !errors.Is(err, ErrInvalidThreadState) {
				t.Fatalf("SubmitThread() error = %v, want ErrInvalidThreadState for terminal mission %s", err, status)
			}
			assertPhase2Unchanged(t, f, before)
		})
	}
}

func TestRouterPhase2RejectedSubmitValidationUnchanged(t *testing.T) {
	for _, tt := range []struct {
		name   string
		actor  string
		files  []string
		target error
	}{
		{name: "actor", actor: "ag_other", files: []string{"owned/file.go"}, target: ErrActorMismatch},
		{name: "ownership", actor: "ag_author", files: []string{"other/file.go"}, target: ErrOwnedPathViolation},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := newPhase2Fixture(t, ThreadStatusAuthoring, MissionStatusActive)
			before := capturePhase2Snapshot(t, f)
			in := phase2SubmitInput()
			in.ActorAgentID = tt.actor
			in.ChangedFiles = tt.files
			if _, err := f.router.SubmitThread(context.Background(), in); !errors.Is(err, tt.target) {
				t.Fatalf("SubmitThread() error = %v, want %v", err, tt.target)
			}
			assertPhase2Unchanged(t, f, before)
		})
	}
}

func TestRouterPhase2VerdictSourceStates(t *testing.T) {
	for _, missionStatus := range []string{MissionStatusActive, MissionStatusWaitingHuman} {
		t.Run("legal verifying "+missionStatus, func(t *testing.T) {
			f := newPhase2Fixture(t, ThreadStatusVerifying, missionStatus)
			m, err := f.router.RecordVerdict(context.Background(), phase2VerdictInput())
			if err != nil {
				t.Fatalf("RecordVerdict() error = %v", err)
			}
			if m.Threads[0].Status != ThreadStatusLanded {
				t.Fatalf("status = %s, want landed", m.Threads[0].Status)
			}
			events, err := f.store.ReadEvents("msn_phase2", 0, 0)
			if err != nil || len(events) != 1 || events[0].Kind != EventVerifyPassed {
				t.Fatalf("events = %+v, error = %v", events, err)
			}
		})
	}
	for _, status := range []string{
		ThreadStatusQueued, ThreadStatusAuthoring, ThreadStatusNeedsRebase,
		ThreadStatusMergeChecking, ThreadStatusReadyToLand, ThreadStatusLanded,
		ThreadStatusBlocked, ThreadStatusFailed, ThreadStatusCanceled,
	} {
		t.Run("reject "+status, func(t *testing.T) {
			f := newPhase2Fixture(t, status, MissionStatusActive)
			before := capturePhase2Snapshot(t, f)
			if _, err := f.router.RecordVerdict(context.Background(), phase2VerdictInput()); !errors.Is(err, ErrInvalidThreadState) {
				t.Fatalf("RecordVerdict() error = %v, want ErrInvalidThreadState for %s", err, status)
			}
			assertPhase2Unchanged(t, f, before)
		})
	}
	for _, status := range []string{MissionStatusCompleted, MissionStatusFailed, MissionStatusCanceled} {
		t.Run("reject mission "+status, func(t *testing.T) {
			f := newPhase2Fixture(t, ThreadStatusVerifying, status)
			before := capturePhase2Snapshot(t, f)
			if _, err := f.router.RecordVerdict(context.Background(), phase2VerdictInput()); !errors.Is(err, ErrInvalidThreadState) {
				t.Fatalf("RecordVerdict() error = %v, want ErrInvalidThreadState for terminal mission %s", err, status)
			}
			assertPhase2Unchanged(t, f, before)
		})
	}
}

func TestRouterPhase2EventPersistenceFailureRollsBack(t *testing.T) {
	for _, operation := range []string{"submit", "verdict"} {
		t.Run(operation, func(t *testing.T) {
			threadStatus := ThreadStatusAuthoring
			if operation == "verdict" {
				threadStatus = ThreadStatusVerifying
			}
			f := newPhase2Fixture(t, threadStatus, MissionStatusActive)
			eventsPath := filepath.Join(f.homeDir, "orchestration", "missions", "msn_phase2", "events.jsonl")
			if err := os.WriteFile(eventsPath, []byte{}, 0o400); err != nil {
				t.Fatal(err)
			}
			before := capturePhase2Snapshot(t, f)
			if err := os.Chmod(eventsPath, 0o400); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(eventsPath, 0o600) })
			var err error
			if operation == "submit" {
				_, err = f.router.SubmitThread(context.Background(), phase2SubmitInput())
			} else {
				_, err = f.router.RecordVerdict(context.Background(), phase2VerdictInput())
			}
			if err == nil {
				t.Fatal("event persistence failure was not returned")
			}
			if chmodErr := os.Chmod(eventsPath, 0o600); chmodErr != nil {
				t.Fatal(chmodErr)
			}
			assertPhase2Unchanged(t, f, before)
		})
	}
}

func TestRouterPhase2ConcurrentDuplicateSubmit(t *testing.T) {
	f := newPhase2Fixture(t, ThreadStatusAuthoring, MissionStatusActive)
	errs := runPhase2Concurrently(func() error {
		_, err := f.router.SubmitThread(context.Background(), phase2SubmitInput())
		return err
	})
	assertPhase2ExactlyOneSuccess(t, errs)
	m, err := f.store.GetMission("msn_phase2")
	if err != nil {
		t.Fatal(err)
	}
	events, err := f.store.ReadEvents("msn_phase2", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if m.HeadSeq != 1 || len(events) != 1 || events[0].Kind != EventAuthorSubmitted || len(f.messenger.sentFor("ag_verifier")) != 1 {
		t.Fatalf("duplicate submission: head=%d events=%+v prompts=%d", m.HeadSeq, events, len(f.messenger.sentFor("ag_verifier")))
	}
}

func TestRouterPhase2ConcurrentDuplicateVerdict(t *testing.T) {
	f := newPhase2Fixture(t, ThreadStatusVerifying, MissionStatusActive)
	errs := runPhase2Concurrently(func() error {
		_, err := f.router.RecordVerdict(context.Background(), phase2VerdictInput())
		return err
	})
	assertPhase2ExactlyOneSuccess(t, errs)
	m, err := f.store.GetMission("msn_phase2")
	if err != nil {
		t.Fatal(err)
	}
	events, err := f.store.ReadEvents("msn_phase2", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if m.HeadSeq != 1 || len(events) != 1 || events[0].Kind != EventVerifyPassed || len(f.messenger.sentFor("ag_chief")) != 1 {
		t.Fatalf("duplicate verdict: head=%d events=%+v prompts=%d", m.HeadSeq, events, len(f.messenger.sentFor("ag_chief")))
	}
}

func TestRouterPhase2StaleMergeCheckDoesNotOverwriteTransition(t *testing.T) {
	for _, transition := range []string{"thread canceled", "mission canceled"} {
		t.Run(transition, func(t *testing.T) {
			f := newPhase2Fixture(t, ThreadStatusVerifying, MissionStatusActive)
			if _, err := f.store.UpdateMission("msn_phase2", func(m *Mission) error {
				m.Tier = TierL2
				m.Threads[0].Isolation = IsolationWorktree
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			entered := make(chan struct{})
			release := make(chan struct{})
			f.router.hooks.DryRunMerge = func(context.Context, Mission, Thread) (MergeDryRunResult, error) {
				close(entered)
				<-release
				return MergeDryRunResult{Clean: true}, nil
			}
			result := make(chan error, 1)
			go func() {
				_, err := f.router.RecordVerdict(context.Background(), phase2VerdictInput())
				result <- err
			}()
			<-entered
			if _, err := f.store.UpdateMission("msn_phase2", func(m *Mission) error {
				if transition == "mission canceled" {
					m.Status = MissionStatusCanceled
				} else {
					m.Threads[0].Status = ThreadStatusCanceled
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			close(release)
			if err := <-result; !errors.Is(err, ErrInvalidThreadState) {
				t.Fatalf("stale merge-check error = %v, want ErrInvalidThreadState", err)
			}
			m, err := f.store.GetMission("msn_phase2")
			if err != nil {
				t.Fatal(err)
			}
			events, err := f.store.ReadEvents("msn_phase2", 0, 0)
			if err != nil {
				t.Fatal(err)
			}
			expectedThreadStatus := ThreadStatusCanceled
			if transition == "mission canceled" {
				expectedThreadStatus = ThreadStatusMergeChecking
			}
			if m.Threads[0].Status != expectedThreadStatus || len(events) != 0 || m.HeadSeq != 0 || len(m.PendingBells) != 0 {
				t.Fatalf("stale merge result changed state: mission=%s thread=%+v head=%d events=%+v bells=%+v", m.Status, m.Threads[0], m.HeadSeq, events, m.PendingBells)
			}
			if len(f.messenger.sentFor("ag_chief")) != 0 {
				t.Fatal("stale merge result prompted Chief")
			}
		})
	}
}

func newPhase2Fixture(t *testing.T, threadStatus, missionStatus string) *phase2Fixture {
	t.Helper()
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	messenger := newFakeMessenger()
	for _, agentID := range []string{"ag_author", "ag_verifier", "ag_chief"} {
		messenger.states[agentID] = AgentRuntimeState{AgentID: agentID, Status: "idle", Loaded: true}
	}
	router := NewRouter(st, RouterHooks{Messenger: messenger})
	t.Cleanup(router.Close)
	_, err := st.CreateMission(Mission{
		ID: "msn_phase2", ChiefAgentID: "ag_chief", BaseCwd: homeDir,
		Tier: TierL1, Status: missionStatus,
		SharedLocks: map[string]string{"existing.go": "thr_other"},
		Threads: []Thread{{
			ID: "thr_phase2", MissionID: "msn_phase2", Goal: "phase 2",
			Cwd: homeDir, Status: threadStatus, OwnedPaths: []string{"owned/"},
			AuthorAgentID: "ag_author", VerifierAgentID: "ag_verifier",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return &phase2Fixture{homeDir: homeDir, store: st, router: router, messenger: messenger}
}

func phase2SubmitInput() SubmitThreadInput {
	return SubmitThreadInput{
		MissionID: "msn_phase2", ThreadID: "thr_phase2", ActorAgentID: "ag_author",
		Summary: "ready", ChangedFiles: []string{"owned/file.go"},
	}
}

func phase2VerdictInput() VerdictInput {
	return VerdictInput{
		MissionID: "msn_phase2", ThreadID: "thr_phase2", ActorAgentID: "ag_verifier",
		Outcome: "pass", Summary: "verified",
	}
}

func capturePhase2Snapshot(t *testing.T, f *phase2Fixture) phase2Snapshot {
	t.Helper()
	m, err := f.store.GetMission("msn_phase2")
	if err != nil {
		t.Fatal(err)
	}
	events, err := f.store.ReadEvents("msn_phase2", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(f.homeDir, "orchestration", "missions", "msn_phase2")
	missionRaw, err := os.ReadFile(filepath.Join(dir, "mission.json"))
	if err != nil {
		t.Fatal(err)
	}
	eventsRaw, err := os.ReadFile(filepath.Join(dir, "events.jsonl"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	return phase2Snapshot{
		missionRaw: missionRaw, eventsRaw: eventsRaw, mission: m, events: events,
		authorPrompts:   len(f.messenger.sentFor("ag_author")),
		verifierPrompts: len(f.messenger.sentFor("ag_verifier")),
		chiefPrompts:    len(f.messenger.sentFor("ag_chief")),
	}
}

func assertPhase2Unchanged(t *testing.T, f *phase2Fixture, before phase2Snapshot) {
	t.Helper()
	after := capturePhase2Snapshot(t, f)
	if !bytes.Equal(after.missionRaw, before.missionRaw) || !bytes.Equal(after.eventsRaw, before.eventsRaw) ||
		!reflect.DeepEqual(after.mission, before.mission) || !reflect.DeepEqual(after.events, before.events) ||
		after.authorPrompts != before.authorPrompts || after.verifierPrompts != before.verifierPrompts || after.chiefPrompts != before.chiefPrompts {
		t.Fatalf("rejected operation changed state:\nbefore=%+v\nafter=%+v\nbefore mission=%+v\nafter mission=%+v", before, after, before.mission, after.mission)
	}
}

func runPhase2Concurrently(fn func() error) []error {
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- fn()
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	return []error{<-results, <-results}
}

func assertPhase2ExactlyOneSuccess(t *testing.T, errs []error) {
	t.Helper()
	successes := 0
	for _, err := range errs {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrInvalidThreadState) {
			t.Fatalf("concurrent duplicate error = %v, want ErrInvalidThreadState", err)
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent duplicate errors = %+v, want exactly one success", errs)
	}
}
