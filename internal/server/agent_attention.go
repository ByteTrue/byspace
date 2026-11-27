package server

import (
	"path/filepath"
	"strings"
	"time"

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

// markAgentAttention flags an agent as needing the user's attention and notifies the user.
//
// The caller holds no lock: this takes s.mu itself.
func (s *Server) markAgentAttention(agentID, reason, timestamp string) bool {
	return s.setAgentAttention(agentID, reason, timestamp, true)
}

// markAgentUnread is the user's "Mark as unread": the finished flag without a notification.
// Node's markAgentUnread never broadcasts attention; only a real turn ending does.
func (s *Server) markAgentUnread(agentID string) bool {
	return s.setAgentAttention(agentID, AttentionReasonFinished, "", false)
}

func (s *Server) setAgentAttention(agentID, reason, timestamp string, notify bool) bool {
	s.mu.Lock()
	mp, live := s.agents[agentID]
	var rec store.AgentRecord
	if live && mp != nil {
		rec = mp.record
	} else {
		stored, err := s.store.GetAgent(agentID)
		if err != nil || stored == nil || stored.ArchivedAt != nil {
			s.mu.Unlock()
			return false
		}
		live = false
		rec = *stored
		if reason == AttentionReasonFinished && rec.LastStatus != "idle" && rec.LastStatus != "closed" {
			s.mu.Unlock()
			return false
		}
	}
	if rec.RequiresAttention {
		existingPermission := rec.AttentionReason != nil && *rec.AttentionReason == AttentionReasonPermission
		if existingPermission || reason != AttentionReasonPermission {
			if live && existingPermission {
				_ = s.store.UpsertAgent(rec)
			}
			s.mu.Unlock()
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
	if live {
		mp.record = rec
	} else {
		rec.UpdatedAt = ts
	}
	_ = s.store.UpsertAgent(rec)
	s.mu.Unlock()

	s.broadcastAgentUpdate(rec)
	if notify && live {
		s.broadcastAgentAttention(rec, reason, ts)
	}
	return true
}

// clearAgentAttention removes the flag and reports whether anything changed.
func (s *Server) clearAgentAttention(agentID string) bool {
	s.mu.Lock()
	mp, live := s.agents[agentID]
	var rec store.AgentRecord
	if live && mp != nil && mp.record.RequiresAttention {
		mp.record.RequiresAttention = false
		mp.record.AttentionReason = nil
		mp.record.AttentionTimestamp = nil
		rec = mp.record
	} else {
		stored, err := s.store.GetAgent(agentID)
		if err != nil || stored == nil || !stored.RequiresAttention {
			s.mu.Unlock()
			return false
		}
		rec = *stored
		rec.RequiresAttention = false
		rec.AttentionReason = nil
		rec.AttentionTimestamp = nil
	}
	_ = s.store.UpsertAgent(rec)
	s.mu.Unlock()
	s.broadcastAgentUpdate(rec)
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
// A workspace can hold several agents; Node (handleWorkspaceMarkUnreadRequest) marks one: the
// most recently updated finished conversation root, ties broken by id. A subagent is never the
// one marked — its finished turn is not the workspace's.
func (s *Server) firstMarkableAgent(workspaceID string) (store.AgentRecord, bool) {
	agents, err := s.store.ListAgents()
	if err != nil {
		return store.AgentRecord{}, false
	}
	byID := make(map[string]store.AgentRecord, len(agents))
	for _, rec := range agents {
		byID[rec.ID] = rec
	}
	var best store.AgentRecord
	found := false
	for _, rec := range agents {
		if rec.WorkspaceID != workspaceID || rec.ArchivedAt != nil {
			continue
		}
		if root := resolveWorkspaceRootAgent(rec, byID); root == nil || root.ID != rec.ID {
			continue
		}
		if !s.canMarkUnread(rec) {
			continue
		}
		if !found || rec.UpdatedAt > best.UpdatedAt || (rec.UpdatedAt == best.UpdatedAt && rec.ID < best.ID) {
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

// pushTitleFor / pushBodyFor build the notification text.
//
// The title says what happened, the body says which conversation: a bare "Task finished" leaves
// the user to guess which of several agents wants them.
func pushTitleFor(reason string) string {
	switch reason {
	case AttentionReasonPermission:
		return "Agent needs your input"
	case AttentionReasonError:
		return "Agent failed"
	default:
		return "Agent finished"
	}
}

func pushBodyFor(rec store.AgentRecord) string {
	if rec.Title != nil && strings.TrimSpace(*rec.Title) != "" {
		return *rec.Title
	}
	if rec.LastUserMessageAt != nil && *rec.LastUserMessageAt != "" {
		return "in " + filepath.Base(rec.Cwd)
	}
	return filepath.Base(rec.Cwd)
}
