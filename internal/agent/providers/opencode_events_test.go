package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func newOpenCodeEventFixture() *OpenCodeSession {
	return &OpenCodeSession{
		sessionID: "session-1", activeTurnID: "turn-1", status: "running",
		partTypes: map[string]string{}, messageRoles: map[string]string{},
		materializedText: map[string]string{}, closedParts: map[string]bool{},
		toolIndexByID: map[string]int{}, pendingPermissions: map[string]map[string]any{},
		eventSubscribers: map[int]func(map[string]any){}, eventTimelineIndex: -1,
	}
}

func openCodeTestEvent(typeName string, properties map[string]any) map[string]any {
	return map[string]any{"directory": "/tmp/test", "payload": map[string]any{"type": typeName, "properties": properties}}
}

func TestOpenCodeEventsDeduplicateTextAndReasoning(t *testing.T) {
	s := newOpenCodeEventFixture()
	s.handleOpenCodeEvent(openCodeTestEvent("message.updated", map[string]any{"info": map[string]any{"id": "msg-1", "sessionID": "session-1", "role": "assistant"}}))
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.delta", map[string]any{"sessionID": "session-1", "messageID": "msg-1", "partID": "text-1", "field": "text", "delta": "hello"}))
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.delta", map[string]any{"sessionID": "session-1", "messageID": "msg-1", "partID": "text-1", "field": "text", "delta": " world"}))
	final := map[string]any{"part": map[string]any{"id": "text-1", "sessionID": "session-1", "messageID": "msg-1", "type": "text", "text": "hello world!", "time": map[string]any{"end": 2}}}
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.updated", final))
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.updated", final))
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.updated", map[string]any{"part": map[string]any{"id": "reason-1", "sessionID": "session-1", "messageID": "msg-1", "type": "reasoning", "time": map[string]any{"start": 1}}}))
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.delta", map[string]any{"sessionID": "session-1", "messageID": "msg-1", "partID": "reason-1", "field": "text", "delta": "thinking"}))
	timeline := s.Timeline()
	if len(timeline) != 2 || timeline[0].Item.Text != "hello world!" || timeline[0].Item.MessageID != "msg-1" || timeline[1].Item.Type != "reasoning" || timeline[1].Item.Text != "thinking" {
		t.Fatalf("timeline = %#v", timeline)
	}
}

func TestOpenCodeEventsIgnoreUserAndCompleteOnIdle(t *testing.T) {
	s := newOpenCodeEventFixture()
	s.messageRoles["user-1"] = "user"
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.delta", map[string]any{"sessionID": "session-1", "messageID": "user-1", "partID": "p1", "delta": "echo"}))
	if len(s.Timeline()) != 0 {
		t.Fatal("user delta was rendered")
	}
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.delta", map[string]any{"sessionID": "other", "messageID": "msg", "partID": "p2", "delta": "wrong"}))
	if len(s.Timeline()) != 0 {
		t.Fatal("foreign session delta was rendered")
	}
	s.handleOpenCodeEvent(openCodeTestEvent("session.idle", map[string]any{"sessionID": "session-1"}))
	if s.Status() != "idle" {
		t.Fatalf("status = %q", s.Status())
	}
	if err := s.WaitForFinish(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestOpenCodeStreamWatchdogDoesNotSettleTurn(t *testing.T) {
	reader, writer := io.Pipe()
	defer writer.Close()
	s := newOpenCodeEventFixture()
	_, err := readOpenCodeStream(context.Background(), reader, 5*time.Millisecond, 5*time.Millisecond, s.handleOpenCodeEvent)
	if err == nil || s.Status() != "running" {
		t.Fatalf("err=%v status=%q", err, s.Status())
	}
}

func TestOpenCodeNativeArchive(t *testing.T) {
	for _, version := range []int{1, 2} {
		t.Run(fmt.Sprintf("v%d", version), func(t *testing.T) {
			var paths []string
			var bodies []map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				paths = append(paths, r.URL.Path)
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				bodies = append(bodies, body)
				_, _ = w.Write([]byte(`{}`))
			}))
			defer server.Close()
			s := newOpenCodeEventFixture()
			s.baseURL, s.httpClient, s.version = server.URL, server.Client(), version
			if err := s.ArchiveNative(context.Background(), true); err != nil {
				t.Fatal(err)
			}
			if err := s.ArchiveNative(context.Background(), false); err != nil {
				t.Fatal(err)
			}
			if len(paths) != 2 {
				t.Fatalf("paths=%v", paths)
			}
			if version == 1 {
				firstTime, _ := bodies[0]["time"].(map[string]any)
				secondTime, _ := bodies[1]["time"].(map[string]any)
				if firstTime["archived"] == float64(0) || secondTime["archived"] != float64(0) {
					t.Fatalf("bodies=%v", bodies)
				}
			} else if bodies[0]["archived"] != true || bodies[1]["archived"] != false || bodies[0]["time"] != nil {
				t.Fatalf("bodies=%v", bodies)
			}
			prefix := "/session/session-1"
			if version == 2 {
				prefix = "/api/session/session-1"
			}
			if paths[0] != prefix {
				t.Fatalf("path=%q", paths[0])
			}
		})
	}
}

func TestOpenCodeQuestionRoundTrip(t *testing.T) {
	var path string
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient = server.URL, server.Client()
	s.handleOpenCodeEvent(openCodeTestEvent("question.asked", map[string]any{"id": "q-1", "sessionID": "session-1", "questions": []any{map[string]any{"header": "Choice", "question": "Pick", "multiple": true, "options": []any{map[string]any{"label": "A"}}}}}))
	if s.pendingPermissions["q-1"]["kind"] != "question" {
		t.Fatalf("request = %#v", s.pendingPermissions["q-1"])
	}
	if err := s.respondToOpenCodePermission("q-1", map[string]any{"behavior": "allow", "updatedInput": map[string]any{"answers": map[string]any{"Choice": "A, Other"}}}); err != nil {
		t.Fatal(err)
	}
	answers, _ := body["answers"].([]any)
	if path != "/session/session-1/question/q-1/reply" || len(answers) != 1 {
		t.Fatalf("path=%q body=%#v", path, body)
	}
}

func TestOpenCodeReplayRepairsLostIdle(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"info":{"id":"m1","sessionID":"session-1","role":"assistant","time":{"completed":2}},"parts":[{"id":"p1","sessionID":"session-1","messageID":"m1","type":"text","text":"done","time":{"end":2}}]}]`))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient = server.URL, server.Client()
	s.repairOpenCodeTurn(context.Background())
	s.repairOpenCodeTurn(context.Background())
	if s.Status() != "idle" || len(s.Timeline()) != 1 || s.Timeline()[0].Item.Text != "done" {
		t.Fatalf("status=%q timeline=%#v", s.Status(), s.Timeline())
	}
}

func TestOpenCodeIdleReplaysFinalAssistantBeforeFinishing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"info":{"id":"m1","sessionID":"session-1","role":"assistant","time":{"completed":2}},"parts":[{"id":"p1","sessionID":"session-1","messageID":"m1","type":"text","text":"Hello! 👋","time":{"end":2}}]}]`))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient = server.URL, server.Client()
	s.handleOpenCodeEvent(openCodeTestEvent("session.idle", map[string]any{"sessionID": "session-1"}))
	if err := s.WaitForFinish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if s.Status() != "idle" || len(s.Timeline()) != 1 || s.Timeline()[0].Item.Text != "Hello! 👋" {
		t.Fatalf("status=%q timeline=%#v", s.Status(), s.Timeline())
	}
}

func TestOpenCodeV2SteerInterruptAndRevert(t *testing.T) {
	var paths []string
	var prompt map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/prompt") {
			_ = json.NewDecoder(r.Body).Decode(&prompt)
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/message") {
			_, _ = w.Write([]byte(`{"data":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient, s.version = server.URL, server.Client(), 2
	if err := s.Steer(context.Background(), "continue", nil); err != nil {
		t.Fatal(err)
	}
	if prompt["delivery"] != "steer" {
		t.Fatalf("prompt = %#v", prompt)
	}
	if err := s.Abort(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.RewindConversation(context.Background(), "message-1"); err != nil {
		t.Fatal(err)
	}
	want := []string{"/api/session/session-1/prompt", "/api/session/session-1/interrupt", "/api/session/session-1/message", "/api/session/session-1/revert/stage", "/api/session/session-1/revert/commit"}
	if strings.Join(paths, ",") != strings.Join(want, ",") {
		t.Fatalf("paths = %#v", paths)
	}
}

func TestOpenCodeV2ConversationRewindExcludesFilesAndFilesOnlyFails(t *testing.T) {
	var stage map[string]any
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/message") {
			_, _ = w.Write([]byte(`{"data":[]}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/revert/stage") {
			_ = json.NewDecoder(r.Body).Decode(&stage)
		}
		_, _ = w.Write([]byte("{}"))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient, s.version = server.URL, server.Client(), 2
	if err := s.RewindConversationMode(context.Background(), "message-1", "conversation"); err != nil {
		t.Fatal(err)
	}
	if stage["files"] != false {
		t.Fatalf("stage = %#v", stage)
	}
	before := requests
	if err := s.RewindConversationMode(context.Background(), "message-1", "files"); err == nil {
		t.Fatal("files-only rewind unexpectedly succeeded")
	}
	if requests != before {
		t.Fatal("files-only fallback issued a native revert")
	}
}

func TestOpenCodePromptPublishesCanonicalUserMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient = server.URL, server.Client()
	s.status = "idle"
	var events []map[string]any
	s.OnEvent(func(event map[string]any) { events = append(events, event) })
	s.SetNextClientMessageID("client-1")
	if err := s.Prompt(context.Background(), "hello", nil); err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0]["type"] != "turn_start" || events[1]["type"] != "byspace_stream_timeline" {
		t.Fatalf("events = %#v", events)
	}
	item, ok := events[1]["item"].(sdk.TimelineItem)
	if !ok || item.Type != "user_message" || item.ClientMessageID != "client-1" {
		t.Fatalf("user event = %#v", events[1])
	}
	s.handleOpenCodeEvent(openCodeTestEvent("session.idle", map[string]any{"sessionID": "session-1"}))
	if err := s.WaitForFinish(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestOpenCodeCurrentV2TextUsageAndCompletion(t *testing.T) {
	s := newOpenCodeEventFixture()
	s.version = 2
	s.handleOpenCodeEvent(map[string]any{"type": "session.text.delta", "data": map[string]any{"sessionID": "session-1", "assistantMessageID": "msg-1", "ordinal": 0, "delta": "OK"}})
	s.handleOpenCodeEvent(map[string]any{"type": "session.text.ended", "data": map[string]any{"sessionID": "session-1", "assistantMessageID": "msg-1", "ordinal": 0, "text": "OK"}})
	s.handleOpenCodeEvent(map[string]any{"type": "session.usage.updated", "data": map[string]any{"sessionID": "session-1", "cost": 0.25, "tokens": map[string]any{"input": 10, "output": 2, "reasoning": 3, "cache": map[string]any{"read": 4, "write": 1}}}})
	s.handleOpenCodeEvent(map[string]any{"type": "session.execution.succeeded", "data": map[string]any{"sessionID": "session-1"}})
	timeline := s.Timeline()
	usage := s.Usage(context.Background())
	if len(timeline) != 1 || timeline[0].Item.Text != "OK" || timeline[0].Item.MessageID != "msg-1" || s.Status() != "idle" {
		t.Fatalf("status=%q timeline=%#v", s.Status(), timeline)
	}
	if usage == nil || usage.ContextWindowUsedTokens == nil || *usage.ContextWindowUsedTokens != 20 || usage.TotalCostUSD != 0.25 {
		t.Fatalf("usage = %#v", usage)
	}
}

func TestOpenCodeCurrentV2HistorySortsAndIgnoresIdleMarker(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"idle","type":"idle","time":{"created":4}},{"id":"assistant","type":"assistant","time":{"created":2,"completed":3},"content":[{"type":"text","text":"OK"}]},{"id":"user","type":"user","text":"hello","time":{"created":1}}]}`))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient, s.version = server.URL, server.Client(), 2
	complete, err := s.replayOpenCodeHistory(context.Background(), "session-1")
	if err != nil {
		t.Fatal(err)
	}
	timeline := s.Timeline()
	for _, entry := range timeline {
		t.Logf("seq=%d type=%s text=%q message=%q", entry.Seq, entry.Item.Type, entry.Item.Text, entry.Item.MessageID)
	}
	if !complete || len(timeline) != 2 || timeline[0].Item.Type != "user_message" || timeline[1].Item.Text != "OK" {
		t.Fatalf("complete=%v len=%d", complete, len(timeline))
	}
}

func TestOpenCodeCurrentV2HistoryReconcilesLiveRows(t *testing.T) {
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"user-native","type":"user","text":"hello","time":{"created":1}},{"id":"msg-1","type":"assistant","time":{"created":2,"completed":3},"content":[{"type":"text","text":"OK"}]}]}`))
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient, s.version = server.URL, server.Client(), 2
	s.timeline = append(s.timeline, sdk.TimelineEntry{Seq: 1, Item: sdk.TimelineItem{Type: "user_message", Text: "hello", MessageID: "client-1", ClientMessageID: "client-1"}})
	s.handleOpenCodeEvent(map[string]any{"type": "session.text.delta", "data": map[string]any{"sessionID": "session-1", "assistantMessageID": "msg-1", "ordinal": 0, "delta": "OK"}})
	complete, err := s.replayOpenCodeHistory(context.Background(), "session-1")
	if err != nil || !complete {
		t.Fatalf("complete=%v err=%v", complete, err)
	}
	if requestPath != "/api/session/session-1/message" {
		t.Fatalf("path = %q", requestPath)
	}
	timeline := s.Timeline()
	if len(timeline) != 2 || timeline[0].Item.MessageID != "user-native" || timeline[0].Item.ClientMessageID != "client-1" || timeline[1].Item.Text != "OK" {
		t.Fatalf("timeline = %#v", timeline)
	}
}

func TestOpenCodeRewindResolvesClientMessageID(t *testing.T) {
	var stagedMessageID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/session/session-1/message":
			_, _ = w.Write([]byte(`{"data":[{"id":"user-native","type":"user","text":"hello","time":{"created":1}}]}`))
		case "/api/session/session-1/revert/stage":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			stagedMessageID, _ = body["messageID"].(string)
			_, _ = w.Write([]byte(`{}`))
		case "/api/session/session-1/revert/commit":
			_, _ = w.Write([]byte(`{}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient, s.version = server.URL, server.Client(), 2
	s.timeline = append(s.timeline, sdk.TimelineEntry{Seq: 1, Item: sdk.TimelineItem{Type: "user_message", Text: "hello", MessageID: "client-1", ClientMessageID: "client-1"}})
	if err := s.RewindConversation(context.Background(), "client-1"); err != nil {
		t.Fatal(err)
	}
	if stagedMessageID != "user-native" {
		t.Fatalf("staged message = %q", stagedMessageID)
	}
}

func TestOpenCodeEventsMapToolsAndUsage(t *testing.T) {
	s := newOpenCodeEventFixture()
	part := map[string]any{"id": "part-tool", "sessionID": "session-1", "messageID": "msg", "type": "tool", "tool": "bash", "callID": "call-1", "state": map[string]any{"status": "running", "input": map[string]any{"command": "go test ./..."}}}
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.updated", map[string]any{"part": part}))
	part["state"] = map[string]any{"status": "completed", "input": map[string]any{"command": "go test ./..."}, "output": "ok"}
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.updated", map[string]any{"part": part}))
	timeline := s.Timeline()
	detail, _ := timeline[0].Item.Detail.(map[string]any)
	if len(timeline) != 1 || timeline[0].Item.Status != "completed" || detail["command"] != "go test ./..." {
		t.Fatalf("tool timeline = %#v", timeline)
	}
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.updated", map[string]any{"part": map[string]any{
		"id": "step", "sessionID": "session-1", "messageID": "msg", "type": "step-finish", "cost": 0.25,
		"tokens": map[string]any{"input": float64(30000), "output": float64(12000), "reasoning": float64(10000), "cache": map[string]any{"read": float64(2000), "write": float64(1000)}},
	}}))
	usage := s.Usage(context.Background())
	if usage == nil || usage.InputTokens != 30000 || usage.CachedInputTokens != 2000 || usage.ContextWindowUsedTokens == nil || *usage.ContextWindowUsedTokens != 55000 || usage.TotalCostUSD != 0.25 {
		t.Fatalf("usage = %#v", usage)
	}
}
