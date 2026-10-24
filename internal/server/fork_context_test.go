package server

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// forkRows is a small projected-friendly timeline: two user turns, each with an assistant reply and a
// tool call. Seqs are contiguous the way the mock emits them.
func forkRows() []pi.TimelineEntry {
	rows := []struct {
		seq    int
		turnID string
		item   sdk.TimelineItem
	}{
		{1, "t1", sdk.TimelineItem{Type: "user_message", Text: "first prompt", MessageID: "u1"}},
		{2, "t1", sdk.TimelineItem{Type: "assistant_message", Text: "first answer", MessageID: "a1"}},
		{3, "t1", sdk.TimelineItem{Type: "tool_call", CallID: "c1", Name: "bash", Status: "completed", Detail: map[string]any{"type": "shell", "command": "ls"}}},
		{4, "t2", sdk.TimelineItem{Type: "user_message", Text: "second prompt", MessageID: "u2"}},
		{5, "t2", sdk.TimelineItem{Type: "assistant_message", Text: "second answer", MessageID: "a2"}},
	}
	out := make([]pi.TimelineEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, pi.TimelineEntry{Seq: r.seq, SeqEnd: r.seq, TurnID: r.turnID, Timestamp: "2026-01-01T00:00:00Z", Item: r.item})
	}
	return out
}

// The attachment has to satisfy TextAttachmentSchema or the client drops it: type text, mimeType
// text/plain, contextKind chat_history. The old Go shape (text/markdown, a name field, no
// contextKind) is what made every fork spec time out on a pill that never rendered.
func TestBuildForkContextAttachmentShape(t *testing.T) {
	result, err := buildForkContextAttachment(forkRows(), nil, "", "ep_1", "My agent", "/tmp/repo")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	att := result.Attachment
	if att["type"] != "text" {
		t.Errorf("type = %v, want text", att["type"])
	}
	if att["mimeType"] != "text/plain" {
		t.Errorf("mimeType = %v, want text/plain", att["mimeType"])
	}
	if att["contextKind"] != "chat_history" {
		t.Errorf("contextKind = %v, want chat_history", att["contextKind"])
	}
	if att["title"] != "Chat history" {
		t.Errorf("title = %v, want Chat history", att["title"])
	}
	if _, ok := att["name"]; ok {
		t.Errorf("attachment carries a name field; TextAttachmentSchema has no such field")
	}
	text, _ := att["text"].(string)
	for _, want := range []string{
		"<chat-history-summary>",
		"Chat history from a previous BySpace agent.",
		"Source agent: My agent",
		"Source directory: /tmp/repo",
		"first prompt",
		"[Assistant] first answer",
		"second answer",
		"</chat-history-summary>",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("fork text missing %q:\n%s", want, text)
		}
	}
	if result.ItemCount != 5 {
		t.Errorf("itemCount = %d, want 5 (the whole timeline)", result.ItemCount)
	}
}

// A cursor boundary cuts at the projected entry whose range ends at the cursor seq, inclusive.
func TestBuildForkContextCursorBoundary(t *testing.T) {
	cursor := &forkCursorBoundary{Epoch: "ep_1", Seq: 3}
	result, err := buildForkContextAttachment(forkRows(), cursor, "", "ep_1", "t", "/d")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ItemCount != 3 {
		t.Fatalf("itemCount = %d, want 3 (rows 1..3)", result.ItemCount)
	}
	text, _ := result.Attachment["text"].(string)
	if !strings.Contains(text, "first answer") {
		t.Errorf("the cut dropped a row it should keep:\n%s", text)
	}
	if strings.Contains(text, "second prompt") {
		t.Errorf("the cut kept a row past the boundary:\n%s", text)
	}
	if result.BoundaryCursor == nil || result.BoundaryCursor["seq"] != 3 {
		t.Errorf("boundaryCursor = %v, want the echoed cursor at seq 3", result.BoundaryCursor)
	}
}

// A message-id boundary cuts after the last assistant message with that id, and the response echoes
// the id back so the client can pin the draft.
func TestBuildForkContextMessageIDBoundary(t *testing.T) {
	result, err := buildForkContextAttachment(forkRows(), nil, "a1", "ep_1", "t", "/d")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// a1 is the assistant message at seq 2, so rows 1..2 survive; the tool call at seq 3 does not.
	if result.ItemCount != 2 {
		t.Fatalf("itemCount = %d, want 2 (up to and including a1)", result.ItemCount)
	}
	if result.BoundaryMessageID == nil || *result.BoundaryMessageID != "a1" {
		t.Fatalf("boundaryMessageId = %v, want a1", result.BoundaryMessageID)
	}
	if result.BoundaryCursor != nil {
		t.Fatalf("a message-id boundary must not fabricate a cursor: %v", result.BoundaryCursor)
	}
}

// A cursor from another daemon epoch is stale; rejecting it beats silently forking the whole
// timeline the user did not point at.
func TestBuildForkContextRejectsStaleEpoch(t *testing.T) {
	cursor := &forkCursorBoundary{Epoch: "ep_old", Seq: 3}
	_, err := buildForkContextAttachment(forkRows(), cursor, "", "ep_new", "t", "/d")
	if err == nil || !strings.Contains(err.Error(), "no longer available") {
		t.Fatalf("a stale-epoch cursor returned err=%v, want a 'no longer available' error", err)
	}
}

// A cursor that matches no entry is an error, not a whole-timeline fork.
func TestBuildForkContextRejectsUnknownBoundary(t *testing.T) {
	cursor := &forkCursorBoundary{Epoch: "ep_1", Seq: 999}
	if _, err := buildForkContextAttachment(forkRows(), cursor, "", "ep_1", "t", "/d"); err == nil {
		t.Fatal("an unmatched cursor seq was accepted")
	}
	if _, err := buildForkContextAttachment(forkRows(), nil, "no-such-message", "ep_1", "t", "/d"); err == nil {
		t.Fatal("an unmatched message id was accepted")
	}
}

// Only user_message, assistant_message and tool_call reach the body; reasoning and anything else is
// curated out, matching node's includeKinds.
func TestBuildForkContextCuratesKinds(t *testing.T) {
	rows := forkRows()
	rows = append(rows, pi.TimelineEntry{
		Seq: 6, SeqEnd: 6, TurnID: "t2", Timestamp: "2026-01-01T00:00:00Z",
		Item: sdk.TimelineItem{Type: "reasoning", Text: "internal deliberation that must not leak"},
	})
	result, err := buildForkContextAttachment(rows, nil, "", "ep_1", "t", "/d")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	text, _ := result.Attachment["text"].(string)
	if strings.Contains(text, "internal deliberation") {
		t.Errorf("reasoning leaked into the fork body:\n%s", text)
	}
	// itemCount counts the projected items selected, not the rendered lines: node's
	// `itemCount: selected.items.length` includes the reasoning row even though includeKinds keeps it
	// out of the body. The body filter and the count are two different things.
	if result.ItemCount != 6 {
		t.Errorf("itemCount = %d, want 6 (all projected rows, reasoning excluded from the body only)", result.ItemCount)
	}
}

// An empty timeline still produces a valid attachment, with the placeholder body node uses.
func TestBuildForkContextEmptyTimeline(t *testing.T) {
	result, err := buildForkContextAttachment(nil, nil, "", "ep_1", "t", "/d")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	text, _ := result.Attachment["text"].(string)
	if !strings.Contains(text, "No chat history to display.") {
		t.Errorf("empty timeline body = %q, want the placeholder", text)
	}
	if result.ItemCount != 0 {
		t.Errorf("itemCount = %d, want 0", result.ItemCount)
	}
}
