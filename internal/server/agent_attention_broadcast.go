package server

import (
	"context"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/attention"
	"github.com/ByteTrue/byspace/internal/store"
)

// recordClientPresence keeps what a client_heartbeat says about its sender.
func (s *Server) recordClientPresence(sink frameSink, appVisible bool, focusedAgentID, focusedTerminalID *string, lastActivityAt string) {
	presence := attention.ClientPresence{AppVisible: appVisible}
	if focusedAgentID != nil {
		presence.FocusedAgentID = strings.TrimSpace(*focusedAgentID)
	}
	if focusedTerminalID != nil {
		presence.FocusedTerminalID = strings.TrimSpace(*focusedTerminalID)
	}
	if at, err := time.Parse(time.RFC3339Nano, lastActivityAt); err == nil {
		presence.LastActivityAt = &at
	}
	s.mu.Lock()
	if _, connected := s.clients[sink]; connected {
		if s.clientPresence == nil {
			s.clientPresence = make(map[frameSink]attention.ClientPresence)
		}
		s.clientPresence[sink] = presence
	}
	s.mu.Unlock()
}

// presenceSnapshot lists the handshaked clients with what each last reported; a client that has
// not sent a heartbeat yet counts as absent.
func (s *Server) presenceSnapshot() ([]frameSink, []attention.ClientPresence) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sinks := make([]frameSink, 0, len(s.clients))
	states := make([]attention.ClientPresence, 0, len(s.clients))
	for sink, handshaked := range s.clients {
		if !handshaked {
			continue
		}
		sinks = append(sinks, sink)
		states = append(states, s.clientPresence[sink])
	}
	return sinks, states
}

// broadcastAgentAttention tells every client an agent wants the user, and the presence policy
// picks who notifies: the one most recently active client shows the in-app (OS) notification,
// nobody does while a visible client is looking at the agent, and with nobody present it is a
// push. Port of websocket-server.ts broadcastAgentAttention; without it no client ever got a
// shouldNotify, so the apps never notified.
func (s *Server) broadcastAgentAttention(rec store.AgentRecord, reason, timestamp string) {
	sinks, states := s.presenceSnapshot()
	plan := attention.ComputePlan(states, &attention.FocusTarget{Kind: "agent", ID: rec.ID},
		attention.IsPushEligibleReason(reason), time.Now())
	if plan.ShouldPush {
		s.notifyAttention(rec.ID, reason, pushTitleFor(reason), pushBodyFor(rec))
	}
	if rec.WorkspaceID == "" {
		return
	}
	notification := map[string]any{
		"title": pushTitleFor(reason),
		"body":  pushBodyFor(rec),
		"data": map[string]any{
			"serverId":    s.serverID,
			"workspaceId": rec.WorkspaceID,
			"agentId":     rec.ID,
			"reason":      reason,
		},
	}
	ctx := context.Background()
	for i, sink := range sinks {
		shouldNotify := i == plan.InAppRecipient
		s.mu.Lock()
		selective := s.selectiveTimeline[sink]
		s.mu.Unlock()
		if selective {
			_ = sendSessionMsg(ctx, sink, "agent_attention_required", map[string]any{
				"agentId":      rec.ID,
				"reason":       reason,
				"timestamp":    timestamp,
				"shouldNotify": shouldNotify,
				"notification": notification,
			})
			continue
		}
		_ = sendSessionMsg(ctx, sink, "agent_stream", map[string]any{
			"agentId": rec.ID,
			"event": map[string]any{
				"type":         "attention_required",
				"provider":     rec.Provider,
				"reason":       reason,
				"timestamp":    timestamp,
				"shouldNotify": shouldNotify,
				"notification": notification,
			},
			"timestamp": timestamp,
		})
	}
}
