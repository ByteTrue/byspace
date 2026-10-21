package server

import (
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
)

// OpenAgentTabLabelPrefix marks labels recording that a user opened this agent in a tab.
//
// Ported from @bytetrue/protocol/agent-labels. The label matters when a parent is archived: a
// child the user is looking at must not vanish, so it is detached instead of archived.
const OpenAgentTabLabelPrefix = "byspace.open-agent-tab."

// isOpenAgentTabLabel reports whether a label records an open tab.
func isOpenAgentTabLabel(label string) bool {
	return strings.HasPrefix(label, OpenAgentTabLabelPrefix)
}

// hasOpenAgentTab reports whether any of the agent's tab labels is set to "true".
func hasOpenAgentTab(labels map[string]string) bool {
	for label, value := range labels {
		if isOpenAgentTabLabel(label) && value == "true" {
			return true
		}
	}
	return false
}

// shouldDetachFromArchivedParent decides what happens to a child when its parent is archived.
//
// Ported from shouldDetachFromArchivedParent. A child in a different workspace belongs to that
// workspace, not to the parent's; a child the user has open is being read right now. Archiving
// either would delete work the user can still see.
func shouldDetachFromArchivedParent(parent, child store.AgentRecord) bool {
	crossWorkspace := parent.WorkspaceID != "" && child.WorkspaceID != "" && parent.WorkspaceID != child.WorkspaceID
	return crossWorkspace || hasOpenAgentTab(child.Labels)
}

// detachedLabelPatch drops the parent link and every open-tab marker.
func detachedLabelPatch(labels map[string]string) map[string]string {
	patch := map[string]string{ParentAgentIDLabel: ""}
	for label := range labels {
		if isOpenAgentTabLabel(label) {
			patch[label] = ""
		}
	}
	return patch
}

// cascadeArchiveChildren archives the delegated agents of an archived parent.
//
// Without this, archiving a conversation leaves every subagent it spawned running: they keep
// consuming tokens and hold their provider processes for a conversation the user removed.
func (s *Server) cascadeArchiveChildren(parentID string) {
	parent, err := s.store.GetAgent(parentID)
	if err != nil || parent == nil {
		return
	}
	records, err := s.store.ListAgents()
	if err != nil {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	for i := range records {
		child := &records[i]
		if child.ArchivedAt != nil || parentAgentIDFromLabels(child.Labels) != parentID {
			continue
		}
		if shouldDetachFromArchivedParent(*parent, *child) {
			// Keep it: drop the parent link so it stops appearing under a deleted conversation.
			for label, value := range detachedLabelPatch(child.Labels) {
				if value == "" {
					delete(child.Labels, label)
				} else {
					child.Labels[label] = value
				}
			}
			child.UpdatedAt = now
			_ = s.store.UpsertAgent(*child)
			s.broadcastAgentUpdate(*child)
			continue
		}

		// Stop the provider before archiving: an archived record with a live process keeps
		// spending tokens.
		s.mu.Lock()
		mp := s.agents[child.ID]
		delete(s.agents, child.ID)
		s.mu.Unlock()
		if mp != nil && mp.session != nil {
			_ = mp.session.Close()
		}

		child.ArchivedAt = &now
		child.UpdatedAt = now
		child.LastStatus = "closed"
		_ = s.store.UpsertAgent(*child)
		s.broadcastAgentUpdate(*child)
		s.broadcastSessionMsg("agent_archived", map[string]any{
			"agentId":    child.ID,
			"archivedAt": now,
		})
		// A grandchild may exist: recurse so the whole subtree is handled.
		s.cascadeArchiveChildren(child.ID)
	}
}
