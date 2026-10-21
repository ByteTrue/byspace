package sdk

import "strings"

// canonicalToolName maps a provider's tool name onto the shared vocabulary.
//
// The detail mappers key on bash/read/edit/write/web_search/web_fetch/subagent, which is pi's naming.
// Claude calls the same tools `Bash`, `Read`, `Edit`, `WebFetch`, `WebSearch`, `Task`; passing those
// through unchanged made every Claude tool card render as "unknown" — the card was there, with no
// command, no file, no output.
//
// The mapping is explicit rather than a lowercase-and-strip pass: `Task` and `TaskCreate` both start with
// "task" and mean different things, and a provider that adds `Read2` must not silently become `Read`.
func canonicalToolName(toolName string) string {
	trimmed := strings.TrimSpace(toolName)
	if trimmed == "" {
		return ""
	}

	// Already canonical (pi and most providers).
	lower := strings.ToLower(trimmed)
	switch lower {
	case "bash", "read", "edit", "write", "web_search", "web_fetch", "subagent", "grep", "glob", "search":
		return lower
	}

	// Claude's names, which are capitalised and sometimes compressed (`WebFetch`, not `Web_Fetch`).
	if canonical, ok := claudeToolNames[lower]; ok {
		return canonical
	}

	if taskToolNames[strings.ToLower(trimmed)] {
		// The caller decides what to do — the task list is a separate view, not a file edit.
		return trimmed
	}

	// Unknown: keep the original so the card can at least show the tool's own name.
	return trimmed
}

// claudeToolNames maps Claude's tool names (lowercased) to the shared vocabulary.
var claudeToolNames = map[string]string{
	"bash":         "bash",
	"read":         "read",
	"edit":         "edit",
	"write":        "write",
	"notebookedit": "edit",
	"grep":         "grep",
	"glob":         "glob",
	"ls":           "read",
	// omp's spellings: `find` is a search, `execute` runs a command, and `xdev` is a wrapper whose real
	// tool name arrives in the result (ResolveOmpToolCallName unwraps it).
	"find":      "grep",
	"execute":   "bash",
	"xdev":      "bash",
	"webfetch":  "web_fetch",
	"websearch": "web_search",
	"task":      "subagent",
}

// taskToolNames are Claude's task-list tools.
//
// They are deliberately absent from claudeToolNames: mapping `TodoWrite` to `write` would claim it edited
// a file. They are surfaced as a task list instead (see agent/taskstate), which is what they are.
var taskToolNames = map[string]bool{
	"todowrite":  true,
	"taskcreate": true,
	"taskupdate": true,
	"tasklist":   true,
}
