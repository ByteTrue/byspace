package server

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

func TestAgentAttentionPermissionPriority(t *testing.T) {
	for _, live := range []bool{false, true} {
		location := "stored"
		if live {
			location = "live"
		}
		for _, initial := range []string{AttentionReasonFinished, AttentionReasonError} {
			t.Run(location+"/"+initial, func(t *testing.T) {
				srv := newTestServer(t, t.TempDir())
				id := location + "-" + initial
				putAgent(t, srv, id, "w1", "idle", nil)
				if live {
					rec, err := srv.store.GetAgent(id)
					if err != nil || rec == nil {
						t.Fatalf("missing agent: %v", err)
					}
					srv.mu.Lock()
					srv.agents[id] = &managedPi{record: *rec}
					srv.mu.Unlock()
				}
				if !srv.markAgentAttention(id, initial, "2026-01-02T00:00:00Z") {
					t.Fatal("initial attention was not recorded")
				}
				if !srv.markAgentAttention(id, AttentionReasonPermission, "2026-01-03T00:00:00Z") {
					t.Fatal("permission did not replace " + initial)
				}
				requireAgentAttention(t, srv, id, AttentionReasonPermission, "2026-01-03T00:00:00Z")
				if srv.markAgentAttention(id, initial, "2026-01-04T00:00:00Z") {
					t.Fatal(initial + " replaced permission")
				}
				if srv.markAgentAttention(id, AttentionReasonPermission, "2026-01-05T00:00:00Z") {
					t.Fatal("duplicate permission was not a no-op")
				}
				requireAgentAttention(t, srv, id, AttentionReasonPermission, "2026-01-03T00:00:00Z")
			})
		}
	}
}

func TestChiefNotifyHumanPublishesOnlyPermission(t *testing.T) {
	for _, live := range []bool{false, true} {
		location := "stored"
		if live {
			location = "live"
		}
		for _, initial := range []string{AttentionReasonFinished, AttentionReasonError} {
			t.Run(location+"/"+initial, func(t *testing.T) {
				srv := newTestServer(t, t.TempDir())
				id := location + "-chief-" + initial
				putAgent(t, srv, id, "w1", "idle", nil)
				if live {
					rec, err := srv.store.GetAgent(id)
					if err != nil || rec == nil {
						t.Fatalf("missing agent: %v", err)
					}
					srv.mu.Lock()
					srv.agents[id] = &managedPi{record: *rec}
					srv.mu.Unlock()
				}
				if !srv.markAgentAttention(id, initial, "2026-01-02T00:00:00Z") {
					t.Fatal("initial attention was not recorded")
				}
				sink := &recordingSink{}
				srv.mu.Lock()
				srv.clients[sink] = true
				srv.mu.Unlock()
				srv.chief.notifyHuman(context.Background(), "mission", id, chief.SystemAttention{Since: "2026-01-03T00:00:00Z"})
				requireAgentAttention(t, srv, id, AttentionReasonPermission, "2026-01-03T00:00:00Z")
				updates := attentionUpdatesFor(t, sink, id)
				if len(updates) != 1 {
					t.Fatalf("permission published %d agent snapshots, want 1: %+v", len(updates), updates)
				}
				if updates[0]["requiresAttention"] != true || updates[0]["attentionReason"] != AttentionReasonPermission || updates[0]["attentionTimestamp"] != "2026-01-03T00:00:00Z" {
					t.Fatalf("published snapshot = %+v", updates[0])
				}
			})
		}
	}
}

type gatedAttentionSink struct {
	recordingSink
	agentID string
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (s *gatedAttentionSink) SendText(ctx context.Context, text string) error {
	if strings.Contains(text, s.agentID) && strings.Contains(text, `"attentionReason":"finished"`) {
		first := false
		s.once.Do(func() {
			first = true
			close(s.entered)
		})
		if first {
			<-s.release
		}
	}
	return s.recordingSink.SendText(ctx, text)
}

func TestChiefPermissionCompletionInterleaving(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	cwd := t.TempDir()
	session := providers.StartMockSession(providers.MockLaunchOptions{Cwd: cwd, Model: "e2e-fast-stream"})
	rec := store.AgentRecord{ID: "chief-gated", Provider: "mock", Cwd: cwd, LastStatus: "running"}
	mp := &managedPi{record: rec, session: session}
	srv.mu.Lock()
	srv.agents[rec.ID] = mp
	srv.mu.Unlock()
	if err := srv.store.UpsertAgent(rec); err != nil {
		t.Fatal(err)
	}
	sink := &gatedAttentionSink{
		agentID: rec.ID,
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	srv.mu.Lock()
	srv.clients[sink] = true
	srv.mu.Unlock()
	completed := make(chan struct{})
	go func() {
		srv.handleTurnCompleted(mp, session, rec, "turn-gated", "2026-01-02T00:00:00Z")
		close(completed)
	}()
	<-sink.entered
	notified := make(chan struct{})
	go func() {
		srv.chief.notifyHuman(context.Background(), "mission", rec.ID, chief.SystemAttention{Since: "2026-01-03T00:00:00Z"})
		close(notified)
	}()
	<-notified
	close(sink.release)
	<-completed
	deadline := time.Now().Add(3 * time.Second)
	for {
		persisted, err := srv.store.GetAgent(rec.ID)
		if err != nil {
			t.Fatal(err)
		}
		if persisted != nil && persisted.Persistence != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background persistence did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}
	requireAgentAttention(t, srv, rec.ID, AttentionReasonPermission, "2026-01-03T00:00:00Z")
	updates := attentionUpdatesFor(t, &sink.recordingSink, rec.ID)
	if len(updates) == 0 {
		t.Fatal("completion and permission published no agent snapshots")
	}
	for _, update := range updates {
		if update["requiresAttention"] != true {
			t.Fatalf("published an intermediate cleared snapshot: %+v", updates)
		}
	}
	last := updates[len(updates)-1]
	if last["attentionReason"] != AttentionReasonPermission || last["attentionTimestamp"] != "2026-01-03T00:00:00Z" {
		t.Fatalf("last published snapshot = %+v, all = %+v", last, updates)
	}
}

func TestChiefPermissionResolution(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	id := "chief-resolution"
	putAgent(t, srv, id, "w1", "idle", nil)
	if !srv.markAgentAttention(id, AttentionReasonPermission, "2026-01-02T00:00:00Z") {
		t.Fatal("permission was not recorded")
	}
	first, err := srv.chief.store.CreateMission(chief.Mission{ID: "mission-resolved", ChiefAgentID: id, Status: chief.MissionStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	second, err := srv.chief.store.CreateMission(chief.Mission{ID: "mission-waiting", ChiefAgentID: id, Status: chief.MissionStatusWaitingHuman})
	if err != nil {
		t.Fatal(err)
	}
	srv.chief.reconcileChiefPermissionAttention(first.ID)
	requireAgentAttention(t, srv, id, AttentionReasonPermission, "2026-01-02T00:00:00Z")
	if _, err := srv.chief.store.UpdateMission(second.ID, func(m *chief.Mission) error {
		m.Status = chief.MissionStatusActive
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	srv.chief.reconcileChiefPermissionAttention(first.ID)
	rec, err := srv.store.GetAgent(id)
	if err != nil || rec == nil {
		t.Fatalf("missing agent: %v", err)
	}
	if rec.RequiresAttention || rec.AttentionReason != nil || rec.AttentionTimestamp != nil {
		t.Fatalf("permission was not cleared after all missions resolved: %+v", rec)
	}
}

func requireAgentAttention(t *testing.T, srv *Server, id, reason, timestamp string) {
	t.Helper()
	rec, err := srv.store.GetAgent(id)
	if err != nil || rec == nil {
		t.Fatalf("missing agent: %v", err)
	}
	requireAttentionRecord(t, *rec, reason, timestamp)
	srv.mu.Lock()
	mp := srv.agents[id]
	var live store.AgentRecord
	if mp != nil {
		live = mp.record
	}
	srv.mu.Unlock()
	if mp != nil {
		requireAttentionRecord(t, live, reason, timestamp)
	}
}

func requireAttentionRecord(t *testing.T, rec store.AgentRecord, reason, timestamp string) {
	t.Helper()
	if !rec.RequiresAttention || rec.AttentionReason == nil || *rec.AttentionReason != reason || rec.AttentionTimestamp == nil || *rec.AttentionTimestamp != timestamp {
		t.Fatalf("attention = %+v, want %q at %q", rec, reason, timestamp)
	}
}

func attentionUpdatesFor(t *testing.T, sink *recordingSink, id string) []map[string]any {
	t.Helper()
	messages := decodeRecordedMessages(t, sink)
	updates := []map[string]any{}
	for _, message := range messages {
		inner, _ := message["message"].(map[string]any)
		if inner == nil || inner["type"] != "agent_update" {
			continue
		}
		payload, _ := inner["payload"].(map[string]any)
		agent, _ := payload["agent"].(map[string]any)
		if agent != nil && agent["id"] == id {
			updates = append(updates, agent)
		}
	}
	return updates
}
