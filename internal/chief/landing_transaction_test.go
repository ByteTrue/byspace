package chief

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

type landingAtomicSnapshot struct {
	missionRaw        []byte
	eventsRaw         []byte
	mission           *Mission
	events            []Event
	chiefPrompts      int
	authorPrompts     int
	integratorPrompts int
}

func captureLandingAtomicSnapshot(t *testing.T, f *landingFixture) landingAtomicSnapshot {
	t.Helper()
	m, err := f.store.GetMission("msn_land")
	if err != nil {
		t.Fatal(err)
	}
	events, err := f.store.ReadEvents("msn_land", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(f.home, "orchestration", "missions", "msn_land")
	missionRaw, err := os.ReadFile(filepath.Join(dir, "mission.json"))
	if err != nil {
		t.Fatal(err)
	}
	eventsRaw, err := os.ReadFile(filepath.Join(dir, "events.jsonl"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	return landingAtomicSnapshot{
		missionRaw: missionRaw, eventsRaw: eventsRaw, mission: m, events: events,
		chiefPrompts:      len(f.messenger.sentFor("ag_chief")),
		authorPrompts:     len(f.messenger.sentFor("author_thr_a")),
		integratorPrompts: len(f.messenger.sentFor("integrator_thr_a")),
	}
}

func assertLandingAtomicUnchanged(t *testing.T, before, after landingAtomicSnapshot) {
	t.Helper()
	if !bytes.Equal(before.missionRaw, after.missionRaw) || !bytes.Equal(before.eventsRaw, after.eventsRaw) ||
		!reflect.DeepEqual(before.mission, after.mission) || !reflect.DeepEqual(before.events, after.events) ||
		before.chiefPrompts != after.chiefPrompts || before.authorPrompts != after.authorPrompts ||
		before.integratorPrompts != after.integratorPrompts {
		t.Fatalf("merge check changed state: before=%+v after=%+v before mission=%+v after mission=%+v", before, after, before.mission, after.mission)
	}
}

func newLandingMergeCheckingFixture(t *testing.T) *landingFixture {
	t.Helper()
	th := landingVerifiedThread("thr_a")
	th.Status = ThreadStatusMergeChecking
	th.MergeCheck = nil
	return newLandingFixture(t, []Thread{th}, LandingPolicy{Mode: "merge_local", Strategy: "squash"})
}

func TestLandingMergeCheckEventAppendFailureIsAtomic(t *testing.T) {
	f := newLandingMergeCheckingFixture(t)
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	eventsPath := filepath.Join(f.home, "orchestration", "missions", "msn_land", "events.jsonl")
	if err := os.WriteFile(eventsPath, nil, 0o400); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(eventsPath, 0o600) })
	before := captureLandingAtomicSnapshot(t, f)

	_, err := svc.MergeCheck(context.Background(), "msn_land", "thr_a", "")
	if err == nil {
		t.Fatal("MergeCheck() succeeded with read-only events.jsonl")
	}
	if err := os.Chmod(eventsPath, 0o600); err != nil {
		t.Fatal(err)
	}
	after := captureLandingAtomicSnapshot(t, f)
	assertLandingAtomicUnchanged(t, before, after)
}

func TestLandingMergeCheckStaleResultDoesNotMutate(t *testing.T) {
	for _, tt := range []struct {
		name   string
		cancel func(*Mission)
	}{
		{name: "thread canceled", cancel: func(m *Mission) { findThread(m, "thr_a").Status = ThreadStatusCanceled }},
		{name: "mission canceled", cancel: func(m *Mission) { m.Status = MissionStatusCanceled }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := newLandingMergeCheckingFixture(t)
			entered := make(chan struct{})
			release := make(chan struct{})
			svc := NewLandingService(f.store, f.router, LandingHooks{
				DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
					close(entered)
					<-release
					return cleanLandingCheck(th), nil
				},
				Now: func() time.Time { return landingTestNow },
			})
			type result struct {
				mission *Mission
				err     error
			}
			resultCh := make(chan result, 1)
			go func() {
				m, err := svc.MergeCheck(context.Background(), "msn_land", "thr_a", "")
				resultCh <- result{mission: m, err: err}
			}()
			<-entered
			if _, err := f.store.UpdateMission("msn_land", func(m *Mission) error {
				tt.cancel(m)
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before := captureLandingAtomicSnapshot(t, f)
			close(release)
			got := <-resultCh
			if !errors.Is(got.err, ErrInvalidThreadState) {
				t.Errorf("stale MergeCheck() error = %v, want ErrInvalidThreadState", got.err)
			}
			after := captureLandingAtomicSnapshot(t, f)
			assertLandingAtomicUnchanged(t, before, after)
		})
	}
}
