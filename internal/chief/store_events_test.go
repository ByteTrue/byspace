package chief

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreReadEventsFinalLineValidation(t *testing.T) {
	validFirst := "{\"seq\":1,\"missionId\":\"msn_events\",\"kind\":\"first\"}"
	validSecond := "{\"seq\":2,\"missionId\":\"msn_events\",\"kind\":\"second\"}"
	tests := []struct {
		name        string
		raw         string
		wantEvents  int
		wantErr     string
		preserveRaw bool
	}{
		{name: "unterminated malformed tail ignored", raw: validFirst + "\n" + "{\"seq\":2", wantEvents: 1},
		{name: "terminated malformed tail rejected", raw: validFirst + "\n" + "{\"seq\":2" + "\n", wantErr: "corrupt event line 2"},
		{name: "valid unterminated final record parsed", raw: validFirst + "\n" + validSecond, wantEvents: 2, preserveRaw: true},
		{name: "malformed non final record rejected", raw: validFirst + "\n" + "{\"seq\":2" + "\n" + validSecond + "\n", wantErr: "corrupt event line 2"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			homeDir := t.TempDir()
			st := NewStore(homeDir)
			if _, err := st.CreateMission(Mission{ID: "msn_events", BaseCwd: homeDir}); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(homeDir, "orchestration", "missions", "msn_events", "events.jsonl")
			if err := os.WriteFile(path, []byte(tt.raw), 0o600); err != nil {
				t.Fatal(err)
			}
			events, err := st.ReadEvents("msn_events", 0, 0)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("ReadEvents() error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("ReadEvents() error = %v", err)
			}
			if len(events) != tt.wantEvents {
				t.Fatalf("ReadEvents() returned %d events, want %d: %+v", len(events), tt.wantEvents, events)
			}
			if tt.preserveRaw {
				if _, err := st.GetMission("msn_events"); err != nil {
					t.Fatalf("GetMission() error = %v", err)
				}
				after, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if string(after) != tt.raw {
					t.Fatalf("valid unterminated record changed from %q to %q", tt.raw, after)
				}
			}
		})
	}
}

func TestStoreAppendEventAfterTornTail(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	if _, err := st.CreateMission(Mission{ID: "msn_events", BaseCwd: homeDir}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(homeDir, "orchestration", "missions", "msn_events", "events.jsonl")
	first := "{\"seq\":1,\"missionId\":\"msn_events\",\"kind\":\"first\"}"
	if err := os.WriteFile(path, []byte(first+"\n{\"seq\":2"), 0o600); err != nil {
		t.Fatal(err)
	}
	appended, err := st.AppendEvent("msn_events", Event{Kind: "appended"})
	if err != nil {
		t.Fatalf("AppendEvent() error = %v", err)
	}
	if appended.Seq != 2 {
		t.Fatalf("AppendEvent() seq = %d, want 2", appended.Seq)
	}
	for attempt := 0; attempt < 2; attempt++ {
		events, err := st.ReadEvents("msn_events", 0, 0)
		if err != nil {
			t.Fatalf("ReadEvents() attempt %d error = %v", attempt, err)
		}
		if len(events) != 2 || events[0].Kind != "first" || events[1].Kind != "appended" {
			t.Fatalf("ReadEvents() attempt %d = %+v, want first and appended", attempt, events)
		}
		mission, err := st.GetMission("msn_events")
		if err != nil {
			t.Fatalf("GetMission() attempt %d error = %v", attempt, err)
		}
		if mission.HeadSeq != 2 {
			t.Fatalf("GetMission() attempt %d HeadSeq = %d, want 2", attempt, mission.HeadSeq)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("events.jsonl = %q, want two complete records", raw)
	}
	for idx, line := range lines {
		var event Event
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("events.jsonl line %d is invalid: %v", idx+1, err)
		}
	}
}

func TestStoreAppendEventAfterValidUnterminatedRecord(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	if _, err := st.CreateMission(Mission{ID: "msn_events", BaseCwd: homeDir}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(homeDir, "orchestration", "missions", "msn_events", "events.jsonl")
	first := "{\"seq\":1,\"missionId\":\"msn_events\",\"kind\":\"first\"}"
	second := "{\"seq\":2,\"missionId\":\"msn_events\",\"kind\":\"second\"}"
	if err := os.WriteFile(path, []byte(first+"\n"+second), 0o600); err != nil {
		t.Fatal(err)
	}
	appended, err := st.AppendEvent("msn_events", Event{Kind: "appended"})
	if err != nil {
		t.Fatalf("AppendEvent() error = %v", err)
	}
	if appended.Seq != 3 {
		t.Fatalf("AppendEvent() seq = %d, want 3", appended.Seq)
	}
	for attempt := 0; attempt < 2; attempt++ {
		events, err := st.ReadEvents("msn_events", 0, 0)
		if err != nil {
			t.Fatalf("ReadEvents() attempt %d error = %v", attempt, err)
		}
		if len(events) != 3 || events[0].Kind != "first" || events[1].Kind != "second" || events[2].Kind != "appended" {
			t.Fatalf("ReadEvents() attempt %d = %+v, want first, second, and appended", attempt, events)
		}
	}
}

func TestStoreListMissionsSurfacesCorruption(t *testing.T) {
	tests := []struct {
		name      string
		missionID string
		wantErr   string
		corrupt   func(t *testing.T, homeDir, missionID string)
	}{
		{
			name: "malformed mission JSON", missionID: "msn_bad_mission", wantErr: "parse mission",
			corrupt: func(t *testing.T, homeDir, missionID string) {
				t.Helper()
				path := filepath.Join(homeDir, "orchestration", "missions", missionID, "mission.json")
				if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "terminated malformed event", missionID: "msn_bad_events", wantErr: "corrupt event line",
			corrupt: func(t *testing.T, homeDir, missionID string) {
				t.Helper()
				path := filepath.Join(homeDir, "orchestration", "missions", missionID, "events.jsonl")
				if err := os.WriteFile(path, []byte("{\"seq\":2\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			homeDir := t.TempDir()
			st := NewStore(homeDir)
			if _, err := st.CreateMission(Mission{ID: tt.missionID, BaseCwd: homeDir, Threads: []Thread{{ID: "thr_corrupt"}}}); err != nil {
				t.Fatal(err)
			}
			tt.corrupt(t, homeDir, tt.missionID)
			operations := []struct {
				name string
				load func(*Store) error
			}{
				{name: "ListMissions", load: func(st *Store) error { _, err := st.ListMissions(); return err }},
				{name: "FindMissionByThread", load: func(st *Store) error { _, err := st.FindMissionByThread("thr_corrupt"); return err }},
				{name: "RecoverPendingBells", load: func(st *Store) error { _, err := st.RecoverPendingBells(); return err }},
			}
			for _, operation := range operations {
				t.Run(operation.name, func(t *testing.T) {
					err := operation.load(st)
					if err == nil || !strings.Contains(err.Error(), tt.missionID) || !strings.Contains(err.Error(), tt.wantErr) {
						t.Fatalf("error = %v, want %s and %q with mission context", err, tt.missionID, tt.wantErr)
					}
				})
			}
		})
	}
}

func TestStoreRetiredAgentDoesNotRecoverDelivery(t *testing.T) {
	homeDir := t.TempDir()
	st := NewStore(homeDir)
	oldAgent := "agent-old"
	replacementAgent := "agent-new"
	if _, err := st.CreateMission(Mission{ID: "msn_retired", BaseCwd: homeDir, Cursors: map[string]int64{oldAgent: 0}}); err != nil {
		t.Fatal(err)
	}
	first, err := st.AppendEvent("msn_retired", Event{Kind: "old_request", TargetAgentID: &oldAgent, Ts: "2026-01-01T00:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	missionPath := filepath.Join(homeDir, "orchestration", "missions", "msn_retired", "mission.json")
	rawMission, err := os.ReadFile(missionPath)
	if err != nil {
		t.Fatal(err)
	}
	var persisted map[string]any
	if err := json.Unmarshal(rawMission, &persisted); err != nil {
		t.Fatal(err)
	}
	persisted["retiredAgents"] = map[string]any{oldAgent: first.Seq}
	delete(persisted["cursors"].(map[string]any), oldAgent)
	delete(persisted["pendingBells"].(map[string]any), oldAgent)
	rawMission, err = json.Marshal(persisted)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(missionPath, rawMission, 0o600); err != nil {
		t.Fatal(err)
	}
	trailing, err := json.Marshal(Event{Seq: first.Seq + 1, MissionID: "msn_retired", Kind: "trailing_old_request", TargetAgentID: &oldAgent, Ts: "2026-01-01T00:00:01Z"})
	if err != nil {
		t.Fatal(err)
	}
	eventsPath := filepath.Join(homeDir, "orchestration", "missions", "msn_retired", "events.jsonl")
	file, err := os.OpenFile(eventsPath, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(append(trailing, '\n')); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		mission, err := st.GetMission("msn_retired")
		if err != nil {
			t.Fatal(err)
		}
		if mission.HeadSeq != first.Seq+1 {
			t.Fatalf("HeadSeq = %d, want %d", mission.HeadSeq, first.Seq+1)
		}
		if _, ok := mission.Cursors[oldAgent]; ok {
			t.Fatalf("retired cursor resurrected on read %d: %+v", attempt, mission.Cursors)
		}
		if _, ok := mission.PendingBells[oldAgent]; ok {
			t.Fatalf("retired bell resurrected on read %d: %+v", attempt, mission.PendingBells)
		}
	}
	rawMission, err = os.ReadFile(missionPath)
	if err != nil {
		t.Fatal(err)
	}
	var retirement struct {
		RetiredAgents map[string]int64 `json:"retiredAgents"`
	}
	if err := json.Unmarshal(rawMission, &retirement); err != nil {
		t.Fatal(err)
	}
	if retirement.RetiredAgents[oldAgent] != first.Seq {
		t.Fatalf("retirement marker = %+v, want %s at seq %d", retirement.RetiredAgents, oldAgent, first.Seq)
	}
	if err := st.RecordBellAttempt("msn_retired", oldAgent, "late old delivery failure"); err != nil {
		t.Fatal(err)
	}
	mission, err := st.GetMission("msn_retired")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := mission.PendingBells[oldAgent]; ok {
		t.Fatalf("late attempt resurrected old bell: %+v", mission.PendingBells)
	}
	if err := st.MarkBellDelivered("msn_retired", oldAgent, first.Seq+1); err != nil {
		t.Fatal(err)
	}
	mission, err = st.GetMission("msn_retired")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := mission.Cursors[oldAgent]; ok {
		t.Fatalf("late delivery resurrected old cursor: %+v", mission.Cursors)
	}
	replacementEvent, err := st.AppendEvent("msn_retired", Event{Kind: "replacement_request", TargetAgentID: &replacementAgent})
	if err != nil {
		t.Fatal(err)
	}
	mission, err = st.GetMission("msn_retired")
	if err != nil {
		t.Fatal(err)
	}
	if bell := mission.PendingBells[replacementAgent]; bell == nil || bell.TargetSeq != replacementEvent.Seq {
		t.Fatalf("replacement delivery = %+v, want seq %d", bell, replacementEvent.Seq)
	}
	if _, ok := mission.PendingBells[oldAgent]; ok {
		t.Fatalf("replacement delivery resurrected old bell: %+v", mission.PendingBells)
	}
	bells, err := st.RecoverPendingBells()
	if err != nil {
		t.Fatal(err)
	}
	if len(bells) != 1 || bells[0].AgentID != replacementAgent {
		t.Fatalf("RecoverPendingBells() = %+v, want only %s", bells, replacementAgent)
	}
}
