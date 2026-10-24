package providers

import "testing"

// `line` and `limit` are how an agent reads a window of a large file. Ignoring them returns the
// whole file: the agent believes it is looking at lines 100-120 while it has the first line.
func TestSliceLines(t *testing.T) {
	content := "l1\nl2\nl3\nl4\nl5"

	// No window: return "" so the caller keeps the full content.
	if got := sliceLines(content, map[string]any{}); got != "" {
		t.Fatalf("no window should return empty, got %q", got)
	}

	// line 2, limit 2 → lines 2 and 3.
	got := sliceLines(content, map[string]any{"line": float64(2), "limit": float64(2)})
	if got != "l2\nl3" {
		t.Fatalf("window = %q", got)
	}

	// line 4 with no limit → 4 and 5.
	if got := sliceLines(content, map[string]any{"line": float64(4)}); got != "l4\nl5" {
		t.Fatalf("tail = %q", got)
	}

	// limit alone starts at line 1.
	if got := sliceLines(content, map[string]any{"limit": float64(2)}); got != "l1\nl2" {
		t.Fatalf("head = %q", got)
	}

	// Past the end is empty rather than a panic.
	if got := sliceLines(content, map[string]any{"line": float64(99)}); got != "" {
		t.Fatalf("past end = %q", got)
	}
}

// ACP line numbers are 1-based; line 0 or negative must not slice backwards.
func TestSliceLinesClampsZero(t *testing.T) {
	if got := sliceLines("a\nb", map[string]any{"line": float64(0), "limit": float64(1)}); got != "a" {
		t.Fatalf("line 0 = %q", got)
	}
	if got := sliceLines("a\nb", map[string]any{"line": float64(-5), "limit": float64(1)}); got != "a" {
		t.Fatalf("negative line = %q", got)
	}
}
