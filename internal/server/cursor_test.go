package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// An offset cursor shifts whenever an agent finishes or a new one appears between fetches, which
// shows the client a duplicate and hides whatever fell into the gap. A keyset cursor continues
// from the last row seen regardless.
func TestKeysetCursorSurvivesInsertion(t *testing.T) {
	srv := &Server{}
	mk := func(id, activity string) store.AgentRecord {
		rec := store.AgentRecord{ID: id, LastStatus: "idle", CreatedAt: "2026-01-01T00:00:00Z"}
		rec.LastActivityAt = activity
		return rec
	}
	records := []store.AgentRecord{
		mk("a", "2026-01-05T00:00:00Z"),
		mk("b", "2026-01-04T00:00:00Z"),
		mk("c", "2026-01-03T00:00:00Z"),
		mk("d", "2026-01-02T00:00:00Z"),
	}

	first, hasMore, cursor := srv.filterAndSortAgents(records, "", nil, "", 2, "")
	if !hasMore || cursor == nil || len(first) != 2 {
		t.Fatalf("first page: %d hasMore=%v", len(first), hasMore)
	}
	if first[0].ID != "a" || first[1].ID != "b" {
		t.Fatalf("first page order: %s,%s", first[0].ID, first[1].ID)
	}

	// A new agent appears at the top between fetches. An offset cursor would now return "b"
	// again; a keyset cursor must return c and d.
	updated := append([]store.AgentRecord{mk("newest", "2026-01-06T00:00:00Z")}, records...)

	second, secondHasMore, _ := srv.filterAndSortAgents(updated, "", nil, "", 2, *cursor)
	if len(second) != 2 || second[0].ID != "c" || second[1].ID != "d" {
		ids := make([]string, len(second))
		for i, rec := range second {
			ids[i] = rec.ID
		}
		t.Fatalf("second page after insertion: %v, want [c d]", ids)
	}
	if secondHasMore {
		t.Fatal("second page should be the last")
	}
}

// A cursor minted under one ordering must be rejected under another, or it would skip rows.
func TestCursorRejectsDifferentSort(t *testing.T) {
	sortDesc := []cursorSort{{Key: "last_activity_at", Direction: "desc"}}
	cursor := encodeCursor("a", map[string]any{"last_activity_at": "2026-01-01T00:00:00Z"}, sortDesc)

	if _, err := decodeCursor(cursor, sortDesc); err != nil {
		t.Fatalf("same sort should decode: %v", err)
	}
	sortAsc := []cursorSort{{Key: "last_activity_at", Direction: "asc"}}
	if _, err := decodeCursor(cursor, sortAsc); err == nil {
		t.Fatal("a cursor minted for descending order must not be applied to ascending")
	}
	otherKey := []cursorSort{{Key: "title", Direction: "desc"}}
	if _, err := decodeCursor(cursor, otherKey); err == nil {
		t.Fatal("a cursor minted for another key must be rejected")
	}
}

// A malformed cursor must not silently restart from the beginning, which would loop the client
// over the same first page forever.
func TestMalformedCursorYieldsEmptyPage(t *testing.T) {
	srv := &Server{}
	records := []store.AgentRecord{{ID: "a", LastStatus: "idle", UpdatedAt: "2026-01-01T00:00:00Z"}}
	page, hasMore, next := srv.filterAndSortAgents(records, "", nil, "", 10, "not-a-cursor")
	if len(page) != 0 || hasMore || next != nil {
		t.Fatalf("expected an empty page, got %d hasMore=%v", len(page), hasMore)
	}
}

// Ties on the sort key break by id, so a page boundary cannot land inside a group of equal
// values and drop rows.
func TestCursorBreaksTiesById(t *testing.T) {
	srv := &Server{}
	rec := func(id string) store.AgentRecord {
		r := store.AgentRecord{ID: id, LastStatus: "idle", CreatedAt: "2026-01-01T00:00:00Z"}
		r.LastActivityAt = "2026-01-05T00:00:00Z" // identical for all
		return r
	}
	records := []store.AgentRecord{rec("a"), rec("b"), rec("c")}

	first, _, cursor := srv.filterAndSortAgents(records, "", nil, "", 1, "")
	if len(first) != 1 || cursor == nil {
		t.Fatal("expected one row and a cursor")
	}
	seen := map[string]bool{first[0].ID: true}
	for cursor != nil {
		page, more, next := srv.filterAndSortAgents(records, "", nil, "", 1, *cursor)
		for _, r := range page {
			if seen[r.ID] {
				t.Fatalf("duplicate row across pages: %s", r.ID)
			}
			seen[r.ID] = true
		}
		if !more {
			break
		}
		cursor = next
	}
	if len(seen) != 3 {
		t.Fatalf("paging skipped rows: saw %d of 3", len(seen))
	}
}
