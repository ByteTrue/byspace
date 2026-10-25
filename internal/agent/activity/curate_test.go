package activity

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// A streaming provider emits one item per delta. One line per delta is unreadable, so adjacent
// assistant text and adjacent reasoning are merged.
func TestCurateMergesAdjacentDeltas(t *testing.T) {
	got := CurateAgentActivity([]sdk.TimelineItem{
		{Type: "user_message", Text: "  refactor the parser  "},
		{Type: "reasoning", Text: "first think"},
		{Type: "reasoning", Text: "then more"},
		{Type: "assistant_message", Text: "Done."},
		{Type: "assistant_message", Text: "Two files changed."},
	}, CuratorOptions{})

	// The flush order is message-then-thought, matching flushBuffers in the node curator: an
	// assistant message that arrived before any reasoning still prints after it would have, because
	// both are buffered until the next non-buffered event.
	want := "[User] refactor the parser\nDone.\nTwo files changed.\n[Thought] first think\nthen more"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

// An empty timeline has a defined answer rather than an empty string: the caller renders it.
func TestCurateEmptyTimeline(t *testing.T) {
	if got := CurateAgentActivity(nil, CuratorOptions{}); got != "No activity to display." {
		t.Fatalf("got %q", got)
	}
}

// Only the last N items when a limit is set: a long run would otherwise blow past whatever
// consumes the text.
func TestCurateMaxItems(t *testing.T) {
	items := []sdk.TimelineItem{
		{Type: "user_message", Text: "one"},
		{Type: "user_message", Text: "two"},
		{Type: "user_message", Text: "three"},
	}
	got := CurateAgentActivity(items, CuratorOptions{MaxItems: 2})
	if strings.Contains(got, "one") {
		t.Fatalf("the oldest item survived: %q", got)
	}
	if !strings.Contains(got, "two") || !strings.Contains(got, "three") {
		t.Fatalf("got %q", got)
	}
}

// The fork-context attachment asks for user/assistant/tool_call only, and labels assistant text so
// the reader knows who spoke.
func TestCurateIncludeKindsAndLabel(t *testing.T) {
	items := []sdk.TimelineItem{
		{Type: "user_message", Text: "hi"},
		{Type: "reasoning", Text: "thinking hard"},
		{Type: "assistant_message", Text: "hello"},
	}
	got := CurateAgentActivity(items, CuratorOptions{
		IncludeKinds:           []string{"user_message", "assistant_message", "tool_call"},
		LabelAssistantMessages: true,
	})
	if strings.Contains(got, "thinking hard") {
		t.Fatalf("reasoning should be filtered out: %q", got)
	}
	if !strings.Contains(got, "[Assistant] hello") {
		t.Fatalf("assistant text should be labelled: %q", got)
	}
}

// A tool call is named by its display model, and a sub-agent's log is included: the call itself is
// one line, and dropping the log loses what the delegate actually did.
func TestCurateToolCallsAndSubagentLog(t *testing.T) {
	got := CurateAgentActivity([]sdk.TimelineItem{
		{Type: "tool_call", Name: "bash", Detail: map[string]any{"type": "shell", "command": "npm test"}},
		{
			Type: "tool_call",
			Name: "subagent",
			Detail: map[string]any{
				"type": "sub_agent", "subAgentType": "Explore", "description": "find the parser",
				"log": "read 3 files",
			},
		},
	}, CuratorOptions{})

	if !strings.Contains(got, "[Shell] npm test") {
		t.Fatalf("shell call: %q", got)
	}
	if !strings.Contains(got, "[Explore] find the parser") {
		t.Fatalf("sub-agent call: %q", got)
	}
	if !strings.Contains(got, "read 3 files") {
		t.Fatalf("sub-agent log missing: %q", got)
	}
}

// A command containing newlines must not break the one-line-per-event shape.
func TestCurateToolSummaryCollapsesWhitespace(t *testing.T) {
	got := CurateAgentActivity([]sdk.TimelineItem{
		{Type: "tool_call", Name: "bash", Detail: map[string]any{"type": "shell", "command": "a\nb\tc"}},
	}, CuratorOptions{})
	if strings.Contains(got, "\n") && strings.Count(got, "\n") > 0 {
		if !strings.Contains(got, "[Shell] a b c") {
			t.Fatalf("whitespace not collapsed: %q", got)
		}
	}
}

// Todo, error, custom message and compaction each have their own line shape.
func TestCurateRemainingItemTypes(t *testing.T) {
	got := CurateAgentActivity([]sdk.TimelineItem{
		{Type: "todo", Detail: map[string]any{"items": []any{
			map[string]any{"text": "first", "completed": true},
			map[string]any{"text": "second", "completed": false},
		}}},
		{Type: "error", Error: "boom"},
		{Type: "custom_message", Text: "note", Detail: map[string]any{"customType": "hook"}},
		{Type: "compaction"},
	}, CuratorOptions{})

	for _, want := range []string{"[Tasks]", "- [x] first", "- [ ] second", "[Error] boom", "[hook] note", "[Compacted]"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}
}

// The display model is what names a tool call; the mappings come from protocol/tool-call-display.ts.
func TestBuildDisplayModel(t *testing.T) {
	cases := []struct {
		name     string
		detail   any
		wantName string
		wantSum  string
	}{
		{"bash", map[string]any{"type": "shell", "command": "ls -la"}, "Shell", "ls -la"},
		{"read", map[string]any{"type": "read", "filePath": "/tmp/a.go"}, "Read", "/tmp/a.go"},
		{"web_search", map[string]any{"type": "search", "query": "go mutex"}, "Search", "go mutex"},
		{"web_fetch", map[string]any{"type": "fetch", "url": "https://x"}, "Fetch", "https://x"},
		{"plan", map[string]any{"type": "plan"}, "Plan", ""},
		// Unknown detail with a known tool name gets an override.
		{"Task", map[string]any{"type": "unknown"}, "Task", ""},
		{"thinking", map[string]any{"type": "unknown"}, "Thinking", ""},
		// No detail at all: the tool name is humanized.
		{"web_search", nil, "Web search", ""},
		// A namespaced name is left alone: the qualifier is the information.
		{"mcp__github__create_issue", nil, "mcp__github__create_issue", ""},
		// A BySpace tool is reduced to its leaf first.
		{"mcp__byspace__create_agent", nil, "Create agent", ""},
	}
	for _, c := range cases {
		got := BuildDisplayModel(c.name, c.detail, nil)
		if got.DisplayName != c.wantName {
			t.Fatalf("%s/%v: name = %q, want %q", c.name, c.detail, got.DisplayName, c.wantName)
		}
		if c.wantSum != "" && got.Summary != c.wantSum {
			t.Fatalf("%s: summary = %q, want %q", c.name, got.Summary, c.wantSum)
		}
	}
}

// A turn that produced only tool calls has no assistant text. Reporting nothing makes a successful
// run look like it did not happen.
func TestScheduledRunOutputFallsBackToTimeline(t *testing.T) {
	items := []sdk.TimelineItem{
		{Type: "user_message", Text: "run the tests"},
		{Type: "tool_call", Name: "bash", Detail: map[string]any{"type": "shell", "command": "npm test"}},
	}
	got := CurateAgentActivity(items, CuratorOptions{})
	if !strings.Contains(got, "[Shell] npm test") {
		t.Fatalf("the tool call is what the run did: %q", got)
	}
	if got == "No activity to display." {
		t.Fatal("a timeline with events must not report the empty placeholder")
	}
}
