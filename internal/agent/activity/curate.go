package activity

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// CuratorOptions controls what the curator keeps.
type CuratorOptions struct {
	// MaxItems keeps only the last N items. Zero means everything.
	MaxItems int
	// LabelAssistantMessages prefixes assistant text with `[Assistant]`. Used by the fork-context
	// attachment, where the reader has no other cue about who said what.
	LabelAssistantMessages bool
	// IncludeKinds restricts the output to these item types. Empty means all.
	IncludeKinds []string
	// IncludeExternalToolInput appends a tool call's raw input JSON for tools that take free-form
	// arguments. Defaults to true; turn it off when the reader is another model that does not need
	// the arguments.
	IncludeExternalToolInput bool
}

const (
	maxToolInputChars   = 400
	maxToolSummaryChars = 200
)

// CurateAgentActivity renders a timeline as plain text.
//
// Ported from curateAgentActivity. The output is what a schedule run reports as its result and what
// a fork-context attachment is built from, so the shape matters: one line per event, adjacent
// assistant text and reasoning merged, tool calls named by their display model.
//
// Consecutive assistant messages and consecutive reasoning blocks are buffered and joined rather
// than emitted separately: a streaming provider produces one item per delta, and one line per delta
// is unreadable.
func CurateAgentActivity(items []sdk.TimelineItem, options CuratorOptions) string {
	entries := curateEntries(items, options)
	if len(entries) == 0 {
		return "No activity to display."
	}
	return strings.Join(entries, "\n")
}

// CurateEntries returns the individual lines, for callers that want to count or filter.
func CurateEntries(items []sdk.TimelineItem, options CuratorOptions) []string {
	return curateEntries(items, options)
}

// curateEntries is the work behind both entry points.
func curateEntries(items []sdk.TimelineItem, options CuratorOptions) []string {
	if len(items) == 0 {
		return nil
	}

	recent := items
	if options.MaxItems > 0 && len(items) > options.MaxItems {
		recent = items[len(items)-options.MaxItems:]
	}

	entries := make([]string, 0, len(recent))
	var message, thought strings.Builder

	flush := func() {
		if text := strings.TrimSpace(message.String()); text != "" {
			if options.LabelAssistantMessages {
				entries = append(entries, "[Assistant] "+text)
			} else {
				entries = append(entries, text)
			}
		}
		if text := strings.TrimSpace(thought.String()); text != "" {
			entries = append(entries, "[Thought] "+text)
		}
		message.Reset()
		thought.Reset()
	}

	for _, item := range recent {
		if !shouldInclude(item, options) {
			continue
		}
		switch item.Type {
		case "user_message":
			flush()
			entries = append(entries, "[User] "+strings.TrimSpace(item.Text))
		case "assistant_message":
			appendText(&message, item.Text)
		case "reasoning":
			appendText(&thought, item.Text)
		case "tool_call":
			flush()
			entries = append(entries, formatToolCallEntry(item, options))
			// A sub-agent's log is the only place its work appears; the tool call itself is one
			// line, and dropping the log loses what the delegate actually did.
			if detail := asDetail(item.Detail); detail.kind() == "sub_agent" {
				if log, ok := detail.str("log"); ok && strings.TrimSpace(log) != "" {
					entries = append(entries, strings.TrimSpace(log))
				}
			}
		case "todo":
			flush()
			entries = append(entries, "[Tasks]")
			for _, entry := range todoItems(item.Detail) {
				checkbox := "[ ]"
				if entry.completed {
					checkbox = "[x]"
				}
				entries = append(entries, "- "+checkbox+" "+entry.text)
			}
		case "error":
			flush()
			entries = append(entries, "[Error] "+errorMessage(item))
		case "custom_message":
			flush()
			entries = append(entries, "["+customType(item.Detail)+"] "+strings.TrimSpace(item.Text))
		case "compaction":
			flush()
			entries = append(entries, "[Compacted]")
		}
	}
	flush()
	return entries
}

// shouldInclude applies the includeKinds filter.
func shouldInclude(item sdk.TimelineItem, options CuratorOptions) bool {
	if len(options.IncludeKinds) == 0 {
		return true
	}
	for _, kind := range options.IncludeKinds {
		if kind == item.Type {
			return true
		}
	}
	return false
}

// appendText appends a trimmed chunk as a new line of a buffer.
func appendText(buffer *strings.Builder, text string) {
	normalized := strings.TrimSpace(text)
	if normalized == "" {
		return
	}
	if buffer.Len() > 0 {
		buffer.WriteByte('\n')
	}
	buffer.WriteString(normalized)
}

// formatToolCallEntry renders one tool call.
func formatToolCallEntry(item sdk.TimelineItem, options CuratorOptions) string {
	display := BuildDisplayModel(item.Name, item.Detail, nil)
	summary, hasSummary := formatToolSummary(display)
	if hasSummary {
		return "[" + display.DisplayName + "] " + summary
	}
	return "[" + display.DisplayName + "]"
}

// formatToolSummary normalizes and truncates a display summary.
func formatToolSummary(display DisplayModel) (string, bool) {
	if !display.HasSummary {
		return "", false
	}
	// Collapse whitespace: a command or path with newlines would otherwise break the one-line-per-
	// event shape the output relies on.
	fields := strings.Fields(display.Summary)
	normalized := strings.Join(fields, " ")
	if normalized == "" {
		return "", false
	}
	if len(normalized) <= maxToolSummaryChars {
		return normalized, true
	}
	return normalized[:maxToolSummaryChars-3] + "...", true
}

// todoEntry is one row of a todo item.
type todoEntry struct {
	text      string
	completed bool
}

// todoItems reads a todo item's rows.
func todoItems(detail any) []todoEntry {
	parsed := asDetail(detail)
	raw, ok := parsed["items"].([]any)
	if !ok {
		return nil
	}
	out := make([]todoEntry, 0, len(raw))
	for _, item := range raw {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		text, _ := record["text"].(string)
		completed, _ := record["completed"].(bool)
		out = append(out, todoEntry{text: text, completed: completed})
	}
	return out
}

// errorMessage reads an error item's message.
func errorMessage(item sdk.TimelineItem) string {
	if item.Error != nil {
		if text, ok := FormatErrorText(item.Error); ok {
			return text
		}
	}
	return item.Text
}

// customType reads a custom_message item's type tag.
func customType(detail any) string {
	parsed := asDetail(detail)
	if value, ok := parsed.str("customType"); ok {
		return value
	}
	return "custom"
}
