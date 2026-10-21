package naming

import "testing"

// The model's output is untrusted input that ends up in a git argument; normalization is what
// keeps it safe.
func TestNormalizeBranch(t *testing.T) {
	cases := map[string]string{
		"Fix Login Bug":       "fix-login-bug",
		"  spaces  around  ":  "spaces-around",
		"feat/add-parser":     "feat-add-parser",
		"UPPER_case-and.dots": "upper-case-and-dots",
		"a//b":                "a-b",
		"---leads":            "leads",
	}
	for input, want := range cases {
		got, err := NormalizeBranch(input)
		if err != nil {
			t.Fatalf("%q: %v", input, err)
		}
		if got != want {
			t.Fatalf("NormalizeBranch(%q) = %q, want %q", input, got, want)
		}
	}
	// Empty after normalization is an error, not a silent fallback: the caller decides.
	for _, input := range []string{"", "   ", "///", ".-."} {
		if _, err := NormalizeBranch(input); err == nil {
			t.Fatalf("NormalizeBranch(%q) should have failed", input)
		}
	}
}

// The model may wrap the object in prose or a fence despite being told not to.
func TestParseExtractsJSONFromProse(t *testing.T) {
	reply := "Sure! Here it is:\n```json\n{\"title\": \"Add login\", \"branch\": \"Add Login\"}\n```\nDone."
	got, err := Parse(reply)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Add login" {
		t.Fatalf("title = %q", got.Title)
	}
	if got.Branch != "add-login" {
		t.Fatalf("branch = %q (must be normalized)", got.Branch)
	}
}

// A reply that answers the prompt instead of naming it must fail loudly, not produce a garbage
// branch name.
func TestParseRejectsNonJSON(t *testing.T) {
	if _, err := Parse("I deleted the old cache for you."); err == nil {
		t.Fatal("expected an error for a reply with no JSON object")
	}
	if _, err := Parse(`{"title": "", "branch": "x"}`); err == nil {
		t.Fatal("expected an error for an empty title")
	}
	if _, err := Parse(`{"title": "ok", "branch": ""}`); err == nil {
		t.Fatal("expected an error for an unusable branch")
	}
}

// Long input is truncated rather than rejected: a title is advisory.
func TestParseTruncatesLongTitle(t *testing.T) {
	long := make([]byte, 200)
	for i := range long {
		long[i] = 'a'
	}
	got, err := Parse(`{"title": "` + string(long) + `", "branch": "b"}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Title) > 80 {
		t.Fatalf("title length = %d", len(got.Title))
	}
}
