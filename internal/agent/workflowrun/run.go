// Package workflowrun parses a Claude workflow run record.
//
// Ported from claude/subagents/workflow-replay-source.ts. A workflow's run record is JSON with a `runId` that ties it to
// the tool card which launched it; without parsing it the Subagents panel shows no row for a workflow that ran, and the
// user has no way to tell a finished workflow from one that never started.
package workflowrun

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

// Run is one workflow run record.
type Run struct {
	RunID        string
	Timestamp    string
	Summary      string
	WorkflowName string
	Status       string
	// StartTime is a unix epoch in milliseconds, as the record writes it.
	StartTime    int64
	DefaultModel string
	TotalTokens  int64
	// Result is the run's payload, kept raw: what a workflow returns is up to the workflow.
	Result any
}

// Parse reads a run record, or returns nil when the document is not one.
//
// The only required field is `runId`: a record without it cannot be linked to its tool card, and a partially written
// record (the workflow may still be running) is still worth showing once the id is there.
func Parse(contents string) *Run {
	var parsed map[string]any
	if json.Unmarshal([]byte(contents), &parsed) != nil {
		return nil
	}
	runID, ok := readString(parsed["runId"])
	if !ok {
		return nil
	}
	run := &Run{RunID: runID}
	run.Timestamp = readOptionalString(parsed["timestamp"])
	run.Summary = readOptionalString(parsed["summary"])
	run.WorkflowName = readOptionalString(parsed["workflowName"])
	run.Status = readOptionalString(parsed["status"])
	run.DefaultModel = readOptionalString(parsed["defaultModel"])
	run.StartTime = readInt(parsed["startTime"])
	run.TotalTokens = readInt(parsed["totalTokens"])
	run.Result = parsed["result"]
	return run
}

// Description is what a row shows: the summary, else the workflow's name.
func (r *Run) Description() string {
	if trimmed := strings.TrimSpace(r.Summary); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(r.WorkflowName)
}

// StartedAt renders the run's start time as RFC3339, or "" when absent.
//
// A millisecond epoch rather than seconds: the record writes `startTime` in milliseconds, and treating it as seconds puts
// the run in the year 57000 — which sorts after everything and looks like a bug in the panel rather than in the parse.
func (r *Run) StartedAt() string {
	if r.StartTime <= 0 {
		return ""
	}
	rendered := time.UnixMilli(r.StartTime).UTC()
	if rendered.Year() < 1970 || rendered.Year() > 3000 {
		return ""
	}
	return rendered.Format(time.RFC3339Nano)
}

// FinishedAt returns the recorded timestamp when it is a usable ISO instant.
func (r *Run) FinishedAt() string {
	trimmed := strings.TrimSpace(r.Timestamp)
	if trimmed == "" {
		return ""
	}
	parsed, err := time.Parse(time.RFC3339Nano, trimmed)
	if err != nil {
		return ""
	}
	return parsed.UTC().Format(time.RFC3339Nano)
}

// readString returns a non-empty trimmed string.
func readString(value any) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	trimmed := strings.TrimSpace(text)
	return trimmed, trimmed != ""
}

// readOptionalString returns a trimmed string or "".
func readOptionalString(value any) string {
	text, _ := readString(value)
	return text
}

// readInt reads a JSON number as an integer.
//
// json.Unmarshal yields float64, and a large epoch loses precision only past 2^53, which a millisecond timestamp is not.
// NaN and infinity are rejected: they arrive from a malformed record and would render as a date far outside any range.
func readInt(value any) int64 {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
		return 0
	}
	if number < -9e18 || number > 9e18 {
		return 0
	}
	return int64(number)
}

// FormatTokenCount renders a token total the way the panel shows it.
//
// Ported from the presentation rule: a raw count is unreadable in a narrow row, and `12.3k` is both shorter and easier to
// compare between runs.
func FormatTokenCount(tokens int64) string {
	if tokens <= 0 {
		return ""
	}
	if tokens < 1000 {
		return strconv.FormatInt(tokens, 10) + " tok"
	}
	if tokens < 1_000_000 {
		return trimDecimal(float64(tokens)/1000) + "k tok"
	}
	return trimDecimal(float64(tokens)/1_000_000) + "M tok"
}

// trimDecimal renders one decimal place, dropping a trailing `.0`.
func trimDecimal(value float64) string {
	rendered := strconv.FormatFloat(value, 'f', 1, 64)
	return strings.TrimSuffix(rendered, ".0")
}
