package systemnotice

import "testing"

// Without parsing these the harness's own messages reach the transcript as raw XML, or are skipped as custom
// messages: either way the user never learns the background job finished.
func TestMapTaskResult(t *testing.T) {
	text := "<system-notice>\n<task-result id=\"7\" agent=\"explore\" status=\"failed\">\n</system-notice>"
	got := Map(text)
	if got == nil {
		t.Fatal("no notification")
	}
	if got.Level != "error" {
		t.Fatalf("level = %q", got.Level)
	}
	if got.Message != "Background job 7 failed" {
		t.Fatalf("message = %q", got.Message)
	}
}

// Three levels: a cancelled job is not an error (nothing failed) and not info either (the user's work stopped).
func TestLevels(t *testing.T) {
	cases := map[string]string{
		"failed":    "error",
		"error":     "error",
		"canceled":  "warning",
		"cancelled": "warning",
		"stopped":   "warning",
		"completed": "info",
		"":          "info",
	}
	for status, want := range cases {
		text := "<system-notice>\n<task-result id=\"1\" status=\"" + status + "\">\n</system-notice>"
		if got := Map(text); got.Level != want {
			t.Fatalf("status %q → %q, want %q", status, got.Level, want)
		}
	}
}

// A plain harness message has no task-result: the message is its first real line.
func TestPlainNoticeUsesFirstLine(t *testing.T) {
	text := "<system-notice>\n\n  The index finished building.  \nmore detail\n</system-notice>"
	got := Map(text)
	if got.Level != "info" || got.Message != "The index finished building." {
		t.Fatalf("got %+v", got)
	}
}

// A nested tag must not become the message: the user needs the sentence, not the markup.
func TestNoticeSkipsTagLines(t *testing.T) {
	text := "<system-notice>\n<task-result status=\"completed\">\nReal message here\n</system-notice>"
	if got := Map(text); got.Message != "Real message here" {
		t.Fatalf("message = %q", got.Message)
	}
}

// Transcripts that went through a copy/paste round trip carry typographic quotes.
func TestTypographicQuotes(t *testing.T) {
	text := "<system-notice>\n<task-result id=“9” status=‘canceled’>\n</system-notice>"
	got := Map(text)
	if got == nil || got.Level != "warning" {
		t.Fatalf("got %+v", got)
	}
	if got.Message != "Background job 9 canceled" {
		t.Fatalf("message = %q", got.Message)
	}
}

// Anything that is not a notice renders nothing, so ordinary text is not swallowed.
func TestNonNotice(t *testing.T) {
	for _, text := range []string{"", "hello", "<other>", "  <system-notice> "} {
		if got := Map(text); got != nil && text != "  <system-notice> " {
			t.Fatalf("%q produced %+v", text, got)
		}
	}
	// An indented tag is still a notice.
	if got := Map("  <system-notice>\nnotice body\n</system-notice>"); got == nil {
		t.Fatal("an indented notice must be recognised")
	}
}
