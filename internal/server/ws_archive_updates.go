package server

// archiveRemovePayload builds the `workspace_update` kind:"remove" payload.
//
// Ported from resolveProjectWithoutActiveWorkspacesForArchivedWorkspace. The client deletes the workspace on this
// message; when that workspace was its project's last active one, the project is left with no children and the
// sidebar removes it too — which is why archiving a workspace looked like deleting its project. `emptyProject` tells
// the client the project still exists, so it stays visible.
func (s *Server) archiveRemovePayload(wsID, projectID, archivedAt string) map[string]any {
	payload := map[string]any{
		"kind":       "remove",
		"id":         wsID,
		"projectId":  projectID,
		"archivedAt": archivedAt,
	}
	if prj, ok := s.projectForWorkspace(projectID); ok {
		payload["projectRoot"] = prj.RootPath
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
	for _, target := range targets {
		s.broadcastSessionMsg("workspace_update", map[string]any{
			"kind":             "remove",
			"id":               target,
			"projectId":        projectID,
			"removedProjectId": projectID,
		})
	}
}
