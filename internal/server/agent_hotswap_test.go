package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

const (
	hotSwapOldAgentID = "agent-old"
	hotSwapMissionID  = "mission-hot-swap"
	hotSwapThreadID   = "thread-hot-swap"
)

type hotSwapFixture struct {
	srv        *Server
	missions   *chief.Store
	bridge     *chiefBridge
	service    *AgentHotSwapService
	old        store.AgentRecord
	oldSession *providers.MockSession
}

func newHotSwapFixture(t *testing.T, role, targetProvider, targetTier string) *hotSwapFixture {
	t.Helper()
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv := newTestServer(t, t.TempDir())
	missions := chief.NewStore(srv.homeDir)
	cwd := t.TempDir()
	title := "Preserve this title"
	parent := "agent-parent"
	mode := providers.MockModeID
	model := "five-minute-stream"
	thinking := "low"
	errorText := "old provider error"
	old := store.AgentRecord{
		ID:            hotSwapOldAgentID,
		Provider:      providers.MockProviderID,
		Cwd:           cwd,
		WorkspaceID:   "workspace-preserved",
		ParentAgentID: &parent,
		CreatedAt:     "2026-01-01T00:00:00Z",
		UpdatedAt:     "2026-01-01T00:00:00Z",
		Title:         &title,
		Labels: map[string]string{
			"orchestration.missionId": hotSwapMissionID,
			"orchestration.threadId":  hotSwapThreadID,
			"orchestration.role":      role,
			"custom-label":            "preserved",
		},
		LastStatus: "idle",
		LastModeID: &mode,
		Config: &store.AgentConfig{
			ModeID:           &mode,
			Model:            &model,
			ThinkingOptionID: &thinking,
			Role:             &role,
		},
		RuntimeInfo: &store.AgentRuntimeInfo{Provider: providers.MockProviderID, SessionID: hotSwapString("runtime-old")},
		Persistence: &store.AgentPersistenceHandle{Provider: providers.MockProviderID, SessionID: "native-old", NativeHandle: "native-old"},
		LastError:   &errorText,
	}
	oldSession := providers.StartMockSession(providers.MockLaunchOptions{Cwd: cwd, Model: model, ModeID: mode, ThinkingID: thinking, SessionID: "native-old"})
	oldSession.SeedTimeline([]sdk.TimelineEntry{
		{Seq: 1, SeqEnd: 1, Item: sdk.TimelineItem{Type: "user_message", MessageID: "old-user", Text: "original request"}},
		{Seq: 2, SeqEnd: 2, Item: sdk.TimelineItem{Type: "assistant_message", MessageID: "old-assistant", Text: "original answer"}},
	})
	srv.agents[old.ID] = &managedPi{record: old, session: oldSession}
	if err := srv.store.UpsertAgent(old); err != nil {
		t.Fatal(err)
	}

	thread := chief.Thread{
		ID: hotSwapThreadID, MissionID: hotSwapMissionID, WorkspaceID: old.WorkspaceID, Cwd: cwd,
		Title: "hot swap thread", Status: "active", CreatedAt: old.CreatedAt, UpdatedAt: old.UpdatedAt,
	}
	oldProfileID := "old-author"
	targetProfileID := "target-author"
	if role == chief.RoleVerifier {
		thread.AuthorAgentID = "agent-author"
		thread.AuthorProfileID = "author-primary"
		thread.AuthorTier = chief.TierStandard
		thread.VerifierAgentID = old.ID
		thread.VerifierProfileID = "old-verifier"
		thread.VerifierTier = chief.TierStrong
		oldProfileID = "old-verifier"
		targetProfileID = "target-verifier"
	} else {
		thread.AuthorAgentID = old.ID
		thread.AuthorProfileID = oldProfileID
		thread.AuthorTier = chief.TierStandard
	}
	mission := chief.Mission{
		ID: hotSwapMissionID, Title: "hot swap", BaseCwd: cwd, BaseWorkspaceID: old.WorkspaceID,
		Status: chief.MissionStatusActive, Tier: chief.TierL1, HeadSeq: 1,
		Cursors:      map[string]int64{old.ID: 1},
		PendingBells: map[string]*chief.PendingBell{old.ID: {AgentID: old.ID, TargetSeq: 2, Reason: "review", QueuedAt: old.CreatedAt}},
		Threads:      []chief.Thread{thread}, CreatedAt: old.CreatedAt, UpdatedAt: old.UpdatedAt,
	}
	if _, err := missions.CreateMission(mission); err != nil {
		t.Fatal(err)
	}
	otherAgent := "agent-other"
	if _, err := missions.AppendEvent(mission.ID, chief.Event{ThreadID: hotSwapString(thread.ID), Kind: "review_requested", TargetAgentID: hotSwapString(old.ID), Summary: "unread targeted review", Ts: old.CreatedAt}); err != nil {
		t.Fatal(err)
	}
	if _, err := missions.AppendEvent(mission.ID, chief.Event{ThreadID: hotSwapString(thread.ID), Kind: "note", TargetAgentID: &otherAgent, Summary: "unrelated event", Ts: old.CreatedAt}); err != nil {
		t.Fatal(err)
	}

	targetMode := providers.MockApprovalModeID
	if targetProvider == "claude" {
		targetMode = "plan"
	}
	profiles := []any{
		map[string]any{"id": oldProfileID, "provider": old.Provider, "model": model, "modeId": mode, "tier": map[string]string{chief.RoleVerifier: chief.TierStrong}[role]},
		map[string]any{"id": targetProfileID, "provider": targetProvider, "model": "one-minute-stream", "modeId": targetMode, "thinkingOptionId": "high", "featureValues": map[string]any{"mockAssistantResponse": "handoff complete"}, "tier": targetTier},
	}
	if role == chief.RoleVerifier {
		profiles = append(profiles, map[string]any{"id": "author-primary", "provider": old.Provider, "tier": chief.TierStandard})
	}
	fallbackRole := map[string]any{"primaryProfileId": oldProfileID, "fallbackProfileIds": []any{targetProfileID}}
	srv.store.SaveDaemonConfig(map[string]any{
		"agentProfiles": profiles,
		"chief":         map[string]any{"roles": map[string]any{role: fallbackRole}},
	})
	bridge := &chiefBridge{srv: srv, store: missions}
	return &hotSwapFixture{srv: srv, missions: missions, bridge: bridge, service: NewAgentHotSwapService(bridge), old: old, oldSession: oldSession}
}

func (f *hotSwapFixture) targetProfileID() string {
	if f.old.Config != nil && f.old.Config.Role != nil && *f.old.Config.Role == chief.RoleVerifier {
		return "target-verifier"
	}
	return "target-author"
}

func (f *hotSwapFixture) startMockTarget(rec store.AgentRecord) (*managedPi, error) {
	mode, model, thinking := "", "", ""
	var features map[string]any
	if rec.Config != nil {
		if rec.Config.ModeID != nil {
			mode = *rec.Config.ModeID
		}
		if rec.Config.Model != nil {
			model = *rec.Config.Model
		}
		if rec.Config.ThinkingOptionID != nil {
			thinking = *rec.Config.ThinkingOptionID
		}
		features = rec.Config.FeatureValues
	}
	sess := providers.StartMockSession(providers.MockLaunchOptions{Cwd: rec.Cwd, Model: model, ModeID: mode, ThinkingID: thinking, FeatureValues: features})
	mp := &managedPi{record: rec, session: sess}
	f.srv.mu.Lock()
	f.srv.agents[rec.ID] = mp
	f.srv.mu.Unlock()
	return mp, nil
}

func TestAgentHotSwapCrossProviderPreservesMissionAndSeedsUnreadHandoff(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleVerifier, "claude", chief.TierStrong)
	f.service.startAgent = f.startMockTarget

	result, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, Reason: "automatic fallback"})
	if err != nil {
		t.Fatalf("HotSwap() error = %v", err)
	}
	if result.PreviousAgentID != f.old.ID || result.ReplacementAgentID == "" || result.ReplacementAgentID == f.old.ID {
		t.Fatalf("unexpected identity result: %+v", result)
	}
	if result.ProfileID != f.targetProfileID() || result.Mission == nil {
		t.Fatalf("unexpected profile/mission result: %+v", result)
	}
	newID := result.ReplacementAgentID
	f.srv.mu.Lock()
	newMP := f.srv.agents[newID]
	oldMP := f.srv.agents[f.old.ID]
	f.srv.mu.Unlock()
	if newMP == nil || oldMP != nil {
		t.Fatalf("replacement map state new=%v old=%v", newMP != nil, oldMP != nil)
	}
	rec := newMP.record
	if rec.Provider != "claude" || rec.Provider == f.old.Provider {
		t.Errorf("provider = %q, old = %q", rec.Provider, f.old.Provider)
	}
	if rec.Cwd != f.old.Cwd || rec.WorkspaceID != f.old.WorkspaceID || rec.ParentAgentID == nil || *rec.ParentAgentID != *f.old.ParentAgentID {
		t.Errorf("replacement lost cwd/workspace/parent: %+v", rec)
	}
	if rec.Title == nil || *rec.Title != *f.old.Title || rec.Labels["custom-label"] != "preserved" {
		t.Errorf("replacement lost title/labels: %+v", rec)
	}
	if rec.RuntimeInfo != nil || rec.Persistence != nil || rec.LastError != nil {
		t.Errorf("replacement retained old runtime state: %+v", rec)
	}
	if rec.Config == nil || rec.Config.ModeID == nil || *rec.Config.ModeID != "plan" || rec.LastModeID == nil || *rec.LastModeID != "plan" {
		t.Errorf("verifier posture is not read-only plan: %+v", rec.Config)
	}

	timeline := newMP.session.Timeline()
	if len(timeline) < 3 || timeline[0].Item.Text != "original request" || timeline[1].Item.Text != "original answer" {
		t.Fatalf("old UI timeline was not preserved: %+v", timeline)
	}
	var handoff string
	for _, entry := range timeline[2:] {
		if entry.Item.Type == "user_message" && strings.Contains(entry.Item.Text, "unread targeted review") {
			handoff = entry.Item.Text
		}
	}
	if handoff == "" || !strings.Contains(handoff, "original request") || strings.Contains(handoff, "unrelated event") {
		t.Errorf("curated handoff missing old history or unread targeting: %q", handoff)
	}

	mission, err := f.missions.GetMission(hotSwapMissionID)
	if err != nil {
		t.Fatal(err)
	}
	thread := mission.Threads[0]
	if thread.VerifierAgentID != newID || thread.VerifierProfileID != f.targetProfileID() || thread.VerifierTier != chief.TierStrong {
		t.Errorf("thread was not rebound: %+v", thread)
	}
	if mission.Cursors[newID] != 1 {
		t.Errorf("cursor transfer failed: %+v", mission.Cursors)
	}
	if _, ok := mission.Cursors[f.old.ID]; ok {
		t.Errorf("old cursor was not deleted: %+v", mission.Cursors)
	}
	if _, ok := mission.PendingBells[f.old.ID]; ok || mission.PendingBells[newID] == nil || mission.PendingBells[newID].AgentID != newID {
		t.Errorf("pending bell transfer failed: %+v", mission.PendingBells)
	}
	missionPath := filepath.Join(f.srv.homeDir, "orchestration", "missions", hotSwapMissionID, "mission.json")
	rawMission, err := os.ReadFile(missionPath)
	if err != nil {
		t.Fatal(err)
	}
	var retirement struct {
		RetiredAgents map[string]int64 `json:"retiredAgents"`
	}
	if err := json.Unmarshal(rawMission, &retirement); err != nil {
		t.Fatal(err)
	}
	if retirement.RetiredAgents[f.old.ID] == 0 {
		t.Errorf("retirement marker was not persisted: %+v", retirement.RetiredAgents)
	}
	for attempt := 0; attempt < 2; attempt++ {
		mission, err = f.missions.GetMission(hotSwapMissionID)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := mission.Cursors[f.old.ID]; ok {
			t.Errorf("old cursor resurrected on read %d: %+v", attempt, mission.Cursors)
		}
		if _, ok := mission.PendingBells[f.old.ID]; ok {
			t.Errorf("old bell resurrected on read %d: %+v", attempt, mission.PendingBells)
		}
	}
	archived, err := f.srv.store.GetAgent(f.old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if archived == nil || archived.ArchivedAt == nil || archived.Provider != f.old.Provider {
		t.Errorf("old agent was not archived with its provider intact: %+v", archived)
	}
	events, err := f.missions.ReadEvents(hotSwapMissionID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	last := events[len(events)-1]
	if last.Kind != chief.EventHotSwapApplied || last.Payload["oldAgentId"] != f.old.ID || last.Payload["newAgentId"] != newID || last.Payload["profileId"] != f.targetProfileID() {
		t.Errorf("hot_swap_applied event = %+v", last)
	}
	followUp, err := f.missions.AppendEvent(hotSwapMissionID, chief.Event{Kind: "replacement_follow_up", TargetAgentID: hotSwapString(newID), Summary: "deliver to replacement"})
	if err != nil {
		t.Fatal(err)
	}
	mission, err = f.missions.GetMission(hotSwapMissionID)
	if err != nil {
		t.Fatal(err)
	}
	if bell := mission.PendingBells[newID]; bell == nil || bell.TargetSeq != followUp.Seq {
		t.Errorf("replacement follow-up was not delivered: %+v", mission.PendingBells)
	}
	if _, ok := mission.Cursors[f.old.ID]; ok {
		t.Errorf("replacement follow-up resurrected old cursor: %+v", mission.Cursors)
	}
	if _, ok := mission.PendingBells[f.old.ID]; ok {
		t.Errorf("replacement follow-up resurrected old bell: %+v", mission.PendingBells)
	}
}

type hotSwapNeedsRestartSession struct {
	*providers.MockSession
	closes *atomic.Int32
}

func (s *hotSwapNeedsRestartSession) SetModel(context.Context, string, string) (*sdk.Model, error) {
	return nil, fmt.Errorf("%w: model", providers.ErrSettingNeedsRestart)
}
func (s *hotSwapNeedsRestartSession) SetMode(context.Context, string) error {
	return fmt.Errorf("%w: mode", providers.ErrSettingNeedsRestart)
}
func (s *hotSwapNeedsRestartSession) Close() error {
	s.closes.Add(1)
	return s.MockSession.Close()
}

func TestAgentHotSwapSameProviderRestartsOnceAndPreservesNativeState(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleAuthor, providers.MockProviderID, chief.TierStandard)
	var closes atomic.Int32
	f.srv.mu.Lock()
	f.srv.agents[f.old.ID].session = &hotSwapNeedsRestartSession{MockSession: f.oldSession, closes: &closes}
	f.srv.mu.Unlock()
	var restarts atomic.Int32
	f.service.applyOrRestart = func(ctx context.Context, mp *managedPi, applyErr error) error {
		restarts.Add(1)
		return f.srv.applyOrRestart(ctx, mp, applyErr)
	}

	result, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err != nil {
		t.Fatalf("HotSwap() error = %v", err)
	}
	if result.ReplacementAgentID != f.old.ID || restarts.Load() != 1 || closes.Load() != 1 {
		t.Fatalf("identity/restarts = %q/%d/%d", result.ReplacementAgentID, restarts.Load(), closes.Load())
	}
	f.srv.mu.Lock()
	mp := f.srv.agents[f.old.ID]
	f.srv.mu.Unlock()
	if mp == nil || mp.record.ArchivedAt != nil || mp.record.Persistence == nil || mp.record.Persistence.SessionID != "native-old" {
		t.Fatalf("same-provider native state changed: %+v", mp)
	}
	state, err := mp.session.GetState(context.Background())
	if err != nil || state.SessionID != "native-old" {
		t.Errorf("native session = %+v, err = %v", state, err)
	}
	timeline := mp.session.Timeline()
	if len(timeline) != 2 || timeline[0].Item.Text != "original request" || timeline[1].Item.Text != "original answer" {
		t.Errorf("same-provider timeline changed: %+v", timeline)
	}
	mission, _ := f.missions.GetMission(hotSwapMissionID)
	if mission.Threads[0].AuthorAgentID != f.old.ID || mission.Threads[0].AuthorProfileID != f.targetProfileID() || mission.Cursors[f.old.ID] != 1 || mission.PendingBells[f.old.ID] == nil {
		t.Errorf("same-provider mission state changed incorrectly: %+v", mission)
	}
}

type hotSwapObservableSession struct {
	*providers.MockSession
	modeID        string
	featureValues map[string]any
	afterSetModel func()
}

func (s *hotSwapObservableSession) SetModel(ctx context.Context, providerID, modelID string) (*sdk.Model, error) {
	model, err := s.MockSession.SetModel(ctx, providerID, modelID)
	if err == nil && s.afterSetModel != nil {
		s.afterSetModel()
	}
	return model, err
}

func (s *hotSwapObservableSession) SetMode(ctx context.Context, modeID string) error {
	if err := s.MockSession.SetMode(ctx, modeID); err != nil {
		return err
	}
	s.modeID = modeID
	return nil
}

func (s *hotSwapObservableSession) SetFeatureValues(values map[string]any) {
	s.MockSession.SetFeatureValues(values)
	s.featureValues = values
}

func (f *hotSwapFixture) applyMockRestart(_ context.Context, mp *managedPi, _ error) error {
	timeline := append([]sdk.TimelineEntry(nil), mp.session.Timeline()...)
	rec := mp.record
	var mode, model, thinking, sessionID string
	var features map[string]any
	if rec.Config != nil {
		mode = derefStr(rec.Config.ModeID)
		model = derefStr(rec.Config.Model)
		thinking = derefStr(rec.Config.ThinkingOptionID)
		features = rec.Config.FeatureValues
	}
	if rec.Persistence != nil {
		sessionID = rec.Persistence.SessionID
	}
	session := providers.StartMockSession(providers.MockLaunchOptions{
		Cwd: rec.Cwd, Model: model, ModeID: mode, ThinkingID: thinking,
		FeatureValues: features, SessionID: sessionID,
	})
	session.SeedTimeline(timeline)
	_ = mp.session.Close()
	restarted := &managedPi{record: rec, session: &hotSwapObservableSession{MockSession: session, modeID: mode, featureValues: features}}
	f.srv.mu.Lock()
	f.srv.agents[rec.ID] = restarted
	f.srv.mu.Unlock()
	return nil
}

func TestAgentHotSwapSameProviderStaleAfterSetterRestoresRuntime(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleAuthor, providers.MockProviderID, chief.TierStandard)
	before, _ := f.missions.GetMission(hotSwapMissionID)
	var mutationErr error
	observed := &hotSwapObservableSession{MockSession: f.oldSession, modeID: derefStr(f.old.Config.ModeID)}
	observed.afterSetModel = func() {
		_, mutationErr = f.missions.UpdateMission(hotSwapMissionID, func(m *chief.Mission) error {
			m.Threads[0].AuthorAgentID = "agent-concurrent"
			return nil
		})
	}
	f.srv.agents[f.old.ID].session = observed
	var restarts atomic.Int32
	f.service.applyOrRestart = func(ctx context.Context, mp *managedPi, applyErr error) error {
		restarts.Add(1)
		return f.applyMockRestart(ctx, mp, applyErr)
	}

	_, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("HotSwap() error = %v, want post-setter stale binding", err)
	}
	if mutationErr != nil {
		t.Fatal(mutationErr)
	}
	if restarts.Load() != 1 {
		t.Errorf("rollback restarts = %d, want 1", restarts.Load())
	}
	assertHotSwapSameProviderRestored(t, f, before, "agent-concurrent", before.Threads[0].AuthorProfileID)
}

func TestAgentHotSwapSameProviderUpsertFailureRestoresRuntime(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleAuthor, providers.MockProviderID, chief.TierStandard)
	before, _ := f.missions.GetMission(hotSwapMissionID)
	observed := &hotSwapObservableSession{MockSession: f.oldSession, modeID: derefStr(f.old.Config.ModeID)}
	f.srv.agents[f.old.ID].session = observed
	var restarts atomic.Int32
	f.service.applyOrRestart = func(ctx context.Context, mp *managedPi, applyErr error) error {
		restarts.Add(1)
		return f.applyMockRestart(ctx, mp, applyErr)
	}
	var targetWrites atomic.Int32
	f.service.upsertAgent = func(rec store.AgentRecord) error {
		if rec.Config != nil && derefStr(rec.Config.Model) == "one-minute-stream" && targetWrites.Add(1) == 1 {
			return errors.New("injected agent upsert failure")
		}
		return f.srv.store.UpsertAgent(rec)
	}

	_, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err == nil || !strings.Contains(err.Error(), "injected agent upsert failure") {
		t.Fatalf("HotSwap() error = %v, want injected upsert failure", err)
	}
	if restarts.Load() != 1 || targetWrites.Load() != 1 {
		t.Errorf("rollback restarts/target writes = %d/%d, want 1/1", restarts.Load(), targetWrites.Load())
	}
	assertHotSwapSameProviderRestored(t, f, before, f.old.ID, before.Threads[0].AuthorProfileID)
}

func assertHotSwapSameProviderRestored(t *testing.T, f *hotSwapFixture, before *chief.Mission, boundAgentID, boundProfileID string) {
	t.Helper()
	mission, err := f.missions.GetMission(hotSwapMissionID)
	if err != nil {
		t.Fatal(err)
	}
	thread := mission.Threads[0]
	if thread.AuthorAgentID != boundAgentID || thread.AuthorProfileID != boundProfileID {
		t.Errorf("mission binding = %s/%s, want %s/%s", thread.AuthorAgentID, thread.AuthorProfileID, boundAgentID, boundProfileID)
	}
	if mission.Cursors[f.old.ID] != before.Cursors[f.old.ID] || mission.PendingBells[f.old.ID] == nil {
		t.Errorf("mission cursor/bell changed: %+v", mission)
	}
	persisted, err := f.srv.store.GetAgent(f.old.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertHotSwapOldRecord(t, "persisted", persisted, f.old)
	f.srv.mu.Lock()
	mp := f.srv.agents[f.old.ID]
	agentCount := len(f.srv.agents)
	f.srv.mu.Unlock()
	if mp == nil || agentCount != 1 {
		t.Fatalf("live agents after rollback = %+v, count %d", mp, agentCount)
	}
	assertHotSwapOldRecord(t, "live", &mp.record, f.old)
	state, err := mp.session.GetState(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if state.Model == nil || state.Model.ID != derefStr(f.old.Config.Model) || state.ThinkingLevel != derefStr(f.old.Config.ThinkingOptionID) || state.SessionID != "native-old" {
		t.Errorf("live session state = %+v, want old model/thinking/native handle", state)
	}
	observed, ok := mp.session.(*hotSwapObservableSession)
	if !ok || observed.modeID != derefStr(f.old.Config.ModeID) {
		t.Errorf("live session mode = %+v, want %q", observed, derefStr(f.old.Config.ModeID))
	}
	timeline := mp.session.Timeline()
	if len(timeline) != 2 || timeline[0].Item.Text != "original request" || timeline[1].Item.Text != "original answer" {
		t.Errorf("timeline after rollback = %+v", timeline)
	}
	events, err := f.missions.ReadEvents(hotSwapMissionID, before.HeadSeq, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.Kind == chief.EventHotSwapApplied {
			t.Errorf("unexpected hot swap event after rollback: %+v", event)
		}
	}
}

func assertHotSwapOldRecord(t *testing.T, surface string, got *store.AgentRecord, want store.AgentRecord) {
	t.Helper()
	if got == nil || got.Config == nil {
		t.Fatalf("%s record missing after rollback: %+v", surface, got)
	}
	if got.UpdatedAt != want.UpdatedAt || derefStr(got.Config.Model) != derefStr(want.Config.Model) || derefStr(got.Config.ModeID) != derefStr(want.Config.ModeID) || derefStr(got.Config.ThinkingOptionID) != derefStr(want.Config.ThinkingOptionID) {
		t.Errorf("%s record = %+v, want old config/timestamp %+v", surface, got, want)
	}
}

func TestChiefAgentHotSwapRPC(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleAuthor, providers.MockProviderID, chief.TierStandard)
	f.srv.chief = f.bridge

	response := callChiefRPC(t, f.srv, "chief.agent.hotswap.request", map[string]any{
		"requestId": "req-hot-swap", "agentId": f.old.ID, "threadId": hotSwapThreadID,
		"missionId": hotSwapMissionID, "profileId": f.targetProfileID(), "reason": "operator requested fallback",
	})
	if response["accepted"] != true || response["previousAgentId"] != f.old.ID || response["replacementAgentId"] != f.old.ID || response["profileId"] != f.targetProfileID() {
		t.Fatalf("hot swap response = %+v", response)
	}
	if response["error"] != nil || response["mission"] == nil {
		t.Fatalf("hot swap response mission/error = %+v", response)
	}
}

func TestTryHotSwapProfilePreservesSameProviderRuntime(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleAuthor, providers.MockProviderID, chief.TierStandard)
	f.bridge.router = chief.NewRouter(f.missions, chief.RouterHooks{})
	defer f.bridge.router.Close()

	swapped, action := f.bridge.tryHotSwapProfile(context.Background(), hotSwapMissionID, hotSwapThreadID, chief.RoleAuthor, f.old.ID)
	if !swapped || action != "hot_swap:"+f.targetProfileID() {
		t.Fatalf("tryHotSwapProfile() = %v, %q", swapped, action)
	}
	f.srv.mu.Lock()
	mp := f.srv.agents[f.old.ID]
	f.srv.mu.Unlock()
	if mp == nil || mp.record.Persistence == nil || mp.record.Persistence.SessionID != "native-old" || mp.record.ArchivedAt != nil {
		t.Fatalf("automatic fallback discarded same-provider native state: %+v", mp)
	}
	mission, err := f.missions.GetMission(hotSwapMissionID)
	if err != nil {
		t.Fatal(err)
	}
	if mission.Threads[0].AuthorAgentID != f.old.ID || mission.Threads[0].AuthorProfileID != f.targetProfileID() || mission.Cursors[f.old.ID] != 1 {
		t.Fatalf("automatic fallback mission = %+v", mission.Threads[0])
	}
}

func TestAgentHotSwapRejectsVerifierDowngradeBeforeMutation(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleVerifier, "claude", chief.TierFast)
	var starts atomic.Int32
	f.service.startAgent = func(rec store.AgentRecord) (*managedPi, error) { starts.Add(1); return f.startMockTarget(rec) }
	before, _ := f.missions.GetMission(hotSwapMissionID)
	_, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if !errors.Is(err, chief.ErrVerifierTierBlocked) {
		t.Fatalf("error = %v, want verifier tier blocked", err)
	}
	after, _ := f.missions.GetMission(hotSwapMissionID)
	if starts.Load() != 0 || after.Threads[0].VerifierAgentID != f.old.ID || after.Threads[0].VerifierProfileID != before.Threads[0].VerifierProfileID || after.Cursors[f.old.ID] != 1 {
		t.Fatalf("downgrade mutated state: starts=%d after=%+v", starts.Load(), after)
	}
	f.srv.mu.Lock()
	rec := f.srv.agents[f.old.ID].record
	f.srv.mu.Unlock()
	if rec.ArchivedAt != nil || rec.Config.Model == nil || *rec.Config.Model != *f.old.Config.Model {
		t.Errorf("old record mutated: %+v", rec)
	}
}

func TestAgentHotSwapRejectsActiveTurnBeforeMutation(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleVerifier, "claude", chief.TierStrong)
	f.srv.mu.Lock()
	f.srv.agents[f.old.ID].record.LastStatus = "running"
	f.srv.mu.Unlock()
	var starts atomic.Int32
	f.service.startAgent = func(rec store.AgentRecord) (*managedPi, error) {
		starts.Add(1)
		return f.startMockTarget(rec)
	}
	_, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err == nil || !strings.Contains(err.Error(), "active turn") {
		t.Fatalf("error = %v, want active turn rejection", err)
	}
	mission, _ := f.missions.GetMission(hotSwapMissionID)
	if starts.Load() != 0 || mission.Threads[0].VerifierAgentID != f.old.ID || mission.Cursors[f.old.ID] != 1 {
		t.Fatalf("active turn rejection mutated state: starts=%d mission=%+v", starts.Load(), mission)
	}
}

func TestAgentHotSwapTargetStartFailureIsAtomic(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleVerifier, "claude", chief.TierStrong)
	f.service.startAgent = func(store.AgentRecord) (*managedPi, error) { return nil, errors.New("target start failed") }
	before, _ := f.missions.GetMission(hotSwapMissionID)
	_, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err == nil || !strings.Contains(err.Error(), "target start failed") {
		t.Fatalf("error = %v", err)
	}
	assertHotSwapUnchanged(t, f, before, f.old.ID)
}

func TestAgentHotSwapStaleBindingDiscardsReplacementWithoutOverwriting(t *testing.T) {
	f := newHotSwapFixture(t, chief.RoleVerifier, "claude", chief.TierStrong)
	before, _ := f.missions.GetMission(hotSwapMissionID)
	f.service.startAgent = func(rec store.AgentRecord) (*managedPi, error) {
		if _, err := f.missions.UpdateMission(hotSwapMissionID, func(m *chief.Mission) error {
			m.Threads[0].VerifierAgentID = "agent-concurrent"
			return nil
		}); err != nil {
			return nil, err
		}
		return f.startMockTarget(rec)
	}
	_, err := f.service.HotSwap(context.Background(), AgentHotSwapRequest{AgentID: f.old.ID, ThreadID: hotSwapThreadID, ProfileID: f.targetProfileID()})
	if err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("error = %v, want stale binding", err)
	}
	assertHotSwapUnchanged(t, f, before, "agent-concurrent")
	agents, listErr := f.srv.store.ListAgents()
	if listErr != nil {
		t.Fatal(listErr)
	}
	if len(agents) != 1 || agents[0].ID != f.old.ID {
		t.Errorf("replacement was not discarded from store: %+v", agents)
	}
}

func assertHotSwapUnchanged(t *testing.T, f *hotSwapFixture, before *chief.Mission, boundAgentID string) {
	t.Helper()
	after, err := f.missions.GetMission(hotSwapMissionID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Threads[0].VerifierAgentID != boundAgentID || after.Threads[0].VerifierProfileID != before.Threads[0].VerifierProfileID || after.Threads[0].VerifierTier != before.Threads[0].VerifierTier {
		t.Errorf("binding changed: before=%+v after=%+v", before.Threads[0], after.Threads[0])
	}
	if after.Cursors[f.old.ID] != before.Cursors[f.old.ID] || after.PendingBells[f.old.ID] == nil || after.PendingBells[f.old.ID].AgentID != f.old.ID {
		t.Errorf("cursor/bell changed: before=%+v after=%+v", before, after)
	}
	f.srv.mu.Lock()
	oldMP := f.srv.agents[f.old.ID]
	agentCount := len(f.srv.agents)
	f.srv.mu.Unlock()
	if oldMP == nil || oldMP.record.ArchivedAt != nil || agentCount != 1 {
		t.Errorf("old runtime changed or replacement leaked: old=%v count=%d", oldMP != nil, agentCount)
	}
	events, err := f.missions.ReadEvents(hotSwapMissionID, before.HeadSeq, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.Kind == chief.EventHotSwapApplied {
			t.Errorf("unexpected hot swap event: %+v", event)
		}
	}
}

func hotSwapString(value string) *string { return &value }
