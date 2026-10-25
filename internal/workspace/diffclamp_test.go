package workspace

import (
	"strings"
	"testing"
)

// A minified bundle is one line of hundreds of thousands of characters; highlighting it blocks
// the renderer, and nobody reads a line that long.
func TestClampDiffLine(t *testing.T) {
	short := "normal line"
	if got := clampDiffLine(short); got != short {
		t.Fatalf("a short line must pass through: %q", got)
	}

	long := strings.Repeat("a", MaxDiffLineChars+5000)
	got := clampDiffLine(long)
	if len(got) >= len(long) {
		t.Fatalf("a long line was not truncated: %d bytes", len(got))
	}
	if !strings.HasSuffix(got, "… (truncated)") {
		t.Fatalf("truncation must be visible: %q", got[len(got)-20:])
	}

	// Exactly at the limit is not truncated.
	atLimit := strings.Repeat("b", MaxDiffLineChars)
	if got := clampDiffLine(atLimit); got != atLimit {
		t.Fatal("a line exactly at the limit must pass through")
	}
}

// Byte slicing could split a rune and print a replacement glyph.
func TestClampDiffLineDoesNotSplitRunes(t *testing.T) {
	// Build a line of CJK characters so the boundary lands mid-rune.
	long := strings.Repeat("中", MaxDiffLineChars)
	got := clampDiffLine(long)
	if strings.ContainsRune(got, '\uFFFD') {
		t.Fatal("truncation split a rune")
	}
	if !strings.HasSuffix(got, "… (truncated)") {
		t.Fatal("truncation marker missing")
	}
}
