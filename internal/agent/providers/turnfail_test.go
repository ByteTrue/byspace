package providers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// A failed model call is a failed turn, not one that said nothing. The daemon turns
// `byspace_turn_failed` into a turn_failed event, an error status and a [System Error] row; a
// provider that settles the turn as completed leaves the user with an empty conversation.

func TestClaudeResultFailure(t *testing.T) {
	cases := []struct {
		name   string
		ev     map[string]any
		failed bool
		want   string
	}{
		{"success", map[string]any{"subtype": "success", "result": "done"}, false, ""},
		{"is_error with text", map[string]any{"is_error": true, "result": "API Error: 429 quota"}, true, "API Error: 429 quota"},
		{"error subtype", map[string]any{"subtype": "error_during_execution"}, true, "error_during_execution"},
		{"is_error without text", map[string]any{"is_error": true}, true, "the model call failed"},
	}
	for _, c := range cases {
		message, failed := claudeResultFailure(c.ev)
		if failed != c.failed || message != c.want {
			t.Fatalf("%s: got (%q, %v), want (%q, %v)", c.name, message, failed, c.want, c.failed)
		}
	}
}

func TestClaudeFailedResultEmitsTurnFailed(t *testing.T) {
	session := &ClaudeSession{
		status:             "running",
		activeTurnID:       "turn_1",
		toolIndexByID:      map[string]int{},
		toolArgsByID:       map[string]any{},
		pendingPermissions: map[string]map[string]any{},
		subagents:          map[string]sdk.SubagentDescriptor{},
		eventSubscribers:   map[int]func(map[string]any){},
	}
	var events []map[string]any
	session.eventSubscribers[1] = func(ev map[string]any) { events = append(events, ev) }

	session.handleRawEvent(map[string]any{
		"type":     "result",
		"is_error": true,
		"result":   "API Error: 429 {\"type\":\"rate_limit_error\"}",
	})

	if !sawEvent(events, "byspace_turn_failed") {
		t.Fatalf("events = %v", events)
	}
	if sawEvent(events, "agent_end") {
		t.Fatal("a failed turn must not report a completion")
	}
	if got := session.LastError(); !strings.Contains(got, "429") {
		t.Fatalf("LastError = %q", got)
	}
	if session.Status() != "idle" {
		t.Fatalf("status = %q, want the turn settled", session.Status())
	}
}

func TestCodexTurnFailure(t *testing.T) {
	cases := []struct {
		name   string
		params map[string]any
		want   string
	}{
		{"completed", map[string]any{"turn": map[string]any{"status": "completed"}}, ""},
		{"failed with message", map[string]any{"turn": map[string]any{"status": "failed", "error": map[string]any{"message": "stream disconnected"}}}, "stream disconnected"},
		{"failed without message", map[string]any{"turn": map[string]any{"status": "failed"}}, "the turn failed"},
		{"top-level error", map[string]any{"error": map[string]any{"message": "unauthorized"}}, "unauthorized"},
	}
	for _, c := range cases {
		if got := codexTurnFailure(c.params); got != c.want {
			t.Fatalf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestCodexFailedTurnEmitsTurnFailed(t *testing.T) {
	session := &CodexSession{
		pending:          map[int64]chan map[string]any{},
		status:           "running",
		activeTurnID:     "turn_1",
		eventSubscribers: map[int]func(map[string]any){},
	}
	session.frames = sdk.NewStreamFrames(session.flushFramesOnTimer)
	var events []map[string]any
	session.eventSubscribers[1] = func(ev map[string]any) { events = append(events, ev) }

	session.handleNotificationOrRequest("turn/completed", nil, map[string]any{
		"params": map[string]any{"turn": map[string]any{
			"status": "failed",
			"error":  map[string]any{"message": "stream disconnected before completion"},
		}},
	})

	if !sawEvent(events, "byspace_turn_failed") {
		t.Fatalf("events = %v", events)
	}
	if sawEvent(events, "agent_end") {
		t.Fatal("a failed turn must not report a completion")
	}
	if got := session.LastError(); !strings.Contains(got, "stream disconnected") {
		t.Fatalf("LastError = %q", got)
	}
}

func TestACPFailedPromptEmitsTurnFailed(t *testing.T) {
	session := &ACPSession{
		status:           "running",
		activeTurnID:     "turn_1",
		eventSubscribers: map[int]func(map[string]any){},
	}
	session.frames = sdk.NewStreamFrames(session.flushFramesOnTimer)
	var events []map[string]any
	session.eventSubscribers[1] = func(ev map[string]any) { events = append(events, ev) }

	session.finishPrompt(errors.New("agent refused the prompt: 429"))

	if !sawEvent(events, "byspace_turn_failed") {
		t.Fatalf("events = %v", events)
	}
	if got := session.LastError(); !strings.Contains(got, "429") {
		t.Fatalf("LastError = %q", got)
	}
}

// OpenCode reports a model failure as an HTTP error. It used to be decoded as an empty reply and
// settled as a completed turn.
func TestOpenCodeHTTPErrorEmitsTurnFailed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Free usage limit reached"}}`))
	}))
	defer server.Close()

	session := &OpenCodeSession{
		baseURL:          server.URL,
		sessionID:        "s1",
		httpClient:       server.Client(),
		eventSubscribers: map[int]func(map[string]any){},
	}
	events := make(chan map[string]any, 8)
	session.eventSubscribers[1] = func(ev map[string]any) { events <- ev }

	if err := session.Prompt(context.Background(), "hi", nil); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-events:
			if ev["type"] == "byspace_turn_failed" {
				if got, _ := ev["error"].(string); !strings.Contains(got, "Free usage limit") {
					t.Fatalf("error = %q", got)
				}
				if got := session.LastError(); !strings.Contains(got, "429") {
					t.Fatalf("LastError = %q", got)
				}
				return
			}
			if ev["type"] == "agent_end" {
				t.Fatal("a failed turn must not report a completion")
			}
		case <-deadline:
			t.Fatal("no turn_failed event")
		}
	}
}

func sawEvent(events []map[string]any, want string) bool {
	for _, ev := range events {
		if ev["type"] == want {
			return true
		}
	}
	return false
}
