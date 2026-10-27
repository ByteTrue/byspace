package server

// archiveRemovePayload builds the `workspace_update` kind:"remove" payload.
//
// Ported from resolveProjectWithoutActiveWorkspacesForArchivedWorkspace. The client deletes the workspace on this
// message; when that workspace was its project's last active one, the project is left with no children and the
// sidebar removes it too — which is why archiving a workspace looked like deleting its project. `emptyProject` tells
// the client the project still exists, so it stays visible.
//
// Only the fields the wire schema declares. The client routes a delta containing `projectId` (or `project`) to its
// project handler before it looks at `kind`, and that handler reads `kind:"remove"` as "the project is gone" — so a
// stray `projectId` here deletes the project and every workspace under it. Node sends nothing but these three fields
// for the same reason.
func (s *Server) archiveRemovePayload(wsID, projectID string) map[string]any {
	payload := map[string]any{
		"kind": "remove",
		"id":   wsID,
	}
	if prj, ok := s.projectForWorkspace(projectID); ok {
		if s.projectHasNoActiveWorkspaces(projectID) {
			payload["emptyProject"] = buildProjectDescriptor(prj)
		}
	}
	return payload
}

// projectHasNoActiveWorkspaces reports whether every workspace in a project is archived.
//
// The check runs after the archiving write, so the workspace being archived no longer counts.
func (s *Server) projectHasNoActiveWorkspaces(projectID string) bool {
	workspaces, err := s.store.ListWorkspaces()
	if err != nil {
		// Unknown is not the same as empty: claiming the project is empty makes the client keep a stale row, while
		// claiming it is not leaves the sidebar one refresh behind. The second is recoverable, so it is the default.
		return false
	}
	for _, ws := range workspaces {
		if ws.ProjectID != projectID {
			continue
		}
		if ws.ArchivedAt == nil {
			return false
		}
	}
	return true
}

// broadcastProjectRemoved tells clients a project is gone.
//
// Ported from handleProjectRemoveRequest. The removal rides the workspace update channel with `removedProjectId`, so an
// old client parses the message and ignores the extra field. Without it the daemon archived the project and the sidebar
// kept showing it until a full refetch — which read as the removal doing nothing.
func (s *Server) broadcastProjectRemoved(projectID string, removedWorkspaceIDs []string) {
	// The client needs at least one update to carry the field; when the project had no active workspaces there is no
	// workspace id to use, so the project id stands in — the same fallback node uses.
	targets := removedWorkspaceIDs
	if len(targets) == 0 {
		targets = []string{projectID}
	}
	// No `projectId` alongside `removedProjectId`: the client dispatches on `projectId` first and would take the
	// project-removal branch, which never clears the archived-agent bookkeeping the workspace branch does.
	for _, target := range targets {
		target := target
		s.broadcastDirectoryUpdate("workspace_update", func(includeSequence bool) map[string]any {
			return s.directory.SequenceWorkspaceUpdate(map[string]any{
				"kind":             "remove",
				"id":               target,
				"removedProjectId": projectID,
			}, nil, target, includeSequence)
		})
	}
}
