package activity

import (
	"encoding/json"
	"unicode/utf8"
)

// Limits on what a timeline item may carry.
//
// Ported from agent-timeline-content.ts. A tool call's output is whatever the command printed — a
// build log, a minified bundle, a `cat` of a large file — and it travels to every connected client
// on every timeline fetch. Without a cap, one `cat` of a 5 MB file multiplies by client count.
const (
	// ToolCallContentMaxLength bounds shell output, plain text, and failed-shell error content.
	ToolCallContentMaxLength = 64 * 1024
	// PluginTimelineDataMaxBytes bounds a plugin's free-form data payload.
	PluginTimelineDataMaxBytes = 64 * 1024
)

// LimitTimelineDetails drops a details payload that is too large.
//
// Dropped rather than truncated: the field is free-form JSON whose structure the daemon does not
// know, so a byte-level truncation would produce invalid JSON. Dropping the whole field is the
// honest outcome — the item still carries its name and status.
func LimitTimelineDetails(details any) any {
	if details == nil {
		return nil
	}
	encoded, err := json.Marshal(details)
	if err != nil {
		return details
	}
	if len(encoded) > PluginTimelineDataMaxBytes {
		return nil
	}
	return details
}

// AssertPluginTimelineDataSize reports an oversized plugin payload.
func AssertPluginTimelineDataSize(data any) error {
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if len(encoded) > PluginTimelineDataMaxBytes {
		return errPluginDataTooLarge
	}
	return nil
}

// errPluginDataTooLarge is returned by AssertPluginTimelineDataSize.
var errPluginDataTooLarge = &oversizedError{}

type oversizedError struct{}

func (*oversizedError) Error() string {
	return "plugin timeline item data exceeds the size limit"
}

// LimitTimelineItemContent caps the fields of a tool call item that can be arbitrarily large.
//
// Three fields, each with its own reason for existing:
//
//   - A failed shell call's error content is the command's stderr, which is where a failing build
//     puts everything.
//   - A plain_text detail is a label the tool chose; a tool that pastes a file into it would
//     otherwise send the file.
//   - A shell call's output is the command's stdout, the common case and the largest one.
//
// Truncating rather than dropping: unlike `details`, these are strings whose prefix is the useful
// part, and the user is looking at them.
func LimitTimelineItemContent(item map[string]any) map[string]any {
	if item["type"] != "tool_call" {
		return item
	}
	detail, ok := item["detail"].(map[string]any)
	if !ok {
		return item
	}

	// A failed shell call carries its stderr in error.content.
	if detail["type"] == "shell" && item["status"] == "failed" {
		if record, ok := item["error"].(map[string]any); ok {
			if content, ok := record["content"].(string); ok && len(content) > ToolCallContentMaxLength {
				trimmed := *recordCopy(record)
				trimmed["content"] = truncateRunes(content, ToolCallContentMaxLength)
				item["error"] = trimmed
			}
		}
	}

	// A plain_text detail's text is a label; a tool can put anything there.
	if detail["type"] == "plain_text" {
		if text, ok := detail["text"].(string); ok && len(text) > ToolCallContentMaxLength {
			replaced := *detailCopy(detail)
			replaced["text"] = truncateRunes(text, ToolCallContentMaxLength)
			item["detail"] = replaced
		}
	}

	// A shell call's output is the command's stdout.
	if detail["type"] == "shell" {
		if output, ok := detail["output"].(string); ok && len(output) > ToolCallContentMaxLength {
			replaced := *detailCopy(detail)
			replaced["output"] = truncateRunes(output, ToolCallContentMaxLength)
			item["detail"] = replaced
		}
	}
	return item
}

// recordCopy copies a map so the original is not mutated.
func recordCopy(source map[string]any) *map[string]any {
	copied := make(map[string]any, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return &copied
}

// detailCopy copies a detail map so the original is not mutated.
func detailCopy(source map[string]any) *map[string]any {
	return recordCopy(source)
}

// truncateRunes cuts a string to at most n bytes without splitting a character.
//
// Byte slicing a UTF-8 string produces a replacement character at the boundary, which shows up as
// mojibake in the terminal card. The limit is a byte budget because that is what the wire cares
// about, so the cut walks back to the previous rune boundary.
func truncateRunes(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut]
}
