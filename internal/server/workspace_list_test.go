package server

import "testing"

func wsEntry(id, name, projectID, branch string) map[string]any {
	return map[string]any{
		"id":          id,
		"displayName": name,
		"projectId":   projectID,
		"branch":      branch,
		"project":     map[string]any{"projectName": "BySpace"},
	}
}

// The sidebar owns the search box; ignoring `filter.query` made it do nothing.
func TestFilterWorkspacesByQuery(t *testing.T) {
	entries := []map[string]any{
		wsEntry("w1", "main", "p1", "feat/login"),
		wsEntry("w2", "hotfix", "p1", "main"),
	}
	got := filterSortPageWorkspaces(entries, &workspaceFilter{Query: "login"}, nil, nil)
	if len(got) != 1 || got[0]["id"] != "w1" {
		t.Fatalf("query should match the branch, got %v", got)
	}
	// The project name is searchable too: a user types the repo they are looking for.
	if got := filterSortPageWorkspaces(entries, &workspaceFilter{Query: "byspace"}, nil, nil); len(got) != 2 {
		t.Fatalf("project name should match both, got %d", len(got))
	}
}

func TestFilterWorkspacesByProject(t *testing.T) {
	entries := []map[string]any{wsEntry("w1", "a", "p1", ""), wsEntry("w2", "b", "p2", "")}
	got := filterSortPageWorkspaces(entries, &workspaceFilter{ProjectID: "p2"}, nil, nil)
	if len(got) != 1 || got[0]["id"] != "w2" {
		t.Fatalf("project filter: %v", got)
	}
}

// Direction must be honoured; a list sorted the wrong way looks like data loss.
func TestSortWorkspacesByName(t *testing.T) {
	entries := []map[string]any{wsEntry("w1", "beta", "", ""), wsEntry("w2", "Alpha", "", "")}
	asc := filterSortPageWorkspaces(entries, nil, []workspaceSortKey{{Key: "name", Direction: "asc"}}, nil)
	if asc[0]["id"] != "w2" {
		t.Fatalf("asc should put Alpha first, got %v", asc[0]["displayName"])
	}
	desc := filterSortPageWorkspaces(entries, nil, []workspaceSortKey{{Key: "name", Direction: "desc"}}, nil)
	if desc[0]["id"] != "w1" {
		t.Fatalf("desc should put beta first, got %v", desc[0]["displayName"])
	}
}

// A cursor pages from the entry after the one the client last saw.
func TestPageWorkspacesByCursor(t *testing.T) {
	entries := []map[string]any{
		wsEntry("w1", "a", "", ""), wsEntry("w2", "b", "", ""), wsEntry("w3", "c", "", ""),
	}
	first := filterSortPageWorkspaces(entries, nil, nil, &workspacePage{Limit: 2})
	if len(first) != 2 || first[0]["id"] != "w1" {
		t.Fatalf("first page: %v", first)
	}
	second := filterSortPageWorkspaces(entries, nil, nil, &workspacePage{Limit: 2, Cursor: "w2"})
	if len(second) != 1 || second[0]["id"] != "w3" {
		t.Fatalf("second page: %v", second)
	}
	// A cursor past the end yields nothing rather than panicking or wrapping.
	if rest := filterSortPageWorkspaces(entries, nil, nil, &workspacePage{Limit: 2, Cursor: "w3"}); len(rest) != 0 {
		t.Fatalf("cursor past end: %v", rest)
	}
}
