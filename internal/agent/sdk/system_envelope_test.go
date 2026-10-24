package sdk

import "testing"

// System-injected prompts (mentions, schedule fires, finish notifications) reach the provider
// as user messages. Showing them as user bubbles makes the transcript lie about who asked.
func TestSystemEnvelopeRoundTrip(t *testing.T) {
	body := "Reminder: the build finished."
	wrapped := FormatSystemNotificationPrompt(body)
	if !IsSystemInjectedEnvelope(wrapped) {
		t.Fatalf("own output not recognised: %q", wrapped)
	}
}

// A user who types the tag by hand must not have their message hidden, so the match is anchored
// and requires the exact layout the formatter produces.
func TestSystemEnvelopeRejectsLookalikes(t *testing.T) {
	lookalikes := []string{
		"<byspace-system>no newlines</byspace-system>",
		"prefix <byspace-system>\nx\n</byspace-system>",
		"<byspace-system>\nx\n</byspace-system> suffix",
		"<byspace-system>\nx</byspace-system>",
		"plain user message",
		"",
	}
	for _, text := range lookalikes {
		if IsSystemInjectedEnvelope(text) {
			t.Fatalf("%q must not count as a system envelope", text)
		}
	}
}

// Multiline bodies are the common case (a schedule prompt can be several paragraphs).
func TestSystemEnvelopeAllowsMultiline(t *testing.T) {
	if !IsSystemInjectedEnvelope(FormatSystemNotificationPrompt("line one\nline two\nline three")) {
		t.Fatal("multiline body should be recognised")
	}
}

// A tool can print megabytes; the row rides along on every timeline fetch, so an unbounded one
// turns every later refresh into a multi-megabyte transfer.
func TestLimitTimelineItemContentTruncatesShellOutput(t *testing.T) {
	huge := make([]byte, ToolCallContentMaxLength+500)
	for i := range huge {
		huge[i] = 'x'
	}
	item := TimelineItem{
		Type:   "tool_call",
		Name:   "bash",
		Status: "completed",
		Detail: map[string]any{"type": "shell", "command": "cat big", "output": string(huge)},
	}
	got := LimitTimelineItemContent(item)
	detail := got.Detail.(map[string]any)
	if len(detail["output"].(string)) != ToolCallContentMaxLength {
		t.Fatalf("output length = %d", len(detail["output"].(string)))
	}
	// The command itself must survive: truncation is about output volume, not identity.
	if detail["command"] != "cat big" {
		t.Fatalf("command was dropped: %v", detail["command"])
	}
}

func TestLimitTimelineItemContentLeavesSmallOutput(t *testing.T) {
	item := TimelineItem{
		Type:   "tool_call",
		Status: "completed",
		Detail: map[string]any{"type": "shell", "command": "echo hi", "output": "hi"},
	}
	got := LimitTimelineItemContent(item)
	if got.Detail.(map[string]any)["output"] != "hi" {
		t.Fatal("small output must be untouched")
	}
}

// Non-tool items and unknown detail shapes pass through unchanged rather than being mangled.
func TestLimitTimelineItemContentIgnoresOtherItems(t *testing.T) {
	text := TimelineItem{Type: "assistant_message", Text: "hello"}
	if got := LimitTimelineItemContent(text); got.Text != "hello" {
		t.Fatal("assistant text must not be truncated here")
	}
	unknown := TimelineItem{Type: "tool_call", Detail: map[string]any{"type": "mystery", "blob": "x"}}
	if got := LimitTimelineItemContent(unknown); got.Detail.(map[string]any)["blob"] != "x" {
		t.Fatal("unknown detail must be returned as-is")
	}
}
