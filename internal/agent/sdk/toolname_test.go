package sdk

import "testing"

// Claude's tool names are capitalised and sometimes compressed; passing them through unchanged made every
// Claude tool card render as "unknown" — the card was there, with no command, no file, no output.
func TestCanonicalToolName(t *testing.T) {
	cases := map[string]string{
		// Claude.
		"Bash":         "bash",
		"Read":         "read",
		"Edit":         "edit",
		"Write":        "write",
		"Grep":         "grep",
		"Glob":         "glob",
		"WebFetch":     "web_fetch",
		"WebSearch":    "web_search",
		"Task":         "subagent",
		"NotebookEdit": "edit",
		// Already canonical.
		"bash":       "bash",
		"web_search": "web_search",
		"subagent":   "subagent",
		// A task-list tool is not a file edit and stays under its own name.
		"TodoWrite":  "TodoWrite",
		"TaskCreate": "TaskCreate",
		// Unknown names are kept so the card can show the tool's own name.
		"SomeNewTool": "SomeNewTool",
		"":            "",
	}
	for input, want := range cases {
		if got := canonicalToolName(input); got != want {
			t.Fatalf("canonicalToolName(%q) = %q, want %q", input, got, want)
		}
	}
}

// End to end through the detail builder: the mapping only matters if it produces a real card.
func TestBuildToolCallDetailHandlesClaudeNames(t *testing.T) {
	shell := BuildToolCallDetail("Bash", map[string]any{"command": "ls -la"}, "total 0")
	if shell["type"] != "shell" || shell["command"] != "ls -la" {
		t.Fatalf("Bash = %+v", shell)
	}

	read := BuildToolCallDetail("Read", map[string]any{"file_path": "/tmp/a.go"}, "package a")
	if read["type"] != "read" {
		t.Fatalf("Read = %+v", read)
	}

	write := BuildToolCallDetail("Write", map[string]any{"file_path": "/tmp/b.go", "content": "x"}, nil)
	if write["type"] != "write" {
		t.Fatalf("Write = %+v", write)
	}

	edit := BuildToolCallDetail("Edit", map[string]any{
		"file_path": "/tmp/c.go", "old_string": "a", "new_string": "b",
	}, nil)
	if edit["type"] != "edit" {
		t.Fatalf("Edit = %+v", edit)
	}

	// A task-list tool is not a file write, so it stays non-canonical rather than claiming an edit.
	todo := BuildToolCallDetail("TodoWrite", map[string]any{"todos": []any{}}, nil)
	if todo["type"] == "write" || todo["type"] == "edit" {
		t.Fatalf("TodoWrite claimed a file edit: %+v", todo)
	}
}
