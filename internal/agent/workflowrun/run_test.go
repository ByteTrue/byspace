package workflowrun

import "testing"

// Without parsing it the Subagents panel shows no row for a workflow that ran.
func TestParse(t *testing.T) {
	run := Parse(`{
		"runId": "wf_1", "summary": "audited 12 files", "workflowName": "audit",
		"status": "completed", "startTime": 1772368800000, "totalTokens": 12345,
		"defaultModel": "claude-opus-5", "result": {"ok": true}
	}`)
	if run == nil {
		t.Fatal("no run")
	}
	if run.RunID != "wf_1" || run.Description() != "audited 12 files" {
		t.Fatalf("run = %+v", run)
	}
	if run.StartedAt() != "2026-03-01T12:40:00Z" {
		t.Fatalf("startedAt = %q", run.StartedAt())
	}
	if FormatTokenCount(run.TotalTokens) != "12.3k tok" {
		t.Fatalf("tokens = %q", FormatTokenCount(run.TotalTokens))
	}
}

// The only required field is runId: a record without it cannot be linked to its tool card.
func TestParseRequiresRunID(t *testing.T) {
	for _, body := range []string{`{"summary":"no id"}`, `not json`, `["array"]`, `{}`} {
		if Parse(body) != nil {
			t.Fatalf("%q produced a run", body)
		}
	}
}

// Description falls back to the workflow's name.
func TestDescriptionFallback(t *testing.T) {
	run := Parse(`{"runId":"wf","workflowName":"audit","summary":"   "}`)
	if run.Description() != "audit" {
		t.Fatalf("description = %q", run.Description())
	}
	if Parse(`{"runId":"wf"}`).Description() != "" {
		t.Fatal("an empty record produced a description")
	}
}

// startTime is milliseconds; treating it as seconds puts the run in the year 57000, which sorts after everything and looks
// like a bug in the panel rather than in the parse.
func TestStartedAtUsesMilliseconds(t *testing.T) {
	run := Parse(`{"runId":"wf","startTime":1772368800000}`)
	got := run.StartedAt()
	if got == "" || got[:4] != "2026" {
		t.Fatalf("startedAt = %q", got)
	}

	// An absurd value is rejected rather than rendered as a date in the year 50000.
	if got := Parse(`{"runId":"wf","startTime":1e18}`).StartedAt(); got != "" {
		t.Fatalf("absurd startTime = %q", got)
	}
	if got := Parse(`{"runId":"wf"}`).StartedAt(); got != "" {
		t.Fatalf("missing startTime = %q", got)
	}
}

func TestFinishedAt(t *testing.T) {
	run := Parse(`{"runId":"wf","timestamp":"2026-03-01T12:40:00.500Z"}`)
	if got := run.FinishedAt(); got != "2026-03-01T12:40:00.5Z" {
		t.Fatalf("finishedAt = %q", got)
	}
	// A timestamp that is not an ISO instant is dropped rather than shown as-is.
	if got := Parse(`{"runId":"wf","timestamp":"yesterday"}`).FinishedAt(); got != "" {
		t.Fatalf("bad timestamp = %q", got)
	}
}

// A raw count is unreadable in a narrow row.
func TestFormatTokenCount(t *testing.T) {
	cases := map[int64]string{
		0:         "",
		999:       "999 tok",
		1000:      "1k tok",
		12345:     "12.3k tok",
		1_000_000: "1M tok",
		2_500_000: "2.5M tok",
	}
	for tokens, want := range cases {
		if got := FormatTokenCount(tokens); got != want {
			t.Fatalf("%d → %q, want %q", tokens, got, want)
		}
	}
}
