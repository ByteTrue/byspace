package server

import (
	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/store"
)

// The row a submitted prompt leaves in the timeline before the provider echoes it.
//
// Ported from agent-manager.ts `recordSubmittedPrompt`. Node's timeline store owns the row from the
// moment the prompt is accepted: a client that just sent a message can fetch the timeline and see
// it, rewind can find it, and the provider's later echo is reconciled onto that row instead of
// adding a second one. This daemon had no such row — it appeared only once the provider echoed,
// which for a provider that deliberately delays the echo (the mock's `Delay synthetic user message
// by` directive) leaves the transcript without the message the user just sent. Two things broke on
// that: a timeline fetch taken right after submitting had no `user_message` row at all, and rewind
// had no way to tell "the provider has not acknowledged this yet" from "no such message".
//
// The row carries the client's message id in both messageId and clientMessageId, exactly like Node:
// the client matches echoes on clientMessageId, and the rewind trigger needs a messageId to target.
const submittedPromptRowType = "user_message"

// submittedPromptSeqs records, per agent, the seq of the row this daemon wrote for each submitted
// prompt. It is what separates the daemon's row from the provider's echo: both carry the same
// clientMessageId, and only the seq tells them apart, because some providers reuse the client id as
// their own message id (pi does) and the ids alone cannot distinguish the two rows.
func (s *Server) recordSubmittedPromptSeq(agentID, clientMessageID string, seq int) {
	s.submittedPromptMu.Lock()
	if s.submittedPromptSeqs == nil {
		s.submittedPromptSeqs = make(map[string]map[string]int)
	}
	byClient := s.submittedPromptSeqs[agentID]
	if byClient == nil {
		byClient = make(map[string]int)
		s.submittedPromptSeqs[agentID] = byClient
	}
	byClient[clientMessageID] = seq
	s.submittedPromptMu.Unlock()
}

// submittedPromptSeq returns the seq of the row this daemon wrote for a submitted prompt, or 0 when
// the prompt was never recorded here (a restored agent, or a prompt from before a restart).
func (s *Server) submittedPromptSeq(agentID, clientMessageID string) int {
	s.submittedPromptMu.Lock()
	defer s.submittedPromptMu.Unlock()
	return s.submittedPromptSeqs[agentID][clientMessageID]
}

// storeSubmittedPromptRow writes the row for a submitted prompt and returns it along with its seq.
//
// A prompt that already has a row is left alone: a retry of the same message would otherwise stack
// identical rows, and an accepted prompt is written exactly once.
func storeSubmittedPromptRow(session providers.ManagedSession, clientMessageID, text string) (sdk.TimelineEntry, bool) {
	if session == nil || clientMessageID == "" {
		return sdk.TimelineEntry{}, false
	}
	for _, entry := range session.Timeline() {
		item := entry.Item
		if item.Type == submittedPromptRowType && item.ClientMessageID == clientMessageID {
			return sdk.TimelineEntry{}, false
		}
	}
	entry := session.AppendTimelineItem(sdk.TimelineItem{
		Type:            submittedPromptRowType,
		Text:            text,
		MessageID:       clientMessageID,
		ClientMessageID: clientMessageID,
	})
	return entry, true
}

// submittedPromptAcknowledged reports whether the provider has echoed a submitted prompt back.
//
// The echo is a second user_message row for the same clientMessageId. Its message id cannot be used
// to tell it apart — pi reuses the client id as the provider id — so the two rows are separated by
// the seq this daemon recorded when it wrote its own. Without a recorded seq the prompt was not
// submitted through this process, and a row that exists is whatever the provider reported.
func (s *Server) submittedPromptAcknowledged(session providers.ManagedSession, agentID, clientMessageID string) bool {
	if session == nil || clientMessageID == "" {
		return false
	}
	ownSeq := s.submittedPromptSeq(agentID, clientMessageID)
	for _, entry := range session.Timeline() {
		item := entry.Item
		if item.Type != submittedPromptRowType || item.ClientMessageID != clientMessageID {
			continue
		}
		if ownSeq == 0 || entry.Seq != ownSeq {
			return true
		}
	}
	return false
}

// isUnacknowledgedSubmittedPrompt reports whether messageID names a row this daemon wrote for a
// prompt the provider has not echoed yet. Rewind answers differently in that case: the message is
// in the transcript and its files are on disk, but the provider has no checkpoint for a turn it
// never started, so rewinding would report a failure the user cannot act on.
func (s *Server) isUnacknowledgedSubmittedPrompt(session providers.ManagedSession, agentID, messageID string) bool {
	if session == nil || messageID == "" {
		return false
	}
	if s.submittedPromptSeq(agentID, messageID) == 0 {
		return false
	}
	return !s.submittedPromptAcknowledged(session, agentID, messageID)
}

// appendSubmittedPromptRow records the submitted prompt and streams it to the clients.
//
// Broadcast rather than rely on the fetch that follows: a client that is already attached never
// refetches, and the sequence number the row got is what orders it against the provider's echo.
// Must not hold s.mu — it broadcasts.
func (s *Server) appendSubmittedPromptRow(rec store.AgentRecord, session providers.ManagedSession, clientMessageID, text string) {
	entry, stored := storeSubmittedPromptRow(session, clientMessageID, text)
	if !stored {
		return
	}
	s.recordSubmittedPromptSeq(rec.ID, clientMessageID, entry.Seq)
	s.broadcastSessionMsg("agent_stream", map[string]any{
		"agentId":   rec.ID,
		"provider":  rec.Provider,
		"timestamp": entry.Timestamp,
		"seq":       entry.Seq,
		"epoch":     s.epoch,
		"event": map[string]any{
			"type":     "timeline",
			"provider": rec.Provider,
			"item":     entry.Item,
		},
	})
}

// dedupeSubmittedPrompts keeps one row per submitted prompt.
//
// Node reconciles the provider's echo onto the row it recorded at submit time, so its timeline holds
// one row per prompt. Here the daemon writes a row and the provider appends its own when it echoes,
// so the older one is dropped on the way out. The newer row wins because it is the one the provider
// acknowledged: rewind targets its message id, and its turn id places it in the turn it belongs to.
func dedupeSubmittedPrompts(rows []pi.TimelineEntry) []pi.TimelineEntry {
	lastIndex := make(map[string]int, len(rows))
	for index, row := range rows {
		if row.Item.Type == submittedPromptRowType && row.Item.ClientMessageID != "" {
			lastIndex[row.Item.ClientMessageID] = index
		}
	}
	if len(lastIndex) == 0 {
		return rows
	}
	out := make([]pi.TimelineEntry, 0, len(rows))
	for index, row := range rows {
		if row.Item.Type == submittedPromptRowType && row.Item.ClientMessageID != "" {
			if lastIndex[row.Item.ClientMessageID] != index {
				continue
			}
		}
		out = append(out, row)
	}
	return out
}
