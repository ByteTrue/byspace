// Package agenttitle derives the titles a new agent gets.
//
// Ported from create-agent-title.ts and agent-title-limits.ts. Two different titles come out of a
// create request: the explicit one the client asked for, and a provisional one derived from the
// first line of the prompt. The provisional title is what the sidebar shows until the agent produces
// something better, so a long prompt must not become a wall of text in a narrow row.
package agenttitle

import "strings"

// MaxExplicitChars is the longest title a client may set.
const MaxExplicitChars = 200

// MaxInitialChars is the longest derived title.
//
// 60 rather than the explicit limit: the derived title goes in a sidebar row, and 200 characters
// there is a paragraph.
const MaxInitialChars = 60

// Titles are the two a create request produces.
type Titles struct {
	// Explicit is the client's own title, trimmed and clamped, or "" when it gave none.
	Explicit string
	// Provisional is derived from the prompt, or "" when the prompt has no content.
	Provisional string
}

// Resolve derives both titles.
//
// Ported from resolveCreateAgentTitles. An explicit title suppresses the provisional one: the client
// already decided what the agent is called, and a derived title would overwrite that decision on the
// next rename.
func Resolve(configTitle string, initialPrompt string) Titles {
	explicit := strings.TrimSpace(configTitle)
	if explicit != "" {
		explicit = clamp(explicit, MaxExplicitChars)
	}
	return Titles{Explicit: explicit, Provisional: deriveInitial(initialPrompt)}
}

// deriveInitial builds a title from the first non-empty line of a prompt.
//
// The first *content* line, not the first line: a prompt that opens with a blank line or a heading
// marker would otherwise produce an empty title.
func deriveInitial(prompt string) string {
	for _, line := range strings.Split(strings.ReplaceAll(prompt, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		// Collapse internal whitespace: a line with tabs becomes one readable string.
		normalized := strings.Join(strings.Fields(trimmed), " ")
		if normalized == "" {
			return ""
		}
		clamped := strings.TrimSpace(clamp(normalized, MaxInitialChars))
		if clamped == "" {
			return ""
		}
		return clamped
	}
	return ""
}

// clamp cuts a string to at most n characters without splitting one.
//
// Characters, not bytes: a title of Chinese costs three bytes each, and a byte limit would cut it to
// a third of the intended length. The wire limit is characters for the same reason.
func clamp(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}

// ClampExplicit enforces the explicit-title limit on a rename.
//
// Exported because a rename has to apply the same limit the create path does; two different limits
// would let a rename produce a title that the create path would have refused.
func ClampExplicit(title string) string {
	return clamp(strings.TrimSpace(title), MaxExplicitChars)
}
