package server

import "github.com/ByteTrue/byspace/internal/store"

// ParentAgentIDLabel is the shared agent-label key for a delegated agent's parent.
// Mirrors PARENT_AGENT_ID_LABEL in packages/protocol/src/agent-labels.ts.
const ParentAgentIDLabel = "byspace.parent-agent-id"

// parentAgentIDFromLabels reads the parent link out of an agent's labels.
func parentAgentIDFromLabels(labels map[string]string) string {
	if labels == nil {
		return ""
	}
	return labels[ParentAgentIDLabel]
}

// resolveWorkspaceRootAgent walks the parent chain to the agent that started the conversation.
//
// Ported from resolveWorkspaceRootAgent in workspace-directory.ts. A subagent session belongs
// to the workspace of its root: the sidebar groups it under that conversation rather than
// showing a detached entry. Returning nil means "cannot attribute" — the chain is cyclic, a
// parent is missing, or the parent lives in another workspace — and the caller then treats the
// agent as its own root instead of guessing.
func resolveWorkspaceRootAgent(agent store.AgentRecord, activeByID map[string]store.AgentRecord) *store.AgentRecord {
	seen := map[string]bool{agent.ID: true}
	current := agent
	for {
		parentID := parentAgentIDFromLabels(current.Labels)
		if parentID == "" {
			return &current
		}
		if seen[parentID] {
			return nil // cycle
		}
		parent, ok := activeByID[parentID]
		if !ok {
			return nil
		}
		if parent.WorkspaceID != current.WorkspaceID {
			return &current
		}
		seen[parentID] = true
		current = parent
	}
}
