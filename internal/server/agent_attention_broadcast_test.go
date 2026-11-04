package server

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/store"
)

func attentionFrames(t *testing.T, sink *recordingSink) []map[string]any {
	t.Helper()
	sink.mu.Lock()
	defer sink.mu.Unlock()
	var out []map[string]any
	for _, raw := range sink.texts {
		var envelope struct {
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(raw), &envelope) != nil {
			continue
		}
		switch envelope.Message.Type {
		case "agent_attention_required":
			out = append(out, envelope.Message.Payload)
		case "agent_stream":
			if event, ok := envelope.Message.Payload["event"].(map[string]any); ok && event["type"] == "attention_required" {
				out = append(out, event)
			}
		}
	}
	return out
}

func TestBroadcastAgentAttentionNotifiesTheMostRecentlyActiveClientOnly(t *testing.T) {
	srv := newTimelineTestServer()
	srv.serverID = "srv_test"
	desktop, phone := &recordingSink{}, &recordingSink{}
	srv.clients[desktop] = true
	srv.clients[phone] = true
	srv.selectiveTimeline[desktop] = true
	now := time.Now()
	other := "agt_other"
	srv.recordClientPresence(desktop, true, &other, nil, now.Add(-10*time.Second).Format(time.RFC3339Nano))
	srv.recordClientPresence(phone, false, nil, nil, now.Add(-time.Minute).Format(time.RFC3339Nano))

	srv.broadcastAgentAttention(store.AgentRecord{ID: "agt_a", WorkspaceID: "wks_1", Provider: "mock", Title: strPtr("Fix login")}, AttentionReasonFinished, now.Format(time.RFC3339Nano))

	desktopFrames, phoneFrames := attentionFrames(t, desktop), attentionFrames(t, phone)
	if len(desktopFrames) != 1 || len(phoneFrames) != 1 {
		t.Fatalf("frames: desktop %d phone %d, want 1 each", len(desktopFrames), len(phoneFrames))
	}
	if desktopFrames[0]["shouldNotify"] != true || phoneFrames[0]["shouldNotify"] != false {
		t.Fatalf("shouldNotify: desktop %v phone %v", desktopFrames[0]["shouldNotify"], phoneFrames[0]["shouldNotify"])
	}
	notification, _ := desktopFrames[0]["notification"].(map[string]any)
	if notification["title"] != "Agent finished" || notification["body"] != "Fix login" {
		t.Fatalf("notification: %v", notification)
	}
}

func TestBroadcastAgentAttentionStaysQuietWhileAVisibleClientWatchesTheAgent(t *testing.T) {
	srv := newTimelineTestServer()
	sink := &recordingSink{}
	srv.clients[sink] = true
	watching := "agt_a"
	srv.recordClientPresence(sink, true, &watching, nil, time.Now().Format(time.RFC3339Nano))

	srv.broadcastAgentAttention(store.AgentRecord{ID: "agt_a", WorkspaceID: "wks_1"}, AttentionReasonFinished, time.Now().Format(time.RFC3339Nano))

	frames := attentionFrames(t, sink)
	if len(frames) != 1 || frames[0]["shouldNotify"] != false {
		t.Fatalf("frames: %v", frames)
	}
}
