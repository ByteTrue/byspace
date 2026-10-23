package server

import (
	"encoding/json"
	"testing"
)

// The read loop dispatches session messages concurrently, the way Node does. A message that
// registers socket-scoped state must stay inline: an upload's metadata has to be registered
// before the binary chunk that follows it on the same socket, and a subscription before the
// events it asks for. Loosening this list silently corrupts uploads.
func TestSessionMessageNeedsOrderCoversStateRegistrations(t *testing.T) {
	ordered := []string{
		"file.upload.request",
		"create_terminal_request",
		"subscribe_terminal_request",
		"subscribe_terminals_request",
		"fs.file.subscribe.request",
		"subscribe_checkout_diff_request",
		"session.events.set_subscription.request",
		"agent.timeline.set_subscription.request",
	}
	for _, msgType := range ordered {
		raw, _ := json.Marshal(map[string]any{"type": msgType, "requestId": "r1"})
		if !sessionMessageNeedsOrder(raw) {
			t.Errorf("%s must run inline, or the frame after it races its registration", msgType)
		}
	}

	for _, msgType := range []string{"send_agent_message_request", "get_providers_snapshot_request", "ping"} {
		raw, _ := json.Marshal(map[string]any{"type": msgType})
		if sessionMessageNeedsOrder(raw) {
			t.Errorf("%s holds no socket state and must not block the read loop", msgType)
		}
	}
}
