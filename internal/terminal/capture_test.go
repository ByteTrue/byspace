package terminal

import "testing"

func intPtr(v int) *int { return &v }

// A caller feeding terminal text to something that cannot render a terminal needs to ask for a
// slice; returning the whole backlog and letting it slice is not equivalent.
func TestCaptureLines(t *testing.T) {
	lines := []string{"one", "two", "three", "four", "five"}

	// No options: everything.
	got := CaptureLines(lines, CaptureOptions{})
	if len(got.Lines) != 5 || got.TotalLines != 5 {
		t.Fatalf("all: %+v", got)
	}

	// Inclusive range.
	got = CaptureLines(lines, CaptureOptions{Start: intPtr(1), End: intPtr(3)})
	if len(got.Lines) != 3 || got.Lines[0] != "two" || got.Lines[2] != "four" {
		t.Fatalf("range: %v", got.Lines)
	}

	// Negative indices count from the end; -1 is the last line.
	got = CaptureLines(lines, CaptureOptions{Start: intPtr(-2)})
	if len(got.Lines) != 2 || got.Lines[0] != "four" || got.Lines[1] != "five" {
		t.Fatalf("tail: %v", got.Lines)
	}

	// Out of range clamps rather than failing: asking for the last 100 of 5 wants the 5.
	got = CaptureLines(lines, CaptureOptions{Start: intPtr(-100)})
	if len(got.Lines) != 5 {
		t.Fatalf("clamped start: %v", got.Lines)
	}
	got = CaptureLines(lines, CaptureOptions{End: intPtr(99)})
	if len(got.Lines) != 5 {
		t.Fatalf("clamped end: %v", got.Lines)
	}

	// An inverted range is empty, not a crash.
	got = CaptureLines(lines, CaptureOptions{Start: intPtr(4), End: intPtr(1)})
	if len(got.Lines) != 0 || got.TotalLines != 5 {
		t.Fatalf("inverted: %+v", got)
	}
}

func TestCaptureLinesEmpty(t *testing.T) {
	got := CaptureLines(nil, CaptureOptions{Start: intPtr(-1)})
	if len(got.Lines) != 0 || got.TotalLines != 0 {
		t.Fatalf("empty: %+v", got)
	}
}

// Colour codes in captured text are noise for anything that cannot render a terminal.
func TestCaptureLinesStripsANSI(t *testing.T) {
	lines := []string{
		"\x1b[32m✓\x1b[0m build ok",
		"\x1b]0;title\x07prompt $ ",
		"plain",
	}
	got := CaptureLines(lines, CaptureOptions{StripANSI: true})
	if got.Lines[0] != "✓ build ok" {
		t.Fatalf("colour not stripped: %q", got.Lines[0])
	}
	// Trailing whitespace is trimmed as part of capture, so the assertion is on the prefix.
	if got.Lines[1] != "prompt $" {
		t.Fatalf("OSC not stripped: %q", got.Lines[1])
	}
	if got.Lines[2] != "plain" {
		t.Fatalf("plain line changed: %q", got.Lines[2])
	}

	// Opting out keeps them.
	got = CaptureLines(lines, CaptureOptions{StripANSI: false})
	if got.Lines[0] == "✓ build ok" {
		t.Fatal("StripANSI=false should keep the escape sequences")
	}
}

// Trailing padding from a fixed-width screen is not content.
func TestCaptureLinesTrimsTrailingWhitespace(t *testing.T) {
	got := CaptureLines([]string{"hello      ", "world\t\t"}, CaptureOptions{})
	if got.Lines[0] != "hello" || got.Lines[1] != "world" {
		t.Fatalf("got %q, %q", got.Lines[0], got.Lines[1])
	}
}

func TestStripANSI(t *testing.T) {
	cases := map[string]string{
		"\x1b[1;31mred\x1b[0m":      "red",
		"\x1b[?25lhidden cursor":    "hidden cursor",
		"\x1b]8;;https://x\x07link": "link",
		"no escapes":                "no escapes",
	}
	for input, want := range cases {
		if got := StripANSI(input); got != want {
			t.Fatalf("StripANSI(%q) = %q, want %q", input, got, want)
		}
	}
}
