package subagentlog

import (
	"strings"
	"testing"
)

// A delegated task runs for a minute; without the trace the parent card shows nothing until it ends.
func TestAppendBuildsALog(t *testing.T) {
	tracker := New()
	tracker.AppendTool("task_1", "Bash", "npm test")
	tracker.AppendTool("task_1", "Read", "/repo/src/index.ts")
	log := tracker.Log("task_1")
	if log != "[Bash] npm test\n[Read] /repo/src/index.ts" {
		t.Fatalf("log = %q", log)
	}
}

// Two concurrently running sub-agents keep separate logs.
func TestLogsArePerSubagent(t *testing.T) {
	tracker := New()
	tracker.AppendTool("a", "Bash", "one")
	tracker.AppendTool("b", "Bash", "two")
	if tracker.Log("a") != "[Bash] one" {
		t.Fatalf("a = %q", tracker.Log("a"))
	}
	if tracker.Log("b") != "[Bash] two" {
		t.Fatalf("b = %q", tracker.Log("b"))
	}
	if tracker.Log("missing") != "" {
		t.Fatalf("missing = %q", tracker.Log("missing"))
	}
}

// The bound keeps the tail, not the head: what the child is doing now matters, the first line of a long
// log does not.
func TestLogKeepsTheTail(t *testing.T) {
	tracker := New()
	tracker.SetMaxLines(3)
	for _, name := range []string{"one", "two", "three", "four", "five"} {
		tracker.AppendTool("task", "Bash", name)
	}
	lines := strings.Split(tracker.Log("task"), "\n")
	if len(lines) != 3 {
		t.Fatalf("lines = %d", len(lines))
	}
	if lines[len(lines)-1] != "[Bash] five" {
		t.Fatalf("last line = %q", lines[len(lines)-1])
	}
	if strings.Contains(tracker.Log("task"), "one") {
		t.Fatal("the head was kept instead of the tail")
	}
}

// The format is what the card renders; reproducing it by hand at each call site is how the two drift.
func TestFormatLine(t *testing.T) {
	if got := FormatLine("Bash", "  npm   test \n"); got != "[Bash] npm test" {
		t.Fatalf("got %q", got)
	}
	if got := FormatLine("Task", ""); got != "[Task]" {
		t.Fatalf("empty summary = %q", got)
	}
	if got := FormatLine("", "x"); got != "[tool] x" {
		t.Fatalf("empty name = %q", got)
	}
}

// An empty id is not a sub-agent; recording under "" would pool every unattributed line together.
func TestEmptyIDIsIgnored(t *testing.T) {
	tracker := New()
	if got := tracker.Append("", "line"); got != "" {
		t.Fatalf("got %q", got)
	}
	if got := tracker.Log(""); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestForgetAndReset(t *testing.T) {
	tracker := New()
	tracker.AppendTool("a", "Bash", "one")
	tracker.Forget("a")
	if tracker.Log("a") != "" {
		t.Fatal("forget did not drop the log")
	}

	tracker.AppendTool("a", "Bash", "one")
	tracker.Reset()
	if tracker.Log("a") != "" {
		t.Fatal("reset did not drop the logs")
	}
}
