package server

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/workspace"
)

func landingRequestApproval(t *testing.T, f *chiefLandingFixture, strategy, message string) map[string]any {
	t.Helper()
	p := callChiefRPC(t, f.srv, "chief.thread.land.request", map[string]any{
		"requestId": "closure-request-" + strategy, "missionId": f.missionID, "threadId": f.threadID,
		"strategy": strategy, "commitMessage": message,
	})
	if landingAccepted(p) || p["approvalRequired"] != true || landingError(p) != "" {
		t.Fatalf("landing approval request failed: %+v", p)
	}
	return p
}

func TestChiefLandingResolveUsesFrozenStrategyAndMessage(t *testing.T) {
	t.Run("merge strategy survives policy change", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		landingRequestApproval(t, f, "merge", "merge through saved decision")
		decision := f.mission(t).PendingDecision
		if decision == nil || decision.LandingStrategy != "merge" {
			t.Fatalf("effective merge strategy was not frozen: %+v", decision)
		}
		if _, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
			m.Landing.Strategy = "rebase"
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		resolved := landingResolve(t, f, decision.ID, chief.LandingOptionApprove)
		if landingError(resolved) != "" {
			t.Fatalf("saved merge strategy was not used: %+v", resolved)
		}
		parents := strings.Fields(landingTestGit(t, f.targetCwd, "rev-list", "--parents", "-n", "1", "HEAD"))
		if len(parents) != 3 {
			t.Fatalf("landing did not create merge topology: %q", parents)
		}
		events, err := f.srv.chief.store.ReadEvents(f.missionID, 0, 0)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, event := range events {
			if event.Kind == chief.EventThreadLanded && event.Payload["strategy"] == "merge" {
				found = true
			}
		}
		if !found {
			t.Fatalf("landed event did not record merge strategy: %+v", events)
		}
	})

	t.Run("custom squash message survives exactly", func(t *testing.T) {
		f := newChiefLandingFixture(t, true)
		const message = "custom squash message preserved by approval"
		landingRequestApproval(t, f, "squash", message)
		decision := f.mission(t).PendingDecision
		if decision == nil || decision.LandingCommitMessage != message {
			t.Fatalf("custom commit message was not frozen: %+v", decision)
		}
		resolved := landingResolve(t, f, decision.ID, chief.LandingOptionApprove)
		if landingError(resolved) != "" {
			t.Fatalf("saved squash message approval failed: %+v", resolved)
		}
		if got := landingTestGit(t, f.targetCwd, "log", "-1", "--pretty=%B"); got != message {
			t.Fatalf("commit message = %q, want exactly %q", got, message)
		}
	})
}

func landingSessionPayload(msg map[string]any) (string, map[string]any) {
	if inner, _ := msg["message"].(map[string]any); inner != nil {
		kind, _ := inner["type"].(string)
		payload, _ := inner["payload"].(map[string]any)
		return kind, payload
	}
	kind, _ := msg["type"].(string)
	payload, _ := msg["payload"].(map[string]any)
	return kind, payload
}

func TestChiefLandingResolveFailurePersistsOutcomeAndRequiresNewApproval(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	landingRequestApproval(t, f, "squash", "persist deterministic failure")
	decision := f.mission(t).PendingDecision
	dirt := filepath.Join(f.targetCwd, "blocking-dirt.txt")
	if err := os.WriteFile(dirt, []byte("block landing\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	observer := &recordingSink{}
	f.srv.mu.Lock()
	if f.srv.clients == nil {
		f.srv.clients = make(map[frameSink]bool)
	}
	f.srv.clients[observer] = true
	f.srv.mu.Unlock()
	t.Cleanup(func() {
		f.srv.mu.Lock()
		delete(f.srv.clients, observer)
		f.srv.mu.Unlock()
	})

	before := f.head(t)
	failed := landingResolve(t, f, decision.ID, chief.LandingOptionApprove)
	if !strings.Contains(landingError(failed), "clean worktrees") {
		t.Fatalf("deterministic pre-Git failure = %+v", failed)
	}
	stored := f.mission(t).PendingDecision
	if stored == nil || stored.ResolvedAt == nil || stored.LandingError != landingError(failed) {
		t.Fatalf("landing failure was not persisted on resolved decision: stored=%+v response=%+v", stored, failed)
	}
	responseDecision := landingPendingDecision(landingMissionFromPayload(failed))
	if responseDecision["landingError"] != stored.LandingError {
		t.Fatalf("response hid persisted landingError: %+v", failed)
	}
	broadcastSeen := false
	for _, msg := range decodeRecordedMessages(t, observer) {
		kind, payload := landingSessionPayload(msg)
		if kind != "chief.mission.update" {
			continue
		}
		mission, _ := payload["mission"].(map[string]any)
		updated := landingPendingDecision(mission)
		if updated["id"] == decision.ID && updated["landingError"] == stored.LandingError {
			broadcastSeen = true
		}
	}
	if !broadcastSeen {
		t.Fatalf("broadcast hid resolved landingError: %+v", decodeRecordedMessages(t, observer))
	}

	if err := os.Remove(dirt); err != nil {
		t.Fatal(err)
	}
	again := landingResolve(t, f, decision.ID, chief.LandingOptionApprove)
	if landingError(again) == "" || f.head(t) != before || f.thread(t, f.threadID).Status != chief.ThreadStatusReadyToLand {
		t.Fatalf("resolved decision executed again after its failure was cleared: %+v", again)
	}
	fresh := landingRequestApproval(t, f, "squash", "new explicit approval after failure")
	freshDecision := landingPendingDecision(landingMissionFromPayload(fresh))
	if freshDecision["id"] == decision.ID || freshDecision["resolvedAt"] != nil || freshDecision["landingError"] != nil {
		t.Fatalf("explicit land did not create a fresh approval: old=%+v new=%+v", decision, freshDecision)
	}
}

func TestChiefLandingConcurrentResolvePersistsPostLandErrorOnce(t *testing.T) {
	f := newChiefLandingFixture(t, true)
	landingRequestApproval(t, f, "squash", "one post-land outcome")
	decision := f.mission(t).PendingDecision
	var landerMu sync.Mutex
	landerCalls := 0
	f.srv.chief.landing = chief.NewLandingService(f.srv.chief.store, f.srv.chief.router, chief.LandingHooks{
		DryRunMerge: f.srv.chief.dryRunMerge,
		LandBranch: func(context.Context, workspace.LandOptions) (workspace.LandResult, error) {
			landerMu.Lock()
			landerCalls++
			landerMu.Unlock()
			return workspace.LandResult{}, &chief.PostLandError{
				TargetSha: "target-sha-from-injected-lander",
				SourceSha: "source-sha-from-injected-lander",
				Err:       errors.New("injected post-land outcome failure"),
			}
		},
	})

	responses := make([]map[string]any, 2)
	var wg sync.WaitGroup
	for i := range responses {
		body, err := json.Marshal(map[string]any{
			"type": "chief.mission.resolve_decision.request", "requestId": "concurrent-resolve",
			"missionId": f.missionID, "decisionId": decision.ID, "optionId": chief.LandingOptionApprove,
		})
		if err != nil {
			t.Fatal(err)
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sink := &recordingSink{}
			f.srv.handleSessionMessage(context.Background(), sink, body)
			msgs := decodeRecordedMessages(t, sink)
			if len(msgs) == 0 {
				return
			}
			_, responses[i] = landingSessionPayload(msgs[len(msgs)-1])
		}(i)
	}
	wg.Wait()
	outcomes := 0
	for _, response := range responses {
		if strings.Contains(landingError(response), "injected post-land outcome failure") {
			outcomes++
			decision := landingPendingDecision(landingMissionFromPayload(response))
			persistedError, _ := decision["landingError"].(string)
			if !strings.Contains(persistedError, "target-sha-from-injected-lander") ||
				!strings.Contains(persistedError, "source-sha-from-injected-lander") {
				t.Fatalf("response lost PostLandError SHAs: %+v", response)
			}
		}
	}
	if outcomes != 1 {
		t.Fatalf("concurrent resolves produced %d landing outcomes: %+v", outcomes, responses)
	}
	landerMu.Lock()
	calls := landerCalls
	landerMu.Unlock()
	if calls != 1 {
		t.Fatalf("concurrent resolves executed lander %d times, want once", calls)
	}
	stored := f.mission(t).PendingDecision
	if stored == nil || stored.ID != decision.ID || stored.LandingError == "" ||
		!strings.Contains(stored.LandingError, "target-sha-from-injected-lander") ||
		!strings.Contains(stored.LandingError, "source-sha-from-injected-lander") {
		t.Fatalf("PostLandError was not persisted with SHAs: %+v", stored)
	}
	if got := f.thread(t, f.threadID).Status; got != chief.ThreadStatusReadyToLand {
		t.Fatalf("injected failure changed ready thread to %s", got)
	}

	reconciled, err := f.srv.reconcileChiefReadyThreads(context.Background(), f.missionID)
	if err != nil {
		t.Fatalf("reconcile after landing failure: %v", err)
	}
	if reconciled.PendingDecision == nil || reconciled.PendingDecision.ID != decision.ID || reconciled.PendingDecision.LandingError != stored.LandingError {
		t.Fatalf("reconcile replaced failed decision: %+v", reconciled.PendingDecision)
	}
	_ = landingResolve(t, f, decision.ID, chief.LandingOptionApprove)
	landerMu.Lock()
	calls = landerCalls
	landerMu.Unlock()
	if calls != 1 {
		t.Fatalf("reconcile/re-resolve retried failed landing: calls=%d", calls)
	}
}
