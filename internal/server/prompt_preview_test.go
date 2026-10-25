package server

import (
	"strings"
	"testing"
)

func TestPromptPreview(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"short text passes through", "hello world", "hello world"},
		{"collapses whitespace runs", "a\n\n  b\t\tc", "a b c"},
		{"trims edges", "  spaced out  ", "spaced out"},
		{"empty stays empty", "", ""},
		{"only whitespace collapses to empty", " \n\t ", ""},
		{
			// 120 runes is the boundary: at exactly 120 nothing is cut.
			name: "exactly at the limit is untouched",
			in:   strings.Repeat("x", 120),
			want: strings.Repeat("x", 120),
		},
		{
			// 121 runes cuts to 119 plus the ellipsis, so the preview stays 120 wide.
			name: "one over the limit is cut with an ellipsis",
			in:   strings.Repeat("x", 121),
			want: strings.Repeat("x", 119) + "…",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := promptPreview(tc.in); got != tc.want {
				t.Fatalf("promptPreview(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// Counting runes, not bytes: a multibyte character straddling the cut must not be sliced in half.
func TestPromptPreviewDoesNotSplitMultibyteRunes(t *testing.T) {
	// Each CJK rune is 3 bytes; 121 of them is 363 bytes but 121 runes.
	in := strings.Repeat("字", 121)
	got := promptPreview(in)
	if got != strings.Repeat("字", 119)+"…" {
		t.Fatalf("multibyte preview = %q (len %d runes), want 119 runes plus an ellipsis", got, len([]rune(got)))
	}
	// The result must be valid UTF-8: a byte-slicing implementation would leave a broken rune here.
	if !strings.Contains(got, "字") {
		t.Fatalf("preview lost its content: %q", got)
	}
}
