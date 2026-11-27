package chief

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type testTransactionJournal struct {
	State       string  `json:"state"`
	Before      Mission `json:"before"`
	After       Mission `json:"after"`
	Event       Event   `json:"event"`
	EventOffset int64   `json:"eventOffset"`
}

func TestStoreTransactionUpdateMissionAndAppendEvent(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	if _, err := st.CreateMission(Mission{ID: "msn_tx", BaseCwd: homeDir, Title: "before"}); err != nil {
		t.Fatal(err)
	}
	target := "agent-target"
	mission, event, err := st.UpdateMissionAndAppendEvent("msn_tx", func(m *Mission) (Event, error) {
		m.Title = "after"
		return Event{Kind: "transaction_committed", TargetAgentID: &target, Summary: "committed summary"}, nil
	})
	if err != nil {
		t.Fatalf("UpdateMissionAndAppendEvent() error = %v", err)
	}
	if mission == nil || mission.Title != "after" || mission.HeadSeq != 1 {
		t.Fatalf("mission = %+v, want after at seq 1", mission)
	}
	if event.Seq != 1 || event.MissionID != "msn_tx" || event.Ts == "" || event.Kind != "transaction_committed" {
		t.Fatalf("event = %+v, want assigned committed event", event)
	}
	bell := mission.PendingBells[target]
	if bell == nil || bell.TargetSeq != event.Seq || bell.Reason != event.Kind {
		t.Fatalf("pending bell = %+v, want committed event", bell)
	}
	persisted, err := st.GetMission("msn_tx")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(persisted, mission) {
		t.Fatalf("persisted mission = %+v, result = %+v", persisted, mission)
	}
	events, err := st.ReadEvents("msn_tx", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || !reflect.DeepEqual(events[0], event) {
		t.Fatalf("events = %+v, want exactly %+v", events, event)
	}
	assertTransactionJournalRemoved(t, homeDir, "msn_tx")
}

func TestStoreTransactionCallbackErrorLeavesNoChanges(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	created, err := st.CreateMission(Mission{ID: "msn_tx", BaseCwd: homeDir, Title: "before"})
	if err != nil {
		t.Fatal(err)
	}
	wantErr := errors.New("callback rejected")
	mission, event, err := st.UpdateMissionAndAppendEvent("msn_tx", func(m *Mission) (Event, error) {
		m.Title = "after"
		return Event{}, wantErr
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want callback error", err)
	}
	if mission != nil || event.Seq != 0 {
		t.Fatalf("result = %+v %+v, want no committed result", mission, event)
	}
	persisted, err := st.GetMission("msn_tx")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(*persisted, created) {
		t.Fatalf("mission = %+v, want unchanged %+v", persisted, created)
	}
	raw := readTransactionEventBytes(t, homeDir, "msn_tx")
	if len(raw) != 0 {
		t.Fatalf("events.jsonl = %q, want empty", raw)
	}
	assertTransactionJournalRemoved(t, homeDir, "msn_tx")
}

func TestStoreTransactionPreparedFailureStagesRollBack(t *testing.T) {
	stages := []struct {
		name        string
		appendEvent bool
		writeAfter  bool
	}{
		{name: "append failure after journal"},
		{name: "mission write failure after event append", appendEvent: true},
		{name: "commit marker failure after mission write", appendEvent: true, writeAfter: true},
	}
	for _, stage := range stages {
		t.Run(stage.name, func(t *testing.T) {
			homeDir, st, before, after, event, eventOffset, originalEvents := newTransactionFixture(t)
			writeTestTransactionJournal(t, homeDir, "msn_tx", "prepared", before, after, event, eventOffset)
			if stage.appendEvent {
				if err := st.appendEventLineLocked("msn_tx", event); err != nil {
					t.Fatal(err)
				}
			}
			if stage.writeAfter {
				if err := st.writeMissionLocked(after); err != nil {
					t.Fatal(err)
				}
			}
			reopened := NewStore(homeDir)
			for attempt := 0; attempt < 2; attempt++ {
				mission, err := reopened.GetMission("msn_tx")
				if err != nil {
					t.Fatalf("GetMission() attempt %d error = %v", attempt, err)
				}
				if !reflect.DeepEqual(*mission, before) {
					t.Fatalf("mission attempt %d = %+v, want before %+v", attempt, mission, before)
				}
				raw := readTransactionEventBytes(t, homeDir, "msn_tx")
				if string(raw) != string(originalEvents) {
					t.Fatalf("events attempt %d = %q, want %q", attempt, raw, originalEvents)
				}
			}
			events, err := reopened.ReadEvents("msn_tx", 0, 0)
			if err != nil {
				t.Fatal(err)
			}
			if len(events) != 1 || events[0].Kind != "seed" {
				t.Fatalf("events = %+v, want only seed", events)
			}
			assertTransactionJournalRemoved(t, homeDir, "msn_tx")
		})
	}
}

func TestStoreTransactionCommittedRecoveryConverges(t *testing.T) {
	stages := []struct {
		name           string
		appendEvent    bool
		writeAfter     bool
		duplicateEvent bool
	}{
		{name: "committed journal before event append"},
		{name: "committed journal after event append", appendEvent: true},
		{name: "committed journal before cleanup", appendEvent: true, writeAfter: true},
		{name: "committed journal with duplicate partial state", appendEvent: true, writeAfter: true, duplicateEvent: true},
	}
	for _, stage := range stages {
		t.Run(stage.name, func(t *testing.T) {
			homeDir, st, before, after, event, eventOffset, originalEvents := newTransactionFixture(t)
			writeTestTransactionJournal(t, homeDir, "msn_tx", "committed", before, after, event, eventOffset)
			if stage.appendEvent {
				if err := st.appendEventLineLocked("msn_tx", event); err != nil {
					t.Fatal(err)
				}
			}
			if stage.duplicateEvent {
				if err := st.appendEventLineLocked("msn_tx", event); err != nil {
					t.Fatal(err)
				}
			}
			if stage.writeAfter {
				if err := st.writeMissionLocked(after); err != nil {
					t.Fatal(err)
				}
			}
			line, err := json.Marshal(event)
			if err != nil {
				t.Fatal(err)
			}
			wantEvents := append([]byte{}, originalEvents...)
			wantEvents = append(wantEvents, line...)
			wantEvents = append(wantEvents, '\n')
			reopened := NewStore(homeDir)
			for attempt := 0; attempt < 2; attempt++ {
				mission, err := reopened.GetMission("msn_tx")
				if err != nil {
					t.Fatalf("GetMission() attempt %d error = %v", attempt, err)
				}
				if !reflect.DeepEqual(*mission, after) {
					t.Fatalf("mission attempt %d = %+v, want after %+v", attempt, mission, after)
				}
				raw := readTransactionEventBytes(t, homeDir, "msn_tx")
				if string(raw) != string(wantEvents) {
					t.Fatalf("events attempt %d = %q, want exactly %q", attempt, raw, wantEvents)
				}
			}
			events, err := reopened.ReadEvents("msn_tx", 0, 0)
			if err != nil {
				t.Fatal(err)
			}
			if len(events) != 2 || events[0].Kind != "seed" || events[1].Seq != event.Seq {
				t.Fatalf("events = %+v, want seed and one committed event", events)
			}
			assertTransactionJournalRemoved(t, homeDir, "msn_tx")
		})
	}
}

func TestStoreTransactionReplayPendingBellsDeliversCommittedEventOnce(t *testing.T) {
	homeDir, st, before, after, event, eventOffset, _ := newTransactionFixture(t)
	writeTestTransactionJournal(t, homeDir, "msn_tx", "committed", before, after, event, eventOffset)
	if err := st.appendEventLineLocked("msn_tx", event); err != nil {
		t.Fatal(err)
	}
	if err := st.writeMissionLocked(after); err != nil {
		t.Fatal(err)
	}
	messenger := newFakeMessenger()
	messenger.states["agent-target"] = AgentRuntimeState{AgentID: "agent-target", Status: "idle", Loaded: true}
	router := NewRouter(NewStore(homeDir), RouterHooks{Messenger: messenger})
	defer router.Close()
	for attempt := 0; attempt < 2; attempt++ {
		if err := router.ReplayPendingBells(context.Background()); err != nil {
			t.Fatalf("ReplayPendingBells() attempt %d error = %v", attempt, err)
		}
	}
	prompts := messenger.sentFor("agent-target")
	if len(prompts) != 1 || !strings.Contains(prompts[0], "#2") || !strings.Contains(prompts[0], "transaction_committed") {
		t.Fatalf("prompts = %+v, want exactly one committed event #2", prompts)
	}
	events, err := st.ReadEvents("msn_tx", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("events = %+v, want no replay duplicates", events)
	}
}

func TestStoreTransactionPreservesEventAppendBoundaries(t *testing.T) {
	first := `{"seq":1,"missionId":"msn_tx","kind":"first"}`
	second := `{"seq":2,"missionId":"msn_tx","kind":"second"}`
	tests := []struct {
		name       string
		raw        string
		headSeq    int64
		wantEvents int
	}{
		{name: "preexisting torn tail", raw: first + "\n" + `{"seq":2`, headSeq: 1, wantEvents: 2},
		{name: "valid unterminated record", raw: first + "\n" + second, headSeq: 2, wantEvents: 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			homeDir := t.TempDir()
			st := NewStore(homeDir)
			if _, err := st.CreateMission(Mission{ID: "msn_tx", BaseCwd: homeDir, HeadSeq: tt.headSeq}); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(homeDir, "orchestration", "missions", "msn_tx", "events.jsonl")
			if err := os.WriteFile(path, []byte(tt.raw), 0o600); err != nil {
				t.Fatal(err)
			}
			mission, event, err := st.UpdateMissionAndAppendEvent("msn_tx", func(m *Mission) (Event, error) {
				m.Title = "after"
				return Event{Kind: "appended"}, nil
			})
			if err != nil {
				t.Fatalf("UpdateMissionAndAppendEvent() error = %v", err)
			}
			if mission.HeadSeq != tt.headSeq+1 || event.Seq != tt.headSeq+1 {
				t.Fatalf("mission/event = %+v %+v, want seq %d", mission, event, tt.headSeq+1)
			}
			for attempt := 0; attempt < 2; attempt++ {
				events, err := st.ReadEvents("msn_tx", 0, 0)
				if err != nil {
					t.Fatalf("ReadEvents() attempt %d error = %v", attempt, err)
				}
				if len(events) != tt.wantEvents || events[len(events)-1].Kind != "appended" {
					t.Fatalf("events attempt %d = %+v, want %d records ending in append", attempt, events, tt.wantEvents)
				}
			}
		})
	}
}

func TestStoreTransactionRetiredAndReplacementAgents(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	oldAgent := "agent-old"
	replacement := "agent-new"
	if _, err := st.CreateMission(Mission{
		ID: "msn_tx", BaseCwd: homeDir, HeadSeq: 1,
		RetiredAgents: map[string]int64{oldAgent: 1},
	}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(homeDir, "orchestration", "missions", "msn_tx", "events.jsonl")
	oldEvent := `{"seq":1,"missionId":"msn_tx","kind":"old_request","targetAgentId":"agent-old"}`
	if err := os.WriteFile(path, []byte(oldEvent+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.UpdateMissionAndAppendEvent("msn_tx", func(m *Mission) (Event, error) {
		return Event{Kind: "replacement_request", TargetAgentID: &replacement}, nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.UpdateMissionAndAppendEvent("msn_tx", func(m *Mission) (Event, error) {
		return Event{Kind: "late_old_request", TargetAgentID: &oldAgent}, nil
	}); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		mission, err := st.GetMission("msn_tx")
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := mission.Cursors[oldAgent]; ok {
			t.Fatalf("old cursor resurrected: %+v", mission.Cursors)
		}
		if _, ok := mission.PendingBells[oldAgent]; ok {
			t.Fatalf("old bell resurrected: %+v", mission.PendingBells)
		}
		if bell := mission.PendingBells[replacement]; bell == nil || bell.TargetSeq != 2 {
			t.Fatalf("replacement bell = %+v, want seq 2", bell)
		}
	}
}

func newTransactionFixture(t *testing.T) (string, *Store, Mission, Mission, Event, int64, []byte) {
	t.Helper()
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	if _, err := st.CreateMission(Mission{ID: "msn_tx", BaseCwd: homeDir, Title: "before"}); err != nil {
		t.Fatal(err)
	}
	seed, err := st.AppendEvent("msn_tx", Event{Kind: "seed"})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := st.GetMission("msn_tx")
	if err != nil {
		t.Fatal(err)
	}
	before := cloneMission(*loaded)
	after := cloneMission(before)
	after.Title = "after"
	after.HeadSeq = seed.Seq + 1
	after.UpdatedAt = "2099-01-01T00:00:00Z"
	target := "agent-target"
	after.PendingBells = map[string]*PendingBell{
		target: {AgentID: target, TargetSeq: after.HeadSeq, Reason: "transaction_committed", QueuedAt: after.UpdatedAt},
	}
	event := Event{
		Seq: after.HeadSeq, Ts: after.UpdatedAt, MissionID: "msn_tx",
		Kind: "transaction_committed", TargetAgentID: &target, Summary: "committed summary",
	}
	originalEvents := readTransactionEventBytes(t, homeDir, "msn_tx")
	return homeDir, st, before, after, event, int64(len(originalEvents)), originalEvents
}

func writeTestTransactionJournal(t *testing.T, homeDir, missionID, state string, before, after Mission, event Event, eventOffset int64) {
	t.Helper()
	payload, err := json.Marshal(testTransactionJournal{
		State: state, Before: before, After: after, Event: event, EventOffset: eventOffset,
	})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(homeDir, "orchestration", "missions", missionID, "transaction.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readTransactionEventBytes(t *testing.T, homeDir, missionID string) []byte {
	t.Helper()
	path := filepath.Join(homeDir, "orchestration", "missions", missionID, "events.jsonl")
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []byte{}
	}
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assertTransactionJournalRemoved(t *testing.T, homeDir, missionID string) {
	t.Helper()
	path := filepath.Join(homeDir, "orchestration", "missions", missionID, "transaction.json")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("transaction journal still exists or stat failed: %v", err)
	}
}
