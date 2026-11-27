package server

import (
	"context"
	"sync"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/store"
)

type turnCompletedRecordGate struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (g *turnCompletedRecordGate) MarshalJSON() ([]byte, error) {
	g.once.Do(func() { close(g.entered) })
	<-g.release
	return []byte(`"gated"`), nil
}

type turnCompletedRecordSession struct {
	providers.ManagedSession
}

func (s turnCompletedRecordSession) Usage(context.Context) *sdk.AgentUsage {
	return &sdk.AgentUsage{}
}

func (s turnCompletedRecordSession) GetState(context.Context) (*sdk.SessionState, error) {
	return &sdk.SessionState{}, nil
}

func TestHandleTurnCompletedRecordUpdateRace(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	cwd := t.TempDir()
	session := turnCompletedRecordSession{
		ManagedSession: providers.StartMockSession(providers.MockLaunchOptions{Cwd: cwd}),
	}
	rec := store.AgentRecord{
		ID:         "agent-completion-record-race",
		Provider:   "mock",
		Cwd:        cwd,
		CreatedAt:  "2026-01-01T00:00:00Z",
		UpdatedAt:  "2026-01-01T00:00:00Z",
		LastStatus: "running",
		Config:     &store.AgentConfig{},
	}
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	gate := &turnCompletedRecordGate{
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	rec.Config.FeatureValues = map[string]any{"completionGate": gate}
	mp := &managedPi{record: rec, session: session}
	sink := &recordingSink{}
	srv.mu.Lock()
	srv.agents[rec.ID] = mp
	srv.clients[sink] = true
	srv.timelineViews[sink] = map[string]bool{rec.ID: true}
	srv.mu.Unlock()

	const (
		turnID = "turn-completion-record-race"
		now    = "2026-01-01T00:00:01Z"
	)
	completionDone := make(chan struct{})
	go func() {
		srv.handleTurnCompleted(mp, session, rec, turnID, now)
		close(completionDone)
	}()
	<-gate.entered

	updatedTitle := "concurrent record update"
	updated := rec
	updated.ID = "agent-completion-record-replacement"
	updated.LastStatus = "idle"
	updated.UpdatedAt = "2026-01-01T00:00:02Z"
	updated.Title = &updatedTitle
	updated.Config = &store.AgentConfig{}
	updaterDone := make(chan struct{})
	go func() {
		srv.mu.Lock()
		mp.record = updated
		srv.mu.Unlock()
		close(updaterDone)
	}()
	<-updaterDone
	close(gate.release)
	<-completionDone

	srv.mu.Lock()
	got := mp.record
	srv.mu.Unlock()
	if got.ID != updated.ID {
		t.Fatalf("agent ID = %q, want %q", got.ID, updated.ID)
	}
	if got.LastStatus != "idle" {
		t.Fatalf("last status = %q, want idle", got.LastStatus)
	}
	if got.UpdatedAt != updated.UpdatedAt {
		t.Fatalf("updatedAt = %q, want %q", got.UpdatedAt, updated.UpdatedAt)
	}
	if got.Title == nil || *got.Title != updatedTitle {
		t.Fatalf("title = %v, want %q", got.Title, updatedTitle)
	}
	if !got.RequiresAttention {
		t.Fatal("finished agent did not require attention")
	}
	if got.AttentionReason == nil || *got.AttentionReason != AttentionReasonFinished {
		t.Fatalf("attention reason = %v, want %q", got.AttentionReason, AttentionReasonFinished)
	}

	messages := decodeRecordedMessages(t, sink)
	turnCompleted := -1
	terminalUpdate := -1
	var terminalAgent map[string]any
	for i, message := range messages {
		inner, _ := message["message"].(map[string]any)
		payload, _ := inner["payload"].(map[string]any)
		switch inner["type"] {
		case "agent_stream":
			if payload["agentId"] != rec.ID {
				continue
			}
			event, _ := payload["event"].(map[string]any)
			if event["type"] == "turn_completed" && event["turnId"] == turnID {
				turnCompleted = i
			}
		case "agent_update":
			agent, _ := payload["agent"].(map[string]any)
			if agent["id"] == updated.ID && agent["updatedAt"] == updated.UpdatedAt && agent["requiresAttention"] == true {
				terminalUpdate = i
				terminalAgent = agent
			}
		}
	}
	if turnCompleted < 0 {
		t.Fatal("turn_completed was not broadcast")
	}
	if terminalUpdate < turnCompleted {
		t.Fatalf("terminal agent_update index = %d, turn_completed index = %d", terminalUpdate, turnCompleted)
	}
	if terminalAgent["status"] != "idle" {
		t.Fatalf("terminal status = %v, want idle", terminalAgent["status"])
	}
	if terminalAgent["activeTurn"] != nil {
		t.Fatalf("terminal activeTurn = %v, want nil", terminalAgent["activeTurn"])
	}
	if terminalAgent["title"] != updatedTitle {
		t.Fatalf("terminal title = %v, want %q", terminalAgent["title"], updatedTitle)
	}
	if terminalAgent["attentionReason"] != AttentionReasonFinished {
		t.Fatalf("terminal attentionReason = %v, want %q", terminalAgent["attentionReason"], AttentionReasonFinished)
	}
}
