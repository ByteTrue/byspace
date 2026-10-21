package sdk

import "regexp"

// System envelope markers, ported from agent-prompt.ts.
//
// BySpace injects prompts on its own behalf — a chat mention, a schedule firing, a
// notify-on-finish ping. Those arrive as user messages at the provider, but they are not
// something the human said, and showing them as a user bubble makes the transcript lie about
// who asked for what. Wrapping them in a tagged envelope lets the daemon strip them from the
// timeline while the provider still receives plain text.
const (
	SystemEnvelopeOpen  = "<byspace-system>"
	SystemEnvelopeClose = "</byspace-system>"
)

var systemEnvelopePattern = regexp.MustCompile(`(?s)^<byspace-system>\n.*\n</byspace-system>$`)

// FormatSystemNotificationPrompt wraps a body so the receiving agent recognises it as
// system-injected context rather than a user turn.
func FormatSystemNotificationPrompt(reason string) string {
	return SystemEnvelopeOpen + "\n" + reason + "\n" + SystemEnvelopeClose
}

// IsSystemInjectedEnvelope reports whether a message body is a system envelope.
//
// The match is anchored and requires the exact newline layout FormatSystemNotificationPrompt
// produces, so a user who types the tag by hand is not silently hidden from their own
// transcript.
func IsSystemInjectedEnvelope(text string) bool {
	return systemEnvelopePattern.MatchString(text)
}

// ToolCallContentMaxLength bounds one tool result, in characters.
//
// Ported from agent-timeline-content.ts. A tool can print megabytes (`cat` on a big file, a
// failing build); the row rides along on every timeline fetch and durable store write, so an
// unbounded one turns every later refresh into a multi-megabyte transfer.
const ToolCallContentMaxLength = 64 * 1024

// LimitTimelineItemContent truncates oversized tool output.
//
// Applied at the boundary where a timeline row leaves the provider, so the store and every
// later fetch carry the bounded version. The prefix is kept rather than the tail: a command's
// first output usually says what it was doing, and the failure message of a shell result is its
// tail, which is handled separately.
func LimitTimelineItemContent(item TimelineItem) TimelineItem {
	if item.Type != "tool_call" {
		return item
	}
	detail, ok := item.Detail.(map[string]any)
	if !ok {
		return item
	}
	kind, _ := detail["type"].(string)

	switch kind {
	case "shell":
		if output, ok := detail["output"].(string); ok && len(output) > ToolCallContentMaxLength {
			detail["output"] = output[:ToolCallContentMaxLength]
		}
		// A failed shell result is read for its error text, which lives at the end.
		if item.Status == "failed" {
			if errMap, ok := item.Error.(map[string]any); ok {
				if content, ok := errMap["content"].(string); ok && len(content) > ToolCallContentMaxLength {
					errMap["content"] = content[:ToolCallContentMaxLength]
				}
			}
		}
	case "plain_text":
		if text, ok := detail["text"].(string); ok && len(text) > ToolCallContentMaxLength {
			detail["text"] = text[:ToolCallContentMaxLength]
		}
	}
	return item
}
