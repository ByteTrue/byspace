package pi

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestPiNoTurnPromptPublishesLocalOutputAndCompletes(t *testing.T) {
	s, events := newEventSession(t)
	s.status = "running"
	s.activeTurnID = "turn_1"
	s.turnToken = "tok_1"
	s.handleRawEvent(map[string]any{"type": "command_output", "text": "Usage 12%"})
	s.completePromptWithoutAgent("turn_1", "tok_1")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.WaitForFinish(ctx); err != nil {
		t.Fatal(err)
	}
	if got := s.LastAssistantText(); got != "Usage 12%" {
		t.Fatalf("local output = %q", got)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		for _, event := range *events {
			if event["type"] == "byspace_turn_completed" {
				return
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("missing turn completion")
}

func TestPiCompactionRetryAndCustomMessages(t *testing.T) {
	s, _ := newEventSession(t)
	for _, event := range []map[string]any{
		{"type": "compaction_start", "reason": "manual"},
		{"type": "compaction_end", "reason": "manual"},
		{"type": "auto_retry_start", "attempt": 1.0, "errorMessage": "Request timed out."},
		{"type": "message_end", "message": map[string]any{
			"role": "custom", "customType": "project-context", "display": true,
			"content": []any{map[string]any{"type": "text", "text": "Project instructions"}},
			"details": map[string]any{"project": "example"},
		}},
	} {
		s.handleRawEvent(event)
	}
	if len(s.timeline) != 3 {
		t.Fatalf("timeline items = %d, want 3", len(s.timeline))
	}
	if got := s.timeline[0].Item; got.Type != "compaction" || got.Status != "completed" || got.Trigger != "manual" {
		t.Fatalf("compaction = %+v", got)
	}
	if got := s.timeline[1].Item.Message; got != "Provider retry (attempt 1): Request timed out." {
		t.Fatalf("retry = %q", got)
	}
	custom := s.timeline[2].Item
	if custom.Type != "tool_call" || custom.Name != "project-context" || custom.Metadata["synthetic"] != true {
		t.Fatalf("custom message = %+v", custom)
	}
}

func TestPiToolImagesAreMaterializedNotPersistedAsBase64(t *testing.T) {
	result := map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "shot taken"},
			map[string]any{"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"},
		},
		"structuredContent": map[string]any{"captureId": "capture-1"},
	}
	sanitized, markdown := sanitizeToolResult(result, t.TempDir())
	if !strings.Contains(markdown, "![Image](") {
		t.Fatalf("markdown = %q", markdown)
	}
	content := sanitized.(map[string]any)["content"].([]any)
	if content[1].(map[string]any)["text"] != "[image]" {
		t.Fatalf("sanitized content = %#v", content[1])
	}
}

func TestPiNegotiatedImageCapability(t *testing.T) {
	s := &Session{modelInput: []string{"text"}}
	if s.Capabilities().SupportsImages {
		t.Fatal("text-only model advertised image support")
	}
	s.modelInput = []string{"text", "image"}
	if !s.Capabilities().SupportsImages {
		t.Fatal("image-capable model rejected images")
	}
}
