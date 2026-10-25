package server

import (
	"sort"
	"strings"
)

// Workspace list shaping, ported from the node daemon's directory listing.
//
// The sidebar owns search, sort and paging, and it sends all three on every fetch. Ignoring them
// meant the search box did nothing and a large workspace list was always sent whole.

type workspaceFilter struct {
	Query     string `json:"query"`
	ProjectID string `json:"projectId"`
}

type workspaceSortKey struct {
	Key       string `json:"key"`
	Direction string `json:"direction"`
}

type workspacePage struct {
	Limit  int    `json:"limit"`
	Cursor string `json:"cursor"`
}

// filterSortPageWorkspaces applies the request's filter, sort keys and cursor window.
func filterSortPageWorkspaces(
	entries []map[string]any,
	filter *workspaceFilter,
	sortKeys []workspaceSortKey,
	page *workspacePage,
) []map[string]any {
	out := entries

	if filter != nil {
		query := strings.ToLower(strings.TrimSpace(filter.Query))
		projectID := strings.TrimSpace(filter.ProjectID)
		if query != "" || projectID != "" {
			filtered := make([]map[string]any, 0, len(out))
			for _, entry := range out {
				if projectID != "" && stringField(entry, "projectId") != projectID {
					continue
				}
				if query != "" && !workspaceMatchesQuery(entry, query) {
					continue
				}
				filtered = append(filtered, entry)
			}
			out = filtered
		}
	}

	if len(sortKeys) > 0 {
		// Copy: the caller's slice may be a view into the store's order.
		sorted := make([]map[string]any, len(out))
		copy(sorted, out)
		sort.SliceStable(sorted, func(i, j int) bool {
			for _, key := range sortKeys {
				cmp := compareWorkspaceField(sorted[i], sorted[j], key.Key)
				if cmp == 0 {
					continue
				}
				if key.Direction == "desc" {
					return cmp > 0
				}
				return cmp < 0
			}
			return false
		})
		out = sorted
	}

	if page != nil && page.Limit > 0 {
		start := 0
		if cursor := strings.TrimSpace(page.Cursor); cursor != "" {
			// The cursor is the last id the client rendered.
			for i, entry := range out {
				if workspaceIDOf(entry) == cursor {
					start = i + 1
					break
				}
			}
		}
		if start > len(out) {
			start = len(out)
		}
		end := start + page.Limit
		if end > len(out) {
			end = len(out)
		}
		out = out[start:end]
	}

	return out
}

// workspaceMatchesQuery matches the free-text box against the names the sidebar shows.
func workspaceMatchesQuery(entry map[string]any, query string) bool {
	for _, field := range []string{"displayName", "kind", "branch", "worktreeSlug"} {
		if strings.Contains(strings.ToLower(stringField(entry, field)), query) {
			return true
		}
	}
	if project, ok := entry["project"].(map[string]any); ok {
		for _, field := range []string{"projectName", "projectRootPath"} {
			if strings.Contains(strings.ToLower(stringField(project, field)), query) {
				return true
			}
		}
	}
	return strings.Contains(strings.ToLower(workspaceIDOf(entry)), query)
}

func stringField(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// workspaceIDOf reads the workspace's wire id from a descriptor.
func workspaceIDOf(entry map[string]any) string {
	if id := stringField(entry, "id"); id != "" {
		return id
	}
	return stringField(entry, "workspaceId")
}

// compareWorkspaceField returns -1/0/1 for the documented sort keys.
func compareWorkspaceField(a, b map[string]any, key string) int {
	switch key {
	case "name":
		return strings.Compare(strings.ToLower(stringField(a, "displayName")), strings.ToLower(stringField(b, "displayName")))
	case "project_id":
		return strings.Compare(stringField(a, "projectId"), stringField(b, "projectId"))
	case "activity_at":
		return strings.Compare(stringField(a, "updatedAt"), stringField(b, "updatedAt"))
	case "status_priority":
		// Running before idle: the sidebar puts active work on top.
		return workspaceStatusRank(b) - workspaceStatusRank(a)
	default:
		return 0
	}
}

func workspaceStatusRank(entry map[string]any) int {
	switch stringField(entry, "agentStatus") {
	case "running", "active":
		return 2
	case "attention":
		return 1
	default:
		return 0
	}
}
