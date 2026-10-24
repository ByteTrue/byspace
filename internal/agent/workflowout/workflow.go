// Package workflowout reads the result file a Claude workflow leaves behind.
//
// Ported from claude/subagents/workflow-output.ts. A Claude workflow writes its result to a file and reports the path; the
// transcript then has a tool card pointing at a path and nothing that shows what the workflow concluded. Without this the
// user has to open the file themselves to learn whether the run succeeded.
package workflowout

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const (
	// MaxBytes bounds what is read. A workflow can write a very large result, and the whole file would be pulled into
	// memory to render one card.
	MaxBytes = 1024 * 1024
	// MaxResultChars bounds what is shown. Beyond this a result stops being readable and starts being a wall.
	MaxResultChars = 100_000
	// unwrapDepth bounds the single-value unwrapping: a pathological nesting would otherwise loop.
	unwrapDepth = 8
)

// ReadResultFile reads and formats a workflow's result file.
//
// Returns false for a missing file, one over the size bound, malformed JSON, or an object without a `result` key — all of
// which mean "there is nothing to show", and each is a real case: the file is written by another process that may still
// be writing, and a workflow's own failure can leave a partial file.
func ReadResultFile(path string) (string, bool) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", false
	}

	file, err := os.Open(trimmed)
	if err != nil {
		return "", false
	}
	defer file.Close()

	// Read one byte past the bound so an oversized file can be told apart from one that fits exactly.
	buffer := make([]byte, MaxBytes+1)
	read := 0
	for read < len(buffer) {
		count, readErr := file.Read(buffer[read:])
		if count > 0 {
			read += count
		}
		if readErr != nil {
			break
		}
	}
	if read > MaxBytes {
		return "", false
	}
	return Parse(string(buffer[:read]))
}

// Parse formats a workflow result document.
func Parse(contents string) (string, bool) {
	if len(contents) > MaxBytes {
		return "", false
	}
	var parsed any
	if json.Unmarshal([]byte(contents), &parsed) != nil {
		return "", false
	}
	record, ok := parsed.(map[string]any)
	if !ok {
		return "", false
	}
	result, ok := record["result"]
	if !ok {
		return "", false
	}
	return Format(result)
}

// Format renders a workflow result as text.
//
// A string is the result; a number or bool is its literal; anything else is JSON in a fenced block, which is what makes a
// structured result readable rather than one long line.
func Format(result any) (string, bool) {
	unwrapped := unwrapSingleValue(result)

	var text string
	switch typed := unwrapped.(type) {
	case string:
		text = strings.TrimSpace(typed)
	case float64:
		text = formatNumber(typed)
	case bool:
		if typed {
			text = "true"
		} else {
			text = "false"
		}
	case nil:
		return "", false
	default:
		encoded, err := json.MarshalIndent(unwrapped, "", "  ")
		if err != nil {
			return "", false
		}
		text = "```json\n" + string(encoded) + "\n```"
	}
	if text == "" {
		return "", false
	}
	if len(text) <= MaxResultChars {
		return text, true
	}
	return text[:MaxResultChars] + "\n\n…", true
}

// unwrapSingleValue peels `{a: {b: value}}` down to the value.
//
// A workflow that returns one field wraps it, and showing `{"output": "the answer"}` instead of "the answer" is worse than
// showing nothing. The depth bound stops a self-referential structure from looping.
func unwrapSingleValue(value any) any {
	current := value
	for depth := 0; depth < unwrapDepth; depth++ {
		record, ok := current.(map[string]any)
		if !ok || len(record) != 1 {
			return current
		}
		for _, inner := range record {
			current = inner
		}
	}
	return current
}

// formatNumber renders a JSON number without a trailing `.0`.
//
// json.Unmarshal turns every number into float64, so an integer result would otherwise show as "42.000000".
func formatNumber(value float64) string {
	if value == float64(int64(value)) {
		return fmt.Sprintf("%d", int64(value))
	}
	return fmt.Sprintf("%v", value)
}
