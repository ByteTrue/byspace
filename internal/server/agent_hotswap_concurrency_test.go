package server

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

type hotSwapConcurrentCall struct {
	result AgentHotSwapResult
	err    error
}

func TestAgentHotSwapConcurrentSameProviderDoesNotRollbackCommittedSwap(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleAuthor, "mock", chief.TierStandard)
	first := NewAgentHotSwapService(f.bridge)
	second := NewAgentHotSwapService(f.bridge)
	first.applyOrRestart = f.applyMockRestart
	second.applyOrRestart = f.applyMockRestart

	firstUpserting := make(chan struct{})
	releaseFirst := make(chan struct{})
	first.upsertAgent = func(rec store.AgentRecord) error {
		if rec.Config != nil && derefStr(rec.Config.Model) == "one-minute-stream" {
			close(firstUpserting)
			<-releaseFirst
		}
		return f.srv.store.UpsertAgent(rec)
	}

	firstDone := make(chan hotSwapConcurrentCall, 1)
	go func() {
		result, err := first.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
		firstDone <- hotSwapConcurrentCall{result: result, err: err}
	}()
	select {
	case <-firstUpserting:
	case <-time.After(5 * time.Second):
		t.Fatal("first same-provider swap did not reach its agent write")
	}

	secondDone := make(chan hotSwapConcurrentCall, 1)
	go func() {
		result, err := second.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
		secondDone <- hotSwapConcurrentCall{result: result, err: err}
	}()
	var secondCall hotSwapConcurrentCall
	select {
	case secondCall = <-secondDone:
	case <-time.After(5 * time.Second):
		close(releaseFirst)
		t.Fatal("second same-provider swap did not finish or reject")
	}
	close(releaseFirst)
	var firstCall hotSwapConcurrentCall
	select {
	case firstCall = <-firstDone:
	case <-time.After(5 * time.Second):
		t.Fatal("first same-provider swap did not finish")
	}

	if firstCall.err != nil {
		t.Errorf("first HotSwap() error = %v, want committed swap preserved", firstCall.err)
	}
	if secondCall.err == nil || !strings.Contains(secondCall.err.Error(), "already in progress") {
		t.Errorf("concurrent HotSwap() error = %v, want already in progress", secondCall.err)
	}
	mission, err := f.missions.GetMission(hotSwapMissionID)
	if err != nil {
		t.Fatal(err)
	}
	if got := mission.Threads[0].AuthorProfileID; got != f.targetProfileID() {
		t.Errorf("mission profile after concurrent swaps = %q, want %q", got, f.targetProfileID())
	}
	persisted, err := f.srv.store.GetAgent(f.old.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.srv.mu.Lock()
	mp := f.srv.agents[f.old.ID]
	f.srv.mu.Unlock()
	if persisted == nil || persisted.Config == nil || derefStr(persisted.Config.Model) != "one-minute-stream" {
		t.Errorf("persisted record rolled back over committed swap: %+v", persisted)
	}
	if mp == nil || mp.record.Config == nil || derefStr(mp.record.Config.Model) != "one-minute-stream" {
		t.Errorf("live record rolled back over committed swap: %+v", mp)
	}
}

func TestAgentHotSwapConcurrentCrossProviderSerializesAttempts(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleVerifier, "claude", chief.TierStrong)
	first := NewAgentHotSwapService(f.bridge)
	second := NewAgentHotSwapService(f.bridge)
	second.startAgent = f.startMockTarget

	firstStarting := make(chan struct{})
	releaseFirst := make(chan struct{})
	first.startAgent = func(rec store.AgentRecord) (*managedPi, error) {
		close(firstStarting)
		<-releaseFirst
		return f.startMockTarget(rec)
	}

	firstDone := make(chan hotSwapConcurrentCall, 1)
	go func() {
		result, err := first.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
		firstDone <- hotSwapConcurrentCall{result: result, err: err}
	}()
	select {
	case <-firstStarting:
	case <-time.After(5 * time.Second):
		t.Fatal("first cross-provider swap did not reach target start")
	}

	secondDone := make(chan hotSwapConcurrentCall, 1)
	go func() {
		result, err := second.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
		secondDone <- hotSwapConcurrentCall{result: result, err: err}
	}()
	var secondCall hotSwapConcurrentCall
	select {
	case secondCall = <-secondDone:
	case <-time.After(5 * time.Second):
		close(releaseFirst)
		t.Fatal("second cross-provider swap did not finish or reject")
	}
	close(releaseFirst)
	var firstCall hotSwapConcurrentCall
	select {
	case firstCall = <-firstDone:
	case <-time.After(5 * time.Second):
		t.Fatal("first cross-provider swap did not finish")
	}

	if firstCall.err != nil {
		t.Errorf("first cross-provider HotSwap() error = %v", firstCall.err)
	}
	if secondCall.err == nil || !strings.Contains(secondCall.err.Error(), "already in progress") {
		t.Errorf("concurrent cross-provider HotSwap() error = %v, want already in progress", secondCall.err)
	}
	mission, err := f.missions.GetMission(hotSwapMissionID)
	if err != nil {
		t.Fatal(err)
	}
	replacementID := mission.Threads[0].VerifierAgentID
	if firstCall.err == nil && replacementID != firstCall.result.ReplacementAgentID {
		t.Errorf("mission replacement = %q, want first replacement %q", replacementID, firstCall.result.ReplacementAgentID)
	}
	f.srv.mu.Lock()
	live := f.srv.agents[replacementID]
	agentCount := len(f.srv.agents)
	f.srv.mu.Unlock()
	if live == nil || agentCount != 1 {
		t.Errorf("live agents after concurrent cross-provider swaps = %v, count %d", live != nil, agentCount)
	}
	oldRecord, err := f.srv.store.GetAgent(f.old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if oldRecord == nil || oldRecord.ArchivedAt == nil {
		t.Errorf("old agent was not archived exactly once: %+v", oldRecord)
	}
}
