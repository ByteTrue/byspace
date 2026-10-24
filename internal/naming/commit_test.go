package naming

import (
	"encoding/json"
	"strings"
	"testing"
)

// Models reliably wrap the subject in quotes, add a trailing period, or answer with a paragraph.
// The cleanup is what makes the result usable as a git commit -m argument.
func TestCleanCommitMessage(t *testing.T) {
	cases := map[string]string{
		"add the login form.":                   "add the login form",
		`"add the login form"`:                  "add the login form",
		"`add the login form`":                  "add the login form",
		"add the login form\n\nbecause reasons": "add the login form",
		"  add the login form  ":                "add the login form",
		"add the login form":                    "add the login form",
	}
	for input, want := range cases {
		if got := cleanCommitMessage(input); got != want {
			t.Fatalf("cleanCommitMessage(%q) = %q, want %q", input, got, want)
		}
	}
	if got := cleanCommitMessage("   \n  "); got != "" {
		t.Fatalf("blank input must yield empty, got %q", got)
	}
}

// A "subject" longer than 200 characters is a paragraph; git and every log viewer truncate it
// somewhere the model did not choose.
func TestCleanCommitMessageTruncates(t *testing.T) {
	long := strings.Repeat("a", 400)
	got := cleanCommitMessage(long)
	if len(got) > 200 {
		t.Fatalf("length = %d", len(got))
	}
}

// The reply may be wrapped in prose or a fence; the JSON object is what matters.
func TestParsePRText(t *testing.T) {
	reply := "Here you go:\n```json\n{\"title\":\"Add login\",\"body\":\"Why it matters.\"}\n```"
	start := strings.IndexByte(reply, '{')
	end := strings.LastIndexByte(reply, '}')
	var text PRText
	if err := json.Unmarshal([]byte(reply[start:end+1]), &text); err != nil {
		t.Fatal(err)
	}
	if text.Title != "Add login" || text.Body != "Why it matters." {
		t.Fatalf("%+v", text)
	}
}
