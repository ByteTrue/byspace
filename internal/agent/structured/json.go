// Package structured asks a model for JSON that satisfies a schema, retrying on failure.
//
// Ported from server/agent/agent-response-loop.ts. Two things live here that the Go daemon was
// missing: extracting JSON from a reply that has prose or a markdown fence around it, and retrying
// with the validation errors fed back.
package structured

import (
	"encoding/json"
	"strings"
)

// ExtractJSON pulls the JSON payload out of a model reply.
//
// Models wrap the answer in a fenced block, prepend an explanation, or append a summary. All three
// are common and none is worth failing over, so the order is: a fenced block, then the first
// balanced object or array, then the trimmed text.
func ExtractJSON(text string) string {
	if fenced := extractFenced(text); fenced != "" {
		return fenced
	}
	if snippet := extractFirstSnippet(text); snippet != "" {
		return snippet
	}
	return strings.TrimSpace(text)
}

// extractFenced reads the body of the first ```json (or bare ```) block.
func extractFenced(text string) string {
	// Find the opening fence, then its closing fence. A hand-written scanner rather than a regex:
	// the body can itself contain ``` inside a JSON string, and a greedy regex would swallow past
	// the real close.
	index := 0
	for {
		open := strings.Index(text[index:], "```")
		if open < 0 {
			return ""
		}
		open += index
		bodyStart := open + 3
		// Skip an optional language tag on the same line.
		if newline := strings.IndexByte(text[bodyStart:], '\n'); newline >= 0 {
			tag := strings.TrimSpace(text[bodyStart : bodyStart+newline])
			if tag == "" || strings.EqualFold(tag, "json") || strings.EqualFold(tag, "jsonc") {
				bodyStart += newline + 1
			} else {
				// A fence for some other language: keep looking for another block.
				index = open + 3
				continue
			}
		} else {
			return ""
		}
		close := strings.Index(text[bodyStart:], "```")
		if close < 0 {
			return ""
		}
		return strings.TrimSpace(text[bodyStart : bodyStart+close])
	}
}

// extractFirstSnippet returns the first balanced JSON object or array that parses.
//
// A model that adds "Here is the result:" before the JSON, or a trailing "Let me know if…", still
// produced usable JSON; failing on the wrapper would waste the turn.
func extractFirstSnippet(text string) string {
	source := strings.TrimSpace(text)
	if source == "" {
		return ""
	}
	for index := 0; index < len(source); index++ {
		if source[index] != '{' && source[index] != '[' {
			continue
		}
		if candidate := balancedCandidate(source, index); candidate != "" {
			return candidate
		}
	}
	return ""
}

// balancedCandidate slices a balanced object/array starting at `start` and checks it parses.
func balancedCandidate(source string, start int) string {
	open := source[start]
	closeBrace := byte('}')
	if open == '[' {
		closeBrace = ']'
	}

	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(source); index++ {
		ch := source[index]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = false
			}
			continue
		}
		if ch == '"' {
			inString = true
			continue
		}
		if ch == open {
			depth++
			continue
		}
		if ch != closeBrace {
			continue
		}
		depth--
		if depth != 0 {
			continue
		}
		candidate := strings.TrimSpace(source[start : index+1])
		var throwaway any
		if json.Unmarshal([]byte(candidate), &throwaway) == nil {
			return candidate
		}
		// This start index produced something that is not JSON (an unbalanced brace inside a
		// sentence, say). Let the caller try the next one.
		return ""
	}
	return ""
}
