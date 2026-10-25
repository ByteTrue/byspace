// Package systemnotice renders omp's system notices as timeline notifications.
//
// Ported from omp/system-notice.ts. omp wraps harness messages — a background job finishing, a task result — in
// `<system-notice>` and `<task-result …>` envelopes. Without parsing them the model's own harness messages reach the
// transcript as raw XML, or are skipped as custom messages: either way the user never learns that the background
// job they started has finished.
package systemnotice

import (
	"regexp"
	"strings"
)

const (
	openTag  = "<system-notice>"
	closeTag = "</system-notice>"
)

var (
	// taskResultTag matches the opening tag and captures its attribute string.
	taskResultTag = regexp.MustCompile(`(?i)<task-result\b([^>]*)>`)
	// taskResultAttribute reads `name="value"` pairs. The quote class includes typographic quotes: transcripts
	// that went through a copy/paste round trip carry them, and refusing those loses the task id.
	taskResultAttribute = regexp.MustCompile(`([\w-]+)=["'“”‘’]([^"'“”‘’]*)["'”’]`)
)

// Notification is one `notification` timeline item.
type Notification struct {
	Level   string
	Message string
}

// taskResult is the summary carried by a `<task-result>` tag.
type taskResult struct {
	ID     string
	Agent  string
	Status string
}

// IsSystemNotice reports whether text starts with the notice envelope.
//
// The check trims leading space: a harness that indents the tag still emits a notice, and failing to recognise it
// means the raw XML shows up in the transcript.
func IsSystemNotice(text string) bool {
	return strings.HasPrefix(strings.TrimLeft(text, " \t\r\n"), openTag)
}

// Map renders a system notice, or returns nil when the text is not one.
func Map(text string) *Notification {
	if !IsSystemNotice(text) {
		return nil
	}
	result := readTaskResult(text)
	return &Notification{
		Level:   levelFor(result),
		Message: labelFor(result, text),
	}
}

// readTaskResult reads the task-result tag's attributes.
func readTaskResult(text string) *taskResult {
	tag := taskResultTag.FindStringSubmatch(text)
	if tag == nil {
		return nil
	}
	attributes := make(map[string]string, 4)
	for _, match := range taskResultAttribute.FindAllStringSubmatch(tag[1], -1) {
		if match[1] != "" {
			attributes[match[1]] = strings.TrimSpace(match[2])
		}
	}
	if len(attributes) == 0 {
		return nil
	}
	return &taskResult{
		ID:     attributes["id"],
		Agent:  attributes["agent"],
		Status: attributes["status"],
	}
}

// levelFor picks the notification level from the task's status.
//
// Three levels rather than two: a cancelled job is not an error (nothing failed) and not info either (the user's work
// stopped), and the client colours warning differently from both.
func levelFor(result *taskResult) string {
	if result == nil {
		return "info"
	}
	switch strings.ToLower(result.Status) {
	case "failed", "error":
		return "error"
	case "canceled", "cancelled", "stopped":
		return "warning"
	}
	return "info"
}

// labelFor builds the one-line message.
//
// A task result names the job and what happened to it; anything else falls back to the notice body's first real line,
// which is what a plain harness message contains.
func labelFor(result *taskResult, text string) string {
	if result != nil && result.ID != "" {
		status := result.Status
		if status == "" {
			status = "completed"
		}
		return "Background job " + result.ID + " " + status
	}
	if first := noticeFirstLine(text); first != "" {
		return first
	}
	return "System notice"
}

// noticeFirstLine returns the first line of the envelope body that is not itself a tag.
//
// Skipping lines that start with `<` is what keeps a nested `<task-result …>` from becoming the message: the user needs
// the sentence, not the markup.
func noticeFirstLine(text string) string {
	start := strings.Index(text, openTag)
	if start < 0 {
		return ""
	}
	body := text[start+len(openTag):]
	if end := strings.Index(body, closeTag); end >= 0 {
		body = body[:end]
	}
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" && !strings.HasPrefix(trimmed, "<") {
			return trimmed
		}
	}
	return ""
}
