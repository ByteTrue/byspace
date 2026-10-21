package server

import (
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/attention"
	"github.com/ByteTrue/byspace/internal/store"
)

// Agent attention state, ported from agent-manager.ts (markAgentUnread / clearAgentAttention).
//
// Attention is what the sidebar badge and the push notification key off: "this agent finished,
// look at it". Without it the badge never appears and a finished long-running task is
// indistinguishable from one that never started.
//
// Two invariants the node implementation enforces and a naive version misses:
//
//   - Marking requires the agent to be *finished and read*. Marking a running agent unread is
//     meaningless (it is already the most visible thing), and re-marking an already-unread agent
//     would move its timestamp forward and re-notify.
//   - A pending permission request blocks marking: the agent is waiting for the user, which is a
//     different state from "finished".

// AttentionReasons are the values the protocol accepts.
const (
	AttentionReasonFinished   = "finished"
	AttentionReasonPermission = "permission"
	AttentionReasonError      = "error"
)

// markAgentAttention flags an agent as needing the user's attention.
//
// The caller holds no lock: this takes s.mu itself.
func (s *Server) markAgentAttention(agentID, reason, timestamp string) bool {
	s.mu.Lock()
	mp, live := s.agents[agentID]
	if !live || mp == nil {
		s.mu.Unlock()
		return s.markStoredAgentAttention(agentID, reason, timestamp)
	}
	// Already flagged: keep the original timestamp so the badge does not jump.
	if mp.record.RequiresAttention {
		s.mu.Unlock()
		return false
	}
	ts := timestamp
	if ts == "" {
		ts = time.Now().UTC().Format(time.RFC3339Nano)
	}
	r := reason
	mp.record.RequiresAttention = true
	mp.record.AttentionReason = &r
	mp.record.AttentionTimestamp = &ts
	rec := mp.record
	s.mu.Unlock()

	_ = s.store.UpsertAgent(rec)
	s.broadcastAgentUpdate(rec)
	return true
}

// markStoredAgentAttention covers an agent with no live session.
//
// Node applies the same "finished" precondition here: a stored record that is still running
// belongs to another daemon's session or a stale process, and marking it unread would be a lie.
func (s *Server) markStoredAgentAttention(agentID, reason, timestamp string) bool {
	rec, err := s.store.GetAgent(agentID)
	if err != nil || rec == nil {
		return false
	}
	if rec.ArchivedAt != nil || rec.RequiresAttention {
		return false
	}
	switch reason {
	case AttentionReasonFinished:
		if rec.LastStatus != "idle" && rec.LastStatus != "closed" {
			return false
		}
	}
	ts := timestamp
	if ts == "" {
		ts = time.Now().UTC().Format(time.RFC3339Nano)
	}
	r := reason
	rec.RequiresAttention = true
	rec.AttentionReason = &r
	rec.AttentionTimestamp = &ts
	rec.UpdatedAt = ts
	_ = s.store.UpsertAgent(*rec)
	s.broadcastAgentUpdate(*rec)
	return true
}

// clearAgentAttention removes the flag and reports whether anything changed.
func (s *Server) clearAgentAttention(agentID string) bool {
	s.mu.Lock()
	mp, live := s.agents[agentID]
	if live && mp != nil && mp.record.RequiresAttention {
		mp.record.RequiresAttention = false
		mp.record.AttentionReason = nil
		mp.record.AttentionTimestamp = nil
		rec := mp.record
		s.mu.Unlock()
		_ = s.store.UpsertAgent(rec)
		s.broadcastAgentUpdate(rec)
		return true
	}
	s.mu.Unlock()

	rec, err := s.store.GetAgent(agentID)
	if err != nil || rec == nil || !rec.RequiresAttention {
		return false
	}
	rec.RequiresAttention = false
	rec.AttentionReason = nil
	rec.AttentionTimestamp = nil
	_ = s.store.UpsertAgent(*rec)
	s.broadcastAgentUpdate(*rec)
	return true
}

// canMarkUnread mirrors the node precondition list for a workspace-level mark.
func (s *Server) canMarkUnread(rec store.AgentRecord) bool {
	if rec.ArchivedAt != nil || rec.Internal || rec.RequiresAttention {
		return false
	}
	if rec.LastStatus != "idle" && rec.LastStatus != "closed" {
		return false
	}
	// A pending permission request is "waiting for you", not "finished".
	s.mu.Lock()
	mp := s.agents[rec.ID]
	hasPending := false
	if mp != nil && mp.session != nil {
		hasPending = len(mp.session.PendingPermissions()) > 0
	}
	s.mu.Unlock()
	return !hasPending
}

// workspaceAttentionCandidates lists the agents a workspace-level operation applies to.
func (s *Server) workspaceAttentionCandidates(workspaceID string) []store.AgentRecord {
	agents, err := s.store.ListAgents()
	if err != nil {
		return nil
	}
	out := make([]store.AgentRecord, 0, 4)
	for _, rec := range agents {
		if rec.WorkspaceID != workspaceID || rec.ArchivedAt != nil {
			continue
		}
		out = append(out, rec)
	}
	return out
}

// firstMarkableAgent picks the agent a "mark unread" request should flag.
//
// A workspace can hold several agents; Node marks one (the most recently active finished one),
// which is what the sidebar's badge represents.
func (s *Server) firstMarkableAgent(workspaceID string) (store.AgentRecord, bool) {
	var best store.AgentRecord
	found := false
	for _, rec := range s.workspaceAttentionCandidates(workspaceID) {
		if !s.canMarkUnread(rec) {
			continue
		}
		if !found || lastActivityOf(rec) > lastActivityOf(best) {
			best = rec
			found = true
		}
	}
	return best, found
}

// isDuplicateAttentionTimestamp guards against re-marking on a replayed event.
func isDuplicateAttentionTimestamp(existing *string, next string) bool {
	return existing != nil && strings.TrimSpace(*existing) == next
}

// attentionIsFocused reports whether a present client is currently looking at this agent.
//
// Wired to the attention package's presence policy. With no presence information the answer is
// false, which keeps the badge behaving as it did before presence tracking existed.
func (s *Server) attentionIsFocused(agentID string) bool {
	s.mu.Lock()
	states := s.clientPresence
	s.mu.Unlock()
	if len(states) == 0 {
		return false
	}
	plan := attention.ComputePlan(states, &attention.FocusTarget{Kind: "agent", ID: agentID}, true, time.Now())
	return plan.InAppRecipient == -1 && !plan.ShouldPush
}
