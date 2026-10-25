package cli

import (
	"bytes"
	"strings"
	"testing"
)

func TestWriteYAML(t *testing.T) {
	var buf bytes.Buffer
	value := map[string]any{
		"id":     "agt_1",
		"status": "running",
		"count":  float64(3),
		"tags":   []any{"a", "b"},
		"nested": map[string]any{"model": "deepseek"},
		"empty":  nil,
	}
	if err := writeYAML(&buf, value); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, want := range []string{"id: agt_1", "status: running", "count: 3", "- a", "model: deepseek", "empty: null"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in:\n%s", want, out)
		}
	}
	// Keys are sorted, so the output is stable between runs.
	if strings.Index(out, "count:") > strings.Index(out, "id:") {
		t.Fatalf("keys are not sorted:\n%s", out)
	}
}

// A value that could be read as YAML syntax must be quoted, or the output stops being parseable.
func TestWriteYAMLQuotesAmbiguousScalars(t *testing.T) {
	var buf bytes.Buffer
	if err := writeYAML(&buf, map[string]any{
		"colon":  "a: b",
		"hash":   "a #comment",
		"empty":  "",
		"spaced": " padded ",
		"plain":  "simple",
	}); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, want := range []string{`"a: b"`, `"a #comment"`, `""`, `" padded "`, "plain: simple"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in:\n%s", want, out)
		}
	}
}

func TestResolveOutputMode(t *testing.T) {
	cases := []struct {
		json, yaml, quiet bool
		want              OutputMode
	}{
		{false, false, false, ModeTable},
		{true, false, false, ModeJSON},
		{false, true, false, ModeYAML},
		{false, false, true, ModeQuiet},
		// The machine-readable formats win over quiet, so `--json -q` still parses.
		{true, false, true, ModeJSON},
	}
	for _, tc := range cases {
		if got := resolveOutputMode(tc.json, tc.yaml, tc.quiet); got != tc.want {
			t.Fatalf("%+v: got %v want %v", tc, got, tc.want)
		}
	}
}

// Widths are measured in display cells, not bytes: a CJK character occupies two columns and three
// bytes, so byte arithmetic both misaligns the table and can truncate mid-character.
func TestDisplayWidth(t *testing.T) {
	cases := map[string]int{
		"abc":     3,
		"中文":      4,
		"a中b":     4,
		"":        0,
		"日本語テスト":  12,
		"emoji 🚀": 8,
	}
	for text, want := range cases {
		if got := displayWidth(text); got != want {
			t.Fatalf("displayWidth(%q) = %d, want %d", text, got, want)
		}
	}
}

// Truncation must cut on a rune boundary; slicing bytes prints a replacement glyph.
func TestTruncateToWidthNeverSplitsRunes(t *testing.T) {
	text := "中文测试"
	for limit := 0; limit <= 8; limit++ {
		got, width := truncateToWidth(text, limit)
		if width > limit {
			t.Fatalf("limit %d: width %d", limit, width)
		}
		if !strings.HasPrefix(text, got) {
			t.Fatalf("limit %d: %q is not a prefix of %q", limit, got, text)
		}
		if strings.ContainsRune(got, 0xFFFD) {
			t.Fatalf("limit %d: split a rune: %q", limit, got)
		}
	}
}

// Every column but the last is padded to its width; the last is free to wrap.
func TestRenderTableAlignsColumns(t *testing.T) {
	var buf bytes.Buffer
	if err := renderTable(&buf,
		[]string{"ID", "STATE"},
		[][]string{
			{"a", "running"},
			{"longer-id", "idle"},
		}); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("expected header, separator and two rows, got %d lines", len(lines))
	}
	// The state column starts at the same offset on every line.
	headerAt := strings.Index(lines[0], "STATE")
	rowAt := strings.Index(lines[2], "running")
	if headerAt < 0 || rowAt != headerAt {
		t.Fatalf("columns misaligned: header at %d, row at %d\n%s", headerAt, rowAt, buf.String())
	}
}
