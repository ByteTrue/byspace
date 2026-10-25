package server

import (
	"context"
	"encoding/json"
	"testing"
)

// sessionTypes pulls the `message.type` out of every frame the sink recorded.
func sessionTypes(sink *recordingSink) []string {
	sink.mu.Lock()
	defer sink.mu.Unlock()
	out := make([]string, 0, len(sink.texts))
	for _, raw := range sink.texts {
		var envelope struct {
			Type    string `json:"type"`
			Message struct {
				Type string `json:"type"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(raw), &envelope) == nil && envelope.Type == "session" {
			out = append(out, envelope.Message.Type)
		}
	}
	return out
}

func (r *recordingSink) reset() {
	r.mu.Lock()
	r.texts = nil
	r.mu.Unlock()
}

func newTimelineTestServer() *Server {
	return &Server{
		clients:           make(map[frameSink]bool),
		timelineViews:     make(map[frameSink]map[string]bool),
		selectiveTimeline: make(map[frameSink]bool),
	}
}

func helloFrame(t *testing.T, caps string) []byte {
	t.Helper()
	envelope := map[string]any{
		"type":            "hello",
		"clientId":        "c1",
		"protocolVersion": WSProtocolVersion,
	}
	if caps != "" {
		envelope["capabilities"] = json.RawMessage(caps)
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("marshal hello: %v", err)
	}
	return raw
}

func subscribeFrame(t *testing.T, requestID string, agentIDs []string) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type":      "agent.timeline.set_subscription.request",
			"requestId": requestID,
			"agentIds":  agentIDs,
		},
	})
	if err != nil {
		t.Fatalf("marshal subscription: %v", err)
	}
	return raw
}

// A client that declares selective_agent_timeline receives agent_stream only for the agents it
// subscribed to. Node's forwardAgentStream scopes per source the same way, and the capability is
// what keeps the filtering legal: a client that never declared it keeps getting every stream.
func TestAgentStreamIsScopedToViewedAgents(t *testing.T) {
	srv := newTimelineTestServer()
	ctx := context.Background()

	selective := &recordingSink{}
	legacy := &recordingSink{}
	srv.handleTextFrame(ctx, selective, helloFrame(t, `{"selective_agent_timeline":true}`))
	srv.handleTextFrame(ctx, legacy, helloFrame(t, ""))
	srv.handleTextFrame(ctx, selective, subscribeFrame(t, "r1", []string{"agent_viewed"}))

	selective.reset()
	legacy.reset()
	srv.broadcastSessionMsg("agent_stream", map[string]any{"agentId": "agent_hidden", "event": "x"})
	srv.broadcastSessionMsg("agent_stream", map[string]any{"agentId": "agent_viewed", "event": "y"})

	if got := sessionTypes(selective); len(got) != 1 {
		t.Fatalf("selective client got %v, want exactly the viewed agent's stream", got)
	}
	if got := sessionTypes(legacy); len(got) != 2 {
		t.Fatalf("legacy client got %v, want both streams", got)
	}

	// Non-stream messages are not scoped: agent_update carries the sidebar roster, including
	// agents the client is not viewing.
	selective.reset()
	srv.broadcastSessionMsg("agent_update", map[string]any{"agentId": "agent_hidden"})
	if got := sessionTypes(selective); len(got) != 1 || got[0] != "agent_update" {
		t.Fatalf("selective client got %v, want the agent_update through", got)
	}

	// An empty subscription clears the view rather than leaving the old set applied.
	srv.handleTextFrame(ctx, selective, subscribeFrame(t, "r2", []string{}))
	selective.reset()
	srv.broadcastSessionMsg("agent_stream", map[string]any{"agentId": "agent_viewed", "event": "y"})
	if got := sessionTypes(selective); len(got) != 0 {
		t.Fatalf("after clearing the subscription the client got %v, want nothing", got)
	}
}

func TestHelloDeclaresSelectiveTimeline(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{"absent", "", false},
		{"empty object", "{}", false},
		{"declared true", `{"selective_agent_timeline":true}`, true},
		{"declared false", `{"selective_agent_timeline":false}`, false},
		{"other caps only", `{"voice":true}`, false},
	}
	for _, tc := range cases {
		if got := helloDeclaresSelectiveTimeline(json.RawMessage(tc.raw)); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}
