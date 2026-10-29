// Package agentnotices holds the warnings a provider sends when a setting cannot take effect now.
//
// Ported from provider-notices.ts. The protocol has a `notice` field on the mode and thinking
// responses specifically for this: without it, changing a mode mid-turn looks like it did nothing,
// and the user changes it again.
package agentnotices

// Notice is one message shown next to the setting that produced it.
type Notice struct {
	// Type is info, warning or error, matching AgentProviderNoticeSchema.
	Type string
	// Message is shown verbatim.
	Message string
}

// ModeAppliesNextTurn is sent when a mode change takes effect only from the next turn.
//
// Claude and Codex both keep the running turn on its original mode; the setting is stored and used
// when the current turn ends.
var ModeAppliesNextTurn = Notice{Type: "warning", Message: "Permission mode applies next turn"}

// ThinkingAppliesNextTurn is the same for the thinking level.
var ThinkingAppliesNextTurn = Notice{Type: "warning", Message: "Thinking level applies next turn"}

// ToPayload renders a notice for the wire, or nil when there is none.
//
// Nil rather than an empty object: `notice` is nullable and optional in the schema, and an empty
// object fails the discriminated union that validates it.
func ToPayload(notice *Notice) any {
	if notice == nil || notice.Message == "" {
		return nil
	}
	return map[string]any{"type": notice.Type, "message": notice.Message}
}
