package activity

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// A command's stdout travels to every client on every timeline fetch.
func TestLimitShellOutput(t *testing.T) {
	long := strings.Repeat("x", ToolCallContentMaxLength+1000)
	item := map[string]any{
		"type":   "tool_call",
		"detail": map[string]any{"type": "shell", "command": "cat big.log", "output": long},
	}
	limited := LimitTimelineItemContent(item)
	detail := limited["detail"].(map[string]any)
	if got := detail["output"].(string); len(got) != ToolCallContentMaxLength {
		t.Fatalf("output length = %d", len(got))
	}
	// The prefix is the useful part; trimming keeps it.
	if !strings.HasPrefix(detail["output"].(string), "xxx") {
		t.Fatal("the kept prefix is wrong")
	}

	// A short output is untouched.
	short := map[string]any{"type": "tool_call", "detail": map[string]any{"type": "shell", "output": "ok"}}
	if got := LimitTimelineItemContent(short)["detail"].(map[string]any)["output"]; got != "ok" {
		t.Fatalf("short output changed: %v", got)
	}
}

// A failing build writes everything to stderr, so that field needs the same cap.
func TestLimitFailedShellError(t *testing.T) {
	long := strings.Repeat("e", ToolCallContentMaxLength+1)
	item := map[string]any{
		"type":   "tool_call",
		"detail": map[string]any{"type": "shell", "output": "x"},
		"status": "failed",
		"error":  map[string]any{"content": long},
	}
	limited := LimitTimelineItemContent(item)
	content := limited["error"].(map[string]any)["content"].(string)
	if len(content) != ToolCallContentMaxLength {
		t.Fatalf("error content length = %d", len(content))
	}

	// A completed call's error field is not touched: status decides.
	completed := map[string]any{
		"type":   "tool_call",
		"detail": map[string]any{"type": "shell"},
		"status": "completed",
		"error":  map[string]any{"content": long},
	}
	got := LimitTimelineItemContent(completed)["error"].(map[string]any)["content"].(string)
	if len(got) != len(long) {
		t.Fatal("a completed call's error was truncated")
	}
}

// A plain_text detail is a label the tool chose; a tool that pastes a file into it would otherwise
// send the file.
func TestLimitPlainText(t *testing.T) {
	long := strings.Repeat("p", ToolCallContentMaxLength+5)
	item := map[string]any{"type": "tool_call", "detail": map[string]any{"type": "plain_text", "text": long}}
	got := LimitTimelineItemContent(item)["detail"].(map[string]any)["text"].(string)
	if len(got) != ToolCallContentMaxLength {
		t.Fatalf("text length = %d", len(got))
	}
}

// Byte slicing a UTF-8 string produces a replacement character at the boundary, which shows as
// mojibake in the terminal card.
func TestLimitKeepsRuneBoundaries(t *testing.T) {
	// Three-byte runes: a byte cut at 64KiB lands mid-character.
	long := strings.Repeat("中", ToolCallContentMaxLength)
	item := map[string]any{"type": "tool_call", "detail": map[string]any{"type": "shell", "output": long}}
	got := LimitTimelineItemContent(item)["detail"].(map[string]any)["output"].(string)

	if len(got) > ToolCallContentMaxLength {
		t.Fatalf("over the limit: %d", len(got))
	}
	if !utf8.ValidString(got) {
		t.Fatal("the cut split a character")
	}
}

// `details` is free-form JSON whose structure the daemon does not know, so a byte-level truncation
// would produce invalid JSON. Dropping the field is the honest outcome.
func TestLimitTimelineDetails(t *testing.T) {
	small := map[string]any{"a": 1}
	if got := LimitTimelineDetails(small); got == nil {
		t.Fatal("a small payload was dropped")
	}
	if got := LimitTimelineDetails(nil); got != nil {
		t.Fatal("nil must stay nil")
	}

	big := map[string]any{"blob": strings.Repeat("b", PluginTimelineDataMaxBytes+1)}
	if got := LimitTimelineDetails(big); got != nil {
		t.Fatal("an oversized payload must be dropped, not truncated")
	}

	if err := AssertPluginTimelineDataSize(small); err != nil {
		t.Fatalf("a small payload was refused: %v", err)
	}
	if err := AssertPluginTimelineDataSize(big); err == nil {
		t.Fatal("an oversized payload must be refused")
	}
}

// A non-tool-call item is not touched.
func TestLimitIgnoresOtherItemTypes(t *testing.T) {
	item := map[string]any{"type": "assistant_message", "text": strings.Repeat("x", 100000)}
	if got := LimitTimelineItemContent(item)["text"].(string); len(got) != 100000 {
		t.Fatal("an assistant message was truncated by the tool-call limiter")
	}
}
