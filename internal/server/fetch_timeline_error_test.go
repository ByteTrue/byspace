package server

import (
	"context"
	"encoding/json"
	"testing"
)

// An agent that cannot be loaded still gets a complete fetch_agent_timeline_response, in Node's
// shape. The client validates every required field: a partial payload was rejected as invalid and
// the request retried forever instead of showing the error.
func TestFetchAgentTimelineErrorIsCompleteResponse(t *testing.T) {
	srv := attentionServer(t)
	sink := &recordingSink{}
	raw, _ := json.Marshal(map[string]any{"requestId": "r1", "agentId": "missing", "mergeWindow": true})
	srv.handleFetchAgentTimeline(context.Background(), sink, raw)
	if sink.count() != 1 {
		t.Fatalf("expected one response, got %d", sink.count())
	}
	var frame struct {
		Message struct {
			Type    string         `json:"type"`
			Payload map[string]any `json:"payload"`
		} `json:"message"`
	}
	if err := json.Unmarshal([]byte(sink.texts[0]), &frame); err != nil {
		t.Fatal(err)
	}
	payload := frame.Message.Payload
	for _, key := range []string{
		"requestId", "agentId", "agent", "direction", "projection", "epoch", "reset", "staleCursor",
		"gap", "window", "startCursor", "endCursor", "hasOlder", "hasNewer", "entries", "error",
	} {
		if _, ok := payload[key]; !ok {
			t.Errorf("response is missing %q: %v", key, payload)
		}
	}
	if payload["agent"] != nil || payload["epoch"] != "" || payload["hasOlder"] != false {
		t.Errorf("an unloadable agent reports no snapshot, no epoch, no history: %v", payload)
	}
	window, _ := payload["window"].(map[string]any)
	if window["minSeq"] != float64(0) || window["maxSeq"] != float64(0) || window["nextSeq"] != float64(0) {
		t.Errorf("window = %v", window)
	}
	if msg, _ := payload["error"].(string); msg == "" {
		t.Errorf("the error must say why: %v", payload["error"])
	}
	if payload["mergeWindow"] != true {
		t.Errorf("mergeWindow echoes the request: %v", payload["mergeWindow"])
	}
}
