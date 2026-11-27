package chief

import (
	"context"
	"reflect"
	"testing"
)

func TestRouterL1PassReleasesLocksAndCompletesSoleMission(t *testing.T) {
	f := newPhase2Fixture(t, ThreadStatusVerifying, MissionStatusActive)
	if _, err := f.store.UpdateMission("msn_phase2", func(m *Mission) error {
		m.SharedLocks["owned/file.go"] = "thr_phase2"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	m, err := f.router.RecordVerdict(context.Background(), phase2VerdictInput())
	if err != nil {
		t.Fatalf("RecordVerdict: %v", err)
	}
	if m.Threads[0].Status != ThreadStatusLanded || m.Status != MissionStatusCompleted || m.CompletedAt == nil {
		t.Fatalf("terminal lifecycle = mission %s completedAt %v thread %+v", m.Status, m.CompletedAt, m.Threads[0])
	}
	wantLocks := map[string]string{"existing.go": "thr_other"}
	if !reflect.DeepEqual(m.SharedLocks, wantLocks) {
		t.Fatalf("locks = %#v, want %#v", m.SharedLocks, wantLocks)
	}
	events, err := f.store.ReadEvents("msn_phase2", 0, 0)
	if err != nil || len(events) != 1 || events[0].Kind != EventVerifyPassed || m.HeadSeq != 1 {
		t.Fatalf("state/event transaction: head=%d events=%+v err=%v", m.HeadSeq, events, err)
	}
}

func TestRouterL1PassPreservesActiveAndTerminalSiblings(t *testing.T) {
	f := newPhase2Fixture(t, ThreadStatusVerifying, MissionStatusActive)
	if _, err := f.store.UpdateMission("msn_phase2", func(m *Mission) error {
		m.Threads = append(m.Threads,
			Thread{ID: "thr_active", MissionID: "msn_phase2", Status: ThreadStatusAuthoring},
			Thread{ID: "thr_canceled", MissionID: "msn_phase2", Status: ThreadStatusCanceled},
		)
		m.SharedLocks["owned/file.go"] = "thr_phase2"
		m.SharedLocks["active.go"] = "thr_active"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	m, err := f.router.RecordVerdict(context.Background(), phase2VerdictInput())
	if err != nil {
		t.Fatalf("RecordVerdict: %v", err)
	}
	if m.Status != MissionStatusActive || m.CompletedAt != nil {
		t.Fatalf("mission with active sibling completed: %+v", m)
	}
	if m.Threads[0].Status != ThreadStatusLanded || m.Threads[1].Status != ThreadStatusAuthoring || m.Threads[2].Status != ThreadStatusCanceled {
		t.Fatalf("thread statuses changed incorrectly: %+v", m.Threads)
	}
	wantLocks := map[string]string{"existing.go": "thr_other", "active.go": "thr_active"}
	if !reflect.DeepEqual(m.SharedLocks, wantLocks) {
		t.Fatalf("locks = %#v, want %#v", m.SharedLocks, wantLocks)
	}
}
