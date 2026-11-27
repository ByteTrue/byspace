package chief

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestRouterPhase2AuditVerifierMutationTerminalNoReopen(t *testing.T) {
	tests := []struct {
		name          string
		threadStatus  string
		missionStatus string
	}{
		{name: "landed", threadStatus: ThreadStatusLanded, missionStatus: MissionStatusActive},
		{name: "canceled", threadStatus: ThreadStatusCanceled, missionStatus: MissionStatusActive},
		{name: "failed", threadStatus: ThreadStatusFailed, missionStatus: MissionStatusActive},
		{name: "completed mission", threadStatus: ThreadStatusVerifying, missionStatus: MissionStatusCompleted},
		{name: "canceled mission", threadStatus: ThreadStatusVerifying, missionStatus: MissionStatusCanceled},
		{name: "failed mission", threadStatus: ThreadStatusVerifying, missionStatus: MissionStatusFailed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newPhase2Fixture(t, tt.threadStatus, tt.missionStatus)
			threadID := "thr_phase2"
			verifierID := "ag_verifier"
			prior := VerifyVerdict{Outcome: "pass", Summary: "prior verdict", VerifierAgentID: &verifierID}
			if _, err := f.store.UpdateMission("msn_phase2", func(m *Mission) error {
				m.Threads[0].LastVerdict = &prior
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := f.store.AppendEvent("msn_phase2", Event{
				ThreadID: &threadID, Kind: EventVerifyPassed, ActorAgentID: &verifierID,
				Summary: prior.Summary,
			}); err != nil {
				t.Fatal(err)
			}
			before := capturePhase2Snapshot(t, f)
			m, err := f.router.AuditVerifierMutation(context.Background(), VerdictInput{
				MissionID: "msn_phase2", ThreadID: "thr_phase2", ActorAgentID: "ag_verifier",
				MutationDetails: "blocked worktree changed after verifier turn",
			})
			if err != nil {
				t.Fatalf("AuditVerifierMutation() error = %v", err)
			}
			if m.Status != tt.missionStatus || m.Threads[0].Status != tt.threadStatus || !reflect.DeepEqual(m.Threads[0].LastVerdict, &prior) {
				t.Fatalf("terminal audit reopened or overwrote verdict: mission=%s thread=%+v", m.Status, m.Threads[0])
			}
			events, err := f.store.ReadEvents("msn_phase2", 0, 0)
			if err != nil || len(events) != 2 || events[1].Kind != EventVerifierMutationViolation {
				t.Fatalf("events = %+v, error = %v", events, err)
			}
			if !strings.Contains(events[1].Summary, "blocked worktree changed after verifier turn") || events[1].Payload["postTurnAudit"] != true || events[1].TargetAgentID != nil {
				t.Fatalf("terminal audit evidence = %+v", events[1])
			}
			after := capturePhase2Snapshot(t, f)
			if after.authorPrompts != before.authorPrompts || after.verifierPrompts != before.verifierPrompts || after.chiefPrompts != before.chiefPrompts {
				t.Fatal("terminal audit restarted an agent")
			}
		})
	}
}

func TestRouterPhase2AuditVerifierMutationNonterminalPreservesTaint(t *testing.T) {
	for _, status := range []string{ThreadStatusVerifying, ThreadStatusBlocked, ThreadStatusNeedsRebase} {
		t.Run(status, func(t *testing.T) {
			f := newPhase2Fixture(t, status, MissionStatusActive)
			m, err := f.router.AuditVerifierMutation(context.Background(), VerdictInput{
				MissionID: "msn_phase2", ThreadID: "thr_phase2", ActorAgentID: "ag_verifier",
				MutationDetails: "verifier edited source",
			})
			if err != nil {
				t.Fatalf("AuditVerifierMutation() error = %v", err)
			}
			if m.Threads[0].Status != ThreadStatusBlocked || m.Threads[0].LastVerdict == nil || !m.Threads[0].LastVerdict.Tainted {
				t.Fatalf("nonterminal audit did not preserve taint: %+v", m.Threads[0])
			}
			events, err := f.store.ReadEvents("msn_phase2", 0, 0)
			if err != nil || len(events) == 0 || events[0].Kind != EventVerifierMutationViolation || events[0].TargetAgentID == nil || *events[0].TargetAgentID != "ag_chief" {
				t.Fatalf("events = %+v, error = %v", events, err)
			}
			if len(f.messenger.sentFor("ag_author")) != 0 || len(f.messenger.sentFor("ag_verifier")) != 0 {
				t.Fatal("audit restarted author or verifier")
			}
		})
	}
}
