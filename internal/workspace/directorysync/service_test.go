package directorysync

import "testing"

func project(id, name string) Entry {
	return Entry{"projectId": id, "displayName": name, "rootPath": "/tmp/" + id}
}

func workspace(id, projectID, title string) Entry {
	return Entry{"id": id, "projectId": projectID, "displayName": title}
}

func agent(id, title string) Entry {
	return Entry{
		"agent":   Entry{"id": id, "title": title},
		"project": Entry{"projectKey": "/tmp/p", "projectName": "p"},
	}
}

// A cursor from another generation cannot be advanced: the replica may describe rows this process
// never saw, so it gets a snapshot.
func TestCursorFromAnotherGenerationGetsASnapshot(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	s.SynchronizeProjects([]Entry{project("p1", "one")}, Cursor{}, true)

	after := int64(1)
	entries, meta := s.SynchronizeProjects(
		[]Entry{project("p1", "one")},
		Cursor{Generation: "gen_b", AfterSeq: &after},
		true,
	)
	if meta.Mode != "snapshot" || meta.Reason != "generation_changed" {
		t.Fatalf("metadata = %+v, want a snapshot with generation_changed", meta)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %+v, want the full projection", entries)
	}
}

// A cursor with no generation is the first poll and gets a snapshot.
func TestNoCursorGetsASnapshot(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	entries, meta := s.SynchronizeProjects([]Entry{project("p1", "one")}, Cursor{}, true)
	if meta.Mode != "snapshot" || meta.Reason != "no_cursor" {
		t.Fatalf("metadata = %+v, want a snapshot with no_cursor", meta)
	}
	if len(entries) != 1 || entries[0]["syncSeq"] != int64(1) {
		t.Fatalf("entries = %+v, want one row carrying its sequence", entries)
	}
}

// A second poll returns only what changed, plus the removal of a row that disappeared.
//
// This is the whole feature: without it the client replaces its entire table on every poll and can
// never be told that a row was deleted.
func TestSecondPollReturnsOnlyChanges(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	_, meta := s.SynchronizeWorkspaces([]Entry{
		workspace("w1", "p1", "one"),
		workspace("w2", "p1", "two"),
	}, Cursor{}, true)
	cursor := meta.HeadSeq

	entries, meta := s.SynchronizeWorkspaces([]Entry{
		workspace("w1", "p1", "one renamed"),
	}, Cursor{Generation: "gen_a", AfterSeq: &cursor}, true)

	if meta.Mode != "changes" {
		t.Fatalf("mode = %q, want changes", meta.Mode)
	}
	if len(entries) != 1 || entries[0]["displayName"] != "one renamed" {
		t.Fatalf("entries = %+v, want only the renamed workspace", entries)
	}
	if len(meta.Removals) != 1 || meta.Removals[0].ID != "w2" {
		t.Fatalf("removals = %+v, want w2 removed", meta.Removals)
	}
}

// Unchanged rows keep their sequence, so an idle poll returns nothing at all.
func TestIdlePollReturnsNothing(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	snapshot := []Entry{workspace("w1", "p1", "one")}
	_, meta := s.SynchronizeWorkspaces(snapshot, Cursor{}, true)
	cursor := meta.HeadSeq

	entries, meta := s.SynchronizeWorkspaces(snapshot, Cursor{Generation: "gen_a", AfterSeq: &cursor}, true)
	if meta.Mode != "changes" {
		t.Fatalf("mode = %q, want changes", meta.Mode)
	}
	if len(entries) != 0 || len(meta.Removals) != 0 {
		t.Fatalf("entries = %+v removals = %+v, want nothing", entries, meta.Removals)
	}
	if meta.HeadSeq != cursor {
		t.Fatalf("headSeq moved from %d to %d without a change", cursor, meta.HeadSeq)
	}
}

// The three entity types keep independent sequences.
func TestEntityTypesDoNotShareASequence(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	s.SynchronizeProjects([]Entry{project("p1", "one")}, Cursor{}, true)
	_, meta := s.SynchronizeWorkspaces([]Entry{workspace("w1", "p1", "one")}, Cursor{}, true)
	if meta.HeadSeq != 1 {
		t.Fatalf("workspaces headSeq = %d, want 1: a project change must not move it", meta.HeadSeq)
	}
}

// A live update carries the generation and the sequence the row was published at.
func TestLiveUpdateCarriesGenerationAndSequence(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	entry := workspace("w1", "p1", "one")
	payload := s.SequenceWorkspaceUpdate(map[string]any{"kind": "upsert"}, entry, "w1", true)
	if payload["generation"] != "gen_a" || payload["seq"] != int64(1) {
		t.Fatalf("payload = %+v, want generation and seq", payload)
	}

	// The same row published again produces no sequence, because nothing changed.
	repeat := s.SequenceWorkspaceUpdate(map[string]any{"kind": "upsert"}, entry, "w1", true)
	if _, has := repeat["seq"]; has {
		t.Fatalf("an unchanged update claimed seq %v", repeat["seq"])
	}
}

// A client that never sent a cursor does not get sequencing fields it will not read.
func TestLiveUpdateWithoutCursorOmitsSequence(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	payload := s.SequenceWorkspaceUpdate(
		map[string]any{"kind": "upsert"},
		workspace("w1", "p1", "one"),
		"w1",
		false,
	)
	if _, has := payload["seq"]; has {
		t.Fatalf("payload = %+v, want no seq", payload)
	}
}

// A live removal publishes a tombstone the next poll reports.
func TestLiveRemovalIsReportedByTheNextPoll(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	s.SequenceWorkspaceUpdate(map[string]any{"kind": "upsert"}, workspace("w1", "p1", "one"), "w1", true)

	removal := s.SequenceWorkspaceUpdate(map[string]any{"kind": "remove"}, nil, "w1", true)
	if removal["seq"] != int64(2) {
		t.Fatalf("removal = %+v, want seq 2", removal)
	}

	after := int64(1)
	_, meta := s.SynchronizeWorkspaces(nil, Cursor{Generation: "gen_a", AfterSeq: &after}, true)
	if len(meta.Removals) != 1 || meta.Removals[0].ID != "w1" {
		t.Fatalf("removals = %+v, want w1", meta.Removals)
	}
}

// Agents key on the nested agent id, not on a top-level field.
func TestAgentEntriesKeyOnTheNestedAgentID(t *testing.T) {
	s := NewServiceWithGeneration("gen_a")
	_, meta := s.SynchronizeAgents([]Entry{agent("a1", "one"), agent("a2", "two")}, Cursor{}, true)
	cursor := meta.HeadSeq

	entries, meta := s.SynchronizeAgents([]Entry{agent("a1", "renamed")}, Cursor{Generation: "gen_a", AfterSeq: &cursor}, true)
	if len(entries) != 1 {
		t.Fatalf("entries = %+v, want one changed agent", entries)
	}
	if len(meta.Removals) != 1 || meta.Removals[0].ID != "a2" {
		t.Fatalf("removals = %+v, want a2", meta.Removals)
	}
}
