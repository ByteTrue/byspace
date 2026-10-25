// Package tasknotify renders Claude's background-task notification as a tool card.
//
// Ported from claude/task-notification-tool-call.ts. Claude reports a background task's completion as a USER message
// whose content is a `<task-notification>` envelope, not a tool result. Go skipped it as ordinary user content, so a
// task the user launched in the background finished without a trace: the transcript simply stopped.
package tasknotify

import (
	"crypto/sha1"
	"encoding/hex"
	"regexp"
	"strings"
)

// Marker is the envelope's opening tag.
const Marker = "<task-notification>"

// envelopeTag is one tag name and the field it fills.
//
// Per-name patterns rather than one pattern with a backreference: Go's regexp is RE2, which has no backreferences, and
// the field set is fixed and small — a generic matcher would need a hand-written parser for no gain.
type envelopeTag struct {
	pattern *regexp.Regexp
	field   string
}

var envelopeTags = []envelopeTag{
	{regexp.MustCompile(`(?is)<task[-_]id>(.*?)</task[-_]id>`), "taskId"},
	{regexp.MustCompile(`(?is)<tool[-_]use[-_]id>(.*?)</tool[-_]use[-_]id>`), "toolUseId"},
	{regexp.MustCompile(`(?is)<status>(.*?)</status>`), "status"},
	{regexp.MustCompile(`(?is)<summary>(.*?)</summary>`), "summary"},
	{regexp.MustCompile(`(?is)<output[-_]file>(.*?)</output[-_]file>`), "outputFile"},
}

// Envelope is what a notification carries.
type Envelope struct {
	TaskID     string
	ToolUseID  string
	Status     string
	Summary    string
	OutputFile string
	// RawText is the whole envelope, shown as the card's body when nothing more specific exists.
	RawText string
}

// Card is the tool-call item an envelope becomes.
type Card struct {
	CallID   string
	Name     string
	Status   string
	Detail   map[string]any
	Metadata map[string]any
	// Error is the failure message for a failed task.
	Error any
}

// IsNotification reports whether content is a task notification.
//
// Handles both shapes a user message takes: a plain string and an array of text blocks. Checking only the string case
// would miss the array form, which is what a message with an image or a formatted block uses.
func IsNotification(content any) bool {
	switch typed := content.(type) {
	case string:
		return strings.Contains(typed, Marker)
	case []any:
		for _, block := range typed {
			record, ok := block.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := record["text"].(string); ok && strings.Contains(text, Marker) {
				return true
			}
		}
	}
	return false
}

// ExtractedContent returns the text of a notification message.
func ExtractedContent(content any) string {
	switch typed := content.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, block := range typed {
			record, ok := block.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := record["text"].(string); ok && text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

// Map renders a task notification, or returns nil when the content is not one.
func Map(content any) *Card {
	if !IsNotification(content) {
		return nil
	}
	raw := ExtractedContent(content)
	envelope := parseEnvelope(raw)

	status, errMessage := lifecycle(envelope.Status, envelope.Summary)
	detailText := firstNonEmpty(envelope.RawText, envelope.Summary)

	detail := map[string]any{
		"type":  "plain_text",
		"label": labelFor(envelope),
		"icon":  "wrench",
	}
	if detailText != "" {
		detail["text"] = detailText
	}

	metadata := map[string]any{
		// `synthetic` marks a card that stands for a message rather than a tool execution.
		"synthetic": true,
		"source":    "claude_task_notification",
	}
	if envelope.TaskID != "" {
		metadata["taskId"] = envelope.TaskID
	}
	if envelope.ToolUseID != "" {
		metadata["toolUseId"] = envelope.ToolUseID
	}
	if envelope.Status != "" {
		metadata["status"] = envelope.Status
	}
	if envelope.OutputFile != "" {
		metadata["outputFile"] = envelope.OutputFile
	}

	card := &Card{
		CallID:   callID(envelope),
		Name:     "task_notification",
		Status:   status,
		Detail:   detail,
		Metadata: metadata,
	}
	if status == "failed" {
		card.Error = map[string]any{"message": errMessage}
	}
	return card
}

// parseEnvelope reads the tags inside the notification.
//
// Tag order does not matter and unknown tags are ignored: the envelope is written by a harness whose field set can
// grow, and requiring an exact shape would drop the notification entirely when it does.
func parseEnvelope(raw string) Envelope {
	envelope := Envelope{RawText: strings.TrimSpace(raw)}
	for _, tag := range envelopeTags {
		match := tag.pattern.FindStringSubmatch(raw)
		if match == nil {
			// An empty tag value is not a value: `<status></status>` says nothing.
			continue
		}
		value := strings.TrimSpace(match[1])
		if value == "" {
			continue
		}
		switch tag.field {
		case "taskId":
			envelope.TaskID = value
		case "toolUseId":
			envelope.ToolUseID = value
		case "status":
			envelope.Status = value
		case "summary":
			envelope.Summary = value
		case "outputFile":
			envelope.OutputFile = value
		}
	}
	return envelope
}

// lifecycle maps a status to the card's status and its error message.
func lifecycle(status, summary string) (string, string) {
	switch strings.ToLower(status) {
	case "failed", "error":
		if summary != "" {
			return "failed", summary
		}
		return "failed", "Background task failed"
	case "canceled", "cancelled":
		return "canceled", ""
	}
	return "completed", ""
}

// labelFor builds the card's title.
func labelFor(envelope Envelope) string {
	if envelope.Summary != "" {
		return envelope.Summary
	}
	if envelope.Status != "" {
		return "Background task " + strings.ToLower(envelope.Status)
	}
	return "Background task notification"
}

// callID derives a stable id for the card.
//
// The task id when there is one, otherwise a digest of the envelope: a random id would duplicate the card on every
// reload, because the transcript is replayed each time the agent is loaded.
func callID(envelope Envelope) string {
	if envelope.TaskID != "" {
		return "task_notification_" + envelope.TaskID
	}
	seed := strings.Join([]string{envelope.Status, envelope.Summary, envelope.OutputFile, envelope.RawText}, "|")
	if seed == "" {
		seed = "task_notification"
	}
	digest := sha1.Sum([]byte(seed))
	return "task_notification_" + hex.EncodeToString(digest[:])[:12]
}

// firstNonEmpty returns the first non-empty trimmed string.
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
