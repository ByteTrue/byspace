// Package advisor renders an omp advisor message as a review card.
//
// Ported from omp/advisor-message.ts. omp's advisor is a second model reviewing the first one's work; its
// output arrives as a custom message with a list of notes, each carrying a severity and sometimes the
// advisor's name. Without this the review is invisible: the message is `role: "custom"`, which the history
// mapper skips precisely because it has no user-facing role.
package advisor

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
)

// Severities an advisor note can carry.
const (
	SeverityNit     = "nit"
	SeverityConcern = "concern"
	SeverityBlocker = "blocker"
)

// Note is one advisor remark.
type Note struct {
	Note     string `json:"note"`
	Severity string `json:"severity,omitempty"`
	Advisor  string `json:"advisor,omitempty"`
}

// Card is the tool-call item an advisor message becomes.
type Card struct {
	CallID   string         `json:"callId"`
	Name     string         `json:"name"`
	Status   string         `json:"status"`
	Detail   map[string]any `json:"detail"`
	Metadata map[string]any `json:"metadata"`
}

// MapMessage renders an advisor custom message, or nil when the message is not one.
//
// The customType check is what keeps every other custom message out: they are skipped elsewhere, and
// rendering one here would attribute it to the advisor.
func MapMessage(customType string, text string, details map[string]any) *Card {
	if !strings.EqualFold(strings.TrimSpace(customType), "advisor") {
		return nil
	}

	notes := readNotes(details)
	blockers := 0
	for _, note := range notes {
		if note.Severity == SeverityBlocker {
			blockers++
		}
	}

	body := strings.TrimSpace(text)
	if len(notes) > 0 {
		formatted := make([]string, 0, len(notes))
		for _, note := range notes {
			formatted = append(formatted, formatNote(note))
		}
		body = strings.Join(formatted, "\n\n")
	}

	return &Card{
		CallID: buildCallID(details, text),
		Name:   "advisor",
		Status: "completed",
		Detail: map[string]any{
			"type":  "plain_text",
			"label": buildLabel(len(notes), blockers),
			"text":  body,
			"icon":  "brain",
		},
		Metadata: map[string]any{
			// `synthetic` marks a card that stands for a message rather than a tool execution; the client
			// uses it to avoid offering the tool-specific actions.
			"synthetic":    true,
			"source":       "omp_advisor",
			"noteCount":    len(notes),
			"blockerCount": blockers,
		},
	}
}

// readNotes reads the note list out of a message's details.
//
// A note without text is dropped rather than rendered blank: the card's value is the text, and a bullet with
// nothing after it reads as a bug in the advisor.
func readNotes(details map[string]any) []Note {
	if details == nil {
		return nil
	}
	raw, ok := details["notes"].([]any)
	if !ok {
		return nil
	}
	out := make([]Note, 0, len(raw))
	for _, value := range raw {
		record, ok := value.(map[string]any)
		if !ok {
			continue
		}
		note := Note{
			Note:     optionalString(record["note"]),
			Severity: normalizeSeverity(record["severity"]),
			Advisor:  optionalString(record["advisor"]),
		}
		if note.Note == "" {
			continue
		}
		out = append(out, note)
	}
	return out
}

// normalizeSeverity keeps a recognised severity and drops anything else.
//
// An unknown severity is dropped rather than passed through: the client renders `[blocker]` in a warning
// colour by looking the value up, and an unrecognised one would render as a plain label that looks like part
// of the note's text.
func normalizeSeverity(value any) string {
	text, _ := value.(string)
	switch strings.TrimSpace(text) {
	case SeverityNit:
		return SeverityNit
	case SeverityConcern:
		return SeverityConcern
	case SeverityBlocker:
		return SeverityBlocker
	}
	return ""
}

// formatNote renders one note with its severity and advisor as prefixes.
func formatNote(note Note) string {
	prefixes := make([]string, 0, 2)
	if note.Severity != "" {
		prefixes = append(prefixes, "["+note.Severity+"]")
	}
	if note.Advisor != "" {
		prefixes = append(prefixes, "["+note.Advisor+"]")
	}
	if len(prefixes) == 0 {
		return note.Note
	}
	return strings.Join(prefixes, " ") + " " + note.Note
}

// buildLabel summarises the note count, and the blocker count when there is one.
func buildLabel(noteCount, blockerCount int) string {
	if noteCount == 0 {
		// No notes yet: the card is a placeholder until the advisor writes something, and a count of zero
		// reads as an empty review rather than a pending one.
		return "Advisor"
	}
	label := fmt.Sprintf("Advisor · %d %s", noteCount, plural(noteCount, "note", "notes"))
	if blockerCount > 0 {
		label += fmt.Sprintf(" · %d %s", blockerCount, plural(blockerCount, "blocker", "blockers"))
	}
	return label
}

// plural picks the singular or plural word.
func plural(count int, singular, pluralForm string) string {
	if count == 1 {
		return singular
	}
	return pluralForm
}

// buildCallID derives a stable id for the card.
//
// The message id when there is one, otherwise a digest of the text: the card's id has to be stable across a
// reload, and a random one would duplicate the card every time the session is re-read.
func buildCallID(details map[string]any, text string) string {
	if id := optionalString(details["id"]); id != "" {
		return "omp-advisor:" + id
	}
	digest := sha1.Sum([]byte(strings.TrimSpace(text)))
	return "omp-advisor:" + hex.EncodeToString(digest[:])[:12]
}

// optionalString returns a trimmed non-empty string.
func optionalString(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}
