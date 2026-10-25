package sdk

import (
	"strings"
	"testing"
)

func strPtr(v string) *string { return &v }
func i64Ptr(v int64) *int64   { return &v }

// The parts are joined with " · " and whatever is missing is skipped; an empty result must be nil
// so the client does not render a blank subtitle row.
func TestBuildSubagentSubtitle(t *testing.T) {
	got := BuildSubagentSubtitle(strPtr("check the logs"), strPtr("Sonnet"), strPtr("high"), i64Ptr(12300))
	if got == nil {
		t.Fatal("expected a subtitle")
	}
	if *got != "check the logs · Sonnet · high · 12.3k tok" {
		t.Fatalf("got %q", *got)
	}

	// Partial facts: only what is known.
	partial := BuildSubagentSubtitle(strPtr("check the logs"), nil, nil, nil)
	if partial == nil || *partial != "check the logs" {
		t.Fatalf("partial: %v", partial)
	}

	// Nothing at all is nil, not "".
	if nothing := BuildSubagentSubtitle(nil, nil, nil, nil); nothing != nil {
		t.Fatalf("expected nil, got %q", *nothing)
	}
	// Whitespace-only parts count as missing.
	if blank := BuildSubagentSubtitle(strPtr("  "), strPtr(""), nil, nil); blank != nil {
		t.Fatalf("expected nil, got %q", *blank)
	}
	// A zero token count is not shown: "0 tok" is noise.
	if zero := BuildSubagentSubtitle(nil, nil, nil, i64Ptr(0)); zero != nil {
		t.Fatalf("expected nil, got %q", *zero)
	}
}

// Full counts push the model and effort off a narrow row, so the numbers are compact.
func TestFormatTokens(t *testing.T) {
	cases := map[int64]string{
		5:       "5 tok",
		999:     "999 tok",
		1000:    "1k tok",
		12300:   "12.3k tok",
		999999:  "1000k tok",
		1500000: "1.5M tok",
	}
	for tokens, want := range cases {
		if got := formatTokens(tokens); got != want {
			t.Fatalf("formatTokens(%d) = %q, want %q", tokens, got, want)
		}
	}
}

// The subtitle grows as the subagent reports; Refresh recomputes from the raw facts.
func TestRefreshSubagentSubtitle(t *testing.T) {
	descriptor := SubagentDescriptor{Title: strPtr("audit")}
	RefreshSubagentSubtitle(&descriptor)
	if descriptor.Subtitle == nil || *descriptor.Subtitle != "audit" {
		t.Fatalf("first pass: %v", descriptor.Subtitle)
	}
	descriptor.Model = strPtr("Opus")
	descriptor.TotalTokens = i64Ptr(2400)
	RefreshSubagentSubtitle(&descriptor)
	if descriptor.Subtitle == nil || !strings.Contains(*descriptor.Subtitle, "Opus") ||
		!strings.Contains(*descriptor.Subtitle, "2.4k tok") {
		t.Fatalf("after facts arrive: %q", *descriptor.Subtitle)
	}
}
