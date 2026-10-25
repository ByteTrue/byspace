// Package subagentlog keeps the activity log a delegated sub-agent shows in its parent's card.
//
// Ported from claude/sidechain-tracker.ts. Claude marks every message produced inside a sub-agent with the
// id of the Task call that spawned it. Go routed those to the Subagents panel, which shows the child as a
// row — but the parent's Task card stayed empty apart from the final result. The user watches a delegated
// task for a minute with no sign of what it is doing.
package subagentlog

import (
	"strings"
)

// Tracker accumulates logs for several sub-agents.
type Tracker struct {
	// logs holds the lines per parent tool-use id.
	logs map[string][]string
	// maxLines bounds a log. A long-running child can run hundreds of tools, and the whole log is
	// re-sent with every timeline update.
	maxLines int
}

// DefaultMaxLines is how many activity lines a sub-agent's log keeps.
//
// The tail, not the head: what the child is doing now is what the user wants to see, and the first line
// of a log that started ninety seconds ago is the least useful part of it.
const DefaultMaxLines = 40

// New builds a tracker.
func New() *Tracker {
	return &Tracker{logs: make(map[string][]string), maxLines: DefaultMaxLines}
}

// SetMaxLines overrides the bound. Tests use a small one.
func (t *Tracker) SetMaxLines(limit int) {
	if limit > 0 {
		t.maxLines = limit
	}
}

// Append records one activity line, returning the full log.
//
// The key is the parent's tool-use id, so two concurrently running sub-agents keep separate logs.
func (t *Tracker) Append(parentToolUseID, line string) string {
	parent := strings.TrimSpace(parentToolUseID)
	if parent == "" {
		return ""
	}
	trimmed := strings.TrimSpace(line)
	if trimmed != "" {
		entry := t.logs[parent]
		entry = append(entry, trimmed)
		if t.maxLines > 0 && len(entry) > t.maxLines {
			entry = entry[len(entry)-t.maxLines:]
		}
		t.logs[parent] = entry
	}
	return t.Log(parent)
}

// AppendTool records a tool call by its display name and summary.
//
// Formatted as `[Bash] npm test`: the name first so the trace scans as a list of actions, which is what the
// node implementation produces.
func (t *Tracker) AppendTool(parentToolUseID, toolName, summary string) string {
	return t.Append(parentToolUseID, FormatLine(toolName, summary))
}

// Log returns the accumulated log for one sub-agent.
func (t *Tracker) Log(parentToolUseID string) string {
	return strings.Join(t.logs[strings.TrimSpace(parentToolUseID)], "\n")
}

// Forget drops a sub-agent's log once its card no longer needs it.
func (t *Tracker) Forget(parentToolUseID string) {
	delete(t.logs, strings.TrimSpace(parentToolUseID))
}

// Reset drops everything.
func (t *Tracker) Reset() {
	t.logs = make(map[string][]string)
}

// FormatLine renders one line the way the card expects.
//
// Exported so a caller that already has a summary string does not have to reproduce the format.
func FormatLine(toolName, summary string) string {
	name := strings.TrimSpace(toolName)
	if name == "" {
		name = "tool"
	}
	normalized := strings.Join(strings.Fields(summary), " ")
	if normalized == "" {
		return "[" + name + "]"
	}
	return "[" + name + "] " + normalized
}
