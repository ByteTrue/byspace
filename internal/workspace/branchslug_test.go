package workspace

import (
	"strings"
	"testing"
)

// The client applies these rules before sending, so a slug that passes in the UI must not be
// rejected by the daemon — and one from an older client must be held to the same standard.
func TestValidateBranchSlug(t *testing.T) {
	valid := []string{"fix-login", "feat/nested-name", "a1", "a-b-c/d"}
	for _, slug := range valid {
		if err := ValidateBranchSlug(slug); err != nil {
			t.Fatalf("%q should be valid: %v", slug, err)
		}
	}
	invalid := map[string]string{
		"":               "empty",
		"UPPER":          "uppercase",
		"has space":      "space",
		"-lead":          "leading hyphen",
		"trail-":         "trailing hyphen",
		"double--hyphen": "consecutive hyphens",
		"under_score":    "underscore",
		"dots.in.it":     "dots",
	}
	for slug, why := range invalid {
		if err := ValidateBranchSlug(slug); err == nil {
			t.Fatalf("%q should be rejected (%s)", slug, why)
		}
	}
	if err := ValidateBranchSlug(strings.Repeat("a", 101)); err == nil {
		t.Fatal("an overlong slug must be rejected")
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Fix Login Bug":    "fix-login-bug",
		"  leading/trail ": "leading-trail",
		"UPPER":            "upper",
		"a  b":             "a-b",
	}
	for input, want := range cases {
		if got := Slugify(input); got != want {
			t.Fatalf("Slugify(%q) = %q, want %q", input, got, want)
		}
	}
}

// Truncation prefers a hyphen boundary past the halfway point, so a slug does not end mid-word —
// but a long first word is not discarded entirely.
func TestSlugifyTruncation(t *testing.T) {
	// Hyphen past halfway: cut there.
	long := strings.Repeat("a", 30) + "-" + strings.Repeat("b", 40)
	got := Slugify(long)
	if len(got) > MaxWorktreeSlugLength {
		t.Fatalf("over length: %d", len(got))
	}
	if strings.HasSuffix(got, "-") {
		t.Fatalf("must not end with a hyphen: %q", got)
	}

	// One very long word: keep the first 50 characters rather than nothing.
	oneWord := strings.Repeat("c", 80)
	if got := Slugify(oneWord); len(got) != MaxWorktreeSlugLength {
		t.Fatalf("expected %d characters, got %d", MaxWorktreeSlugLength, len(got))
	}
}

// A worktree slug becomes a path component, so slashes are folded even though branch rules allow
// them.
func TestNormalizeWorktreeSlugRemovesSeparators(t *testing.T) {
	if got := NormalizeWorktreeSlug("feat/sub-name"); got != "feat-sub-name" {
		t.Fatalf("got %q", got)
	}
	if got := NormalizeWorktreeSlug("  "); got != "" {
		t.Fatalf("blank input should yield empty, got %q", got)
	}
}
