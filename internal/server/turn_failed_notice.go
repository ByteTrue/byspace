package server

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/store"
)

// The system-error row a failed turn leaves in the timeline.
//
// Ported from agent-manager.ts. A turn that fails broadcasts `turn_failed`, which moves the client
// out of its running state — but that is a state change, not something the reader can see in the
// transcript. Node answers by appending an assistant_message whose text is prefixed with
// `[System Error]`, so the failure reads as a row in the conversation and survives a reload. This is
// daemon behaviour, not a provider's: every provider's failures get the same row, and a provider
// that only reports the failure as an event leaves nothing behind without it.
const systemErrorPrefix = "[System Error]"

// formatTurnFailedMessage renders a turn_failed event the way the row and the client's error surface
// both expect: the error text, then `code: <code>`, then the diagnostic when it adds anything.
//
// Empty parts are dropped rather than emitted as blank lines, and an event with no error at all still
// says something — a row that reads "[System Error]" alone tells the reader less than nothing.
func formatTurnFailedMessage(ev map[string]any) string {
	base := strings.TrimSpace(eventString(ev, "error"))
	parts := make([]string, 0, 3)
	if base != "" {
		parts = append(parts, base)
	} else {
		parts = append(parts, "Provider run failed")
	}
	if code := strings.TrimSpace(eventString(ev, "code")); code != "" {
		parts = append(parts, "code: "+code)
	}
	// A diagnostic that merely repeats the error adds a paragraph saying the same thing twice.
	if diagnostic := strings.TrimSpace(eventString(ev, "diagnostic")); diagnostic != "" && diagnostic != base {
		parts = append(parts, diagnostic)
	}
	return strings.Join(parts, "\n\n")
}

// systemErrorRowText is the row's text, or "" when the event carries nothing worth recording.
func systemErrorRowText(ev map[string]any) string {
	normalized := strings.TrimSpace(formatTurnFailedMessage(ev))
	if normalized == "" {
		return ""
	}
	return systemErrorPrefix + " " + normalized
}

// storeSystemErrorRow puts the row in the session's timeline, reporting whether it was stored.
//
// A repeat is skipped: a turn can fail more than once for the same reason (a provider that dies and
// is restarted, a retried run), and stacking identical rows turns one failure into a wall of them.
// Only an immediately preceding identical row counts, so a failure after real output is still shown.
func storeSystemErrorRow(session providers.ManagedSession, text string) (sdk.TimelineEntry, bool) {
	if text == "" || session == nil {
		return sdk.TimelineEntry{}, false
	}
	if entries := session.Timeline(); len(entries) > 0 {
		last := entries[len(entries)-1].Item
		if last.Type == "assistant_message" && last.Text == text {
			return sdk.TimelineEntry{}, false
		}
	}
	// No message id: this row belongs to no provider message, and the protocol's assistant_message
	// branch treats it as optional. No turn id either — the turn is already over.
	return session.AppendTimelineItem(sdk.TimelineItem{Type: "assistant_message", Text: text}), true
}

// appendSystemErrorRow records the failed turn in the transcript and broadcasts it.
//
// Call it after the turn_failed event goes out, not before: the client applies the state change and
// the row separately, and a row that arrives first would be rendered under a turn the client still
// believes is running. Must not hold s.mu — it broadcasts.
func (s *Server) appendSystemErrorRow(rec store.AgentRecord, session providers.ManagedSession, ev map[string]any) {
	entry, stored := storeSystemErrorRow(session, systemErrorRowText(ev))
	if !stored {
		return
	}
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

func eventString(ev map[string]any, key string) string {
	value, _ := ev[key].(string)
	return value
}
