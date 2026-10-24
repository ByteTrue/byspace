package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func agentWithParent(id, workspace, parent string) store.AgentRecord {
	labels := map[string]string{}
	if parent != "" {
		labels[ParentAgentIDLabel] = parent
	}
	return store.AgentRecord{ID: id, WorkspaceID: workspace, Labels: labels}
}

// A subagent belongs to the workspace of the agent that started the conversation, so the
// sidebar groups it under that conversation.
func TestResolveWorkspaceRootAgentWalksChain(t *testing.T) {
	root := agentWithParent("root", "ws1", "")
	mid := agentWithParent("mid", "ws1", "root")
	leaf := agentWithParent("leaf", "ws1", "mid")
	active := map[string]store.AgentRecord{"root": root, "mid": mid, "leaf": leaf}

	got := resolveWorkspaceRootAgent(leaf, active)
	if got == nil || got.ID != "root" {
		t.Fatalf("expected root, got %+v", got)
	}
	// The root's own chain terminates at itself.
	if got := resolveWorkspaceRootAgent(root, active); got == nil || got.ID != "root" {
		t.Fatalf("root should resolve to itself, got %+v", got)
	}
}

// A missing parent means the chain cannot be attributed; returning nil is honest, and the
// caller treats the agent as its own root.
func TestResolveWorkspaceRootAgentMissingParent(t *testing.T) {
	orphan := agentWithParent("orphan", "ws1", "gone")
	if got := resolveWorkspaceRootAgent(orphan, map[string]store.AgentRecord{}); got != nil {
		t.Fatalf("expected nil for a missing parent, got %+v", got)
	}
}

// A cycle must not loop forever.
func TestResolveWorkspaceRootAgentCycle(t *testing.T) {
	a := agentWithParent("a", "ws1", "b")
	b := agentWithParent("b", "ws1", "a")
	active := map[string]store.AgentRecord{"a": a, "b": b}
	if got := resolveWorkspaceRootAgent(a, active); got != nil {
		t.Fatalf("expected nil for a cyclic chain, got %+v", got)
	}
}

// A parent in a different workspace stops the walk: git facts belong to the checkout, not to
// an ownership chain across workspaces.
func TestResolveWorkspaceRootAgentStopsAtWorkspaceBoundary(t *testing.T) {
	parent := agentWithParent("parent", "ws-other", "")
	child := agentWithParent("child", "ws1", "parent")
	active := map[string]store.AgentRecord{"parent": parent, "child": child}

	got := resolveWorkspaceRootAgent(child, active)
	if got == nil || got.ID != "child" {
		t.Fatalf("expected the child to be its own root across a workspace boundary, got %+v", got)
	}
}
