package chief

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

func landingDecisionWire(t *testing.T, decision *HumanDecision) map[string]any {
	t.Helper()
	raw, err := json.Marshal(decision)
	if err != nil {
		t.Fatalf("marshal decision: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatalf("unmarshal decision: %v", err)
	}
	return wire
}

func TestLandThreadApprovalPersistsEffectiveParametersAndReusesDecision(t *testing.T) {
	f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{
		RequireHumanApproval: true,
		Mode:                 "merge_local",
		Strategy:             "squash",
	})
	svc := NewLandingService(f.store, f.router, LandingHooks{
		Now: func() time.Time { return landingTestNow },
	})

	first, err := svc.LandThread(context.Background(), LandThreadInput{
		MissionID:     "msn_land",
		ThreadID:      "thr_a",
		Strategy:      "rebase",
		CommitMessage: "  custom landing message  ",
	})
	if err != nil || !first.ApprovalRequired || first.Decision == nil {
		t.Fatalf("first approval = %+v, err=%v", first, err)
	}
	wire := landingDecisionWire(t, first.Decision)
	if wire["landingStrategy"] != "rebase" || wire["landingCommitMessage"] != "custom landing message" {
		t.Fatalf("decision wire fields = %+v, want effective rebase strategy and normalized message", wire)
	}

	reloaded := NewStore(f.home)
	m, err := reloaded.GetMission("msn_land")
	if err != nil {
		t.Fatalf("reload mission: %v", err)
	}
	wire = landingDecisionWire(t, m.PendingDecision)
	if wire["landingStrategy"] != "rebase" || wire["landingCommitMessage"] != "custom landing message" {
		t.Fatalf("reloaded decision wire fields = %+v", wire)
	}

	if _, err := f.store.UpdateMission("msn_land", func(m *Mission) error {
		m.Landing.Strategy = "merge"
		return nil
	}); err != nil {
		t.Fatalf("change landing config: %v", err)
	}
	again, err := svc.LandThread(context.Background(), LandThreadInput{
		MissionID:     "msn_land",
		ThreadID:      "thr_a",
		Strategy:      "squash",
		CommitMessage: "replacement message",
	})
	if err != nil || !again.ApprovalRequired || again.Decision == nil {
		t.Fatalf("repeated approval = %+v, err=%v", again, err)
	}
	if !reflect.DeepEqual(again.Decision, first.Decision) {
		t.Fatalf("unresolved decision changed:\nfirst=%+v\nagain=%+v", first.Decision, again.Decision)
	}
	events, err := f.store.ReadEvents("msn_land", 0, 0)
	if err != nil || len(events) != 1 || events[0].Kind != EventDecisionRequested {
		t.Fatalf("events = %+v, err=%v; repeat must not append an event", events, err)
	}
}

func TestLandThreadNewApprovalAfterResolutionGetsFreshID(t *testing.T) {
	f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{
		RequireHumanApproval: true,
		Mode:                 "merge_local",
		Strategy:             "squash",
	})
	svc := NewLandingService(f.store, f.router, LandingHooks{
		Now: func() time.Time { return landingTestNow },
	})
	first, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	if err != nil || first.Decision == nil {
		t.Fatalf("first approval = %+v, err=%v", first, err)
	}
	if _, err := f.store.UpdateMission("msn_land", func(m *Mission) error {
		now := landingTestNow.Format(time.RFC3339Nano)
		hold := LandingOptionHold
		m.PendingDecision.ResolvedAt = &now
		m.PendingDecision.SelectedOptionID = &hold
		m.Status = MissionStatusActive
		return nil
	}); err != nil {
		t.Fatalf("resolve hold: %v", err)
	}

	next, err := svc.LandThread(context.Background(), LandThreadInput{MissionID: "msn_land", ThreadID: "thr_a"})
	if err != nil || next.Decision == nil {
		t.Fatalf("next approval = %+v, err=%v", next, err)
	}
	if next.Decision.ID == first.Decision.ID {
		t.Fatalf("post-resolution decision reused ID %q", next.Decision.ID)
	}
	events, err := f.store.ReadEvents("msn_land", 0, 0)
	if err != nil || len(events) != 2 || events[1].Payload["decisionId"] != next.Decision.ID {
		t.Fatalf("events = %+v, err=%v; new decision must have its own request event", events, err)
	}
}

func TestLandThreadEventAppendFailureRollsBackDurableLanding(t *testing.T) {
	f := newLandingFixture(t, []Thread{landingVerifiedThread("thr_a")}, LandingPolicy{
		Mode:     "merge_local",
		Strategy: "squash",
	})
	landCalls := 0
	svc := NewLandingService(f.store, f.router, LandingHooks{
		DryRunMerge: func(_ context.Context, _ Mission, th Thread) (MergeDryRunResult, error) {
			return cleanLandingCheck(th), nil
		},
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			landCalls++
			return workspace.LandResult{TargetSha: "target-after", SourceSha: "source-verified"}, nil
		},
		Now: func() time.Time { return landingTestNow },
	})
	eventsPath := filepath.Join(f.home, "orchestration", "missions", "msn_land", "events.jsonl")
	if err := os.WriteFile(eventsPath, nil, 0o400); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(eventsPath, 0o600) })

	result, err := svc.LandThread(context.Background(), LandThreadInput{
		MissionID:     "msn_land",
		ThreadID:      "thr_a",
		CommitMessage: "land atomically",
	})
	var postLand *PostLandError
	if !errors.As(err, &postLand) {
		t.Fatalf("LandThread error = %v, want PostLandError", err)
	}
	if result.LandResult == nil || result.LandResult.TargetSha != "target-after" || landCalls != 1 {
		t.Fatalf("result = %+v, landCalls=%d; Git result must be retained without retry", result, landCalls)
	}
	if err := os.Chmod(eventsPath, 0o600); err != nil {
		t.Fatal(err)
	}

	for name, store := range map[string]*Store{"original": f.store, "reloaded": NewStore(f.home)} {
		m, getErr := store.GetMission("msn_land")
		if getErr != nil {
			t.Fatalf("%s store GetMission: %v", name, getErr)
		}
		if m.Status != MissionStatusActive || m.CompletedAt != nil {
			t.Fatalf("%s store mission terminal state = %+v without landed event", name, m)
		}
		th := landingThread(t, m, "thr_a")
		if th.Status != ThreadStatusReadyToLand {
			t.Fatalf("%s store thread status = %s without landed event", name, th.Status)
		}
		if m.SharedLocks["locks/thr_a.go"] != "thr_a" {
			t.Fatalf("%s store released landing locks without event: %+v", name, m.SharedLocks)
		}
		events, readErr := store.ReadEvents("msn_land", 0, 0)
		if readErr != nil || len(events) != 0 {
			t.Fatalf("%s store events = %+v, err=%v; want none", name, events, readErr)
		}
	}
	if got := len(f.messenger.sentFor("ag_chief")); got != 0 {
		t.Fatalf("Chief bell count = %d, want 0 after rolled-back commit", got)
	}
}
