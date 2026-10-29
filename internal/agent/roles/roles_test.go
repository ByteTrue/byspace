package agentroles

import (
	"strings"
	"testing"
)

// The label carries Chief's prompt and privileges, so a client that can set it can forge them.
func TestStripReservedRemovesRoleLabel(t *testing.T) {
	got := StripReserved(map[string]string{
		RoleLabel: "chief",
		"team":    "infra",
	})
	if _, present := got[RoleLabel]; present {
		t.Fatal("the role label survived")
	}
	if got["team"] != "infra" {
		t.Fatalf("an ordinary label was dropped: %+v", got)
	}
	// Nil in, empty (not nil) out: the caller indexes the result.
	if got := StripReserved(nil); got == nil || len(got) != 0 {
		t.Fatalf("nil labels → %v", got)
	}
}

// A role is more than a label: it carries the instructions that make the agent behave as that role.
func TestChiefHasAPrompt(t *testing.T) {
	prompt := SystemPrompt("chief")
	if prompt == "" {
		t.Fatal("chief has no system prompt; the agent is created with no idea what it is")
	}
	for _, want := range []string{
		"You are Chief",
		"## Working model",
		"## Collaboration",
		"Never answer by naming the feature or workspace they should go find",
		"$BYSPACE_HOME/chief",
		"schedules and heartbeats can wake you later",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("the prompt lost %q", want)
		}
	}
}

func TestGetIsCaseInsensitiveAndForgiving(t *testing.T) {
	for _, name := range []string{"chief", "Chief", " CHIEF "} {
		if Get(name) == nil {
			t.Fatalf("%q did not resolve", name)
		}
	}
	// An unknown role must not error: a role that was removed cannot make an agent unloadable.
	if Get("no-such-role") != nil || Get("") != nil || Get("   ") != nil {
		t.Fatal("unknown names must resolve to nil")
	}
	if SystemPrompt("no-such-role") != "" {
		t.Fatal("an unknown role contributes no prompt")
	}
}

func TestNamesListsEveryRole(t *testing.T) {
	names := Names()
	if len(names) != 1 || names[0] != "chief" {
		t.Fatalf("names = %v", names)
	}
}

// A nil or empty part left in produces a stray blank line; returning separators instead of "" makes
// the caller send a system prompt that says nothing, which some providers prepend to every turn.
func TestComposeSystemPromptParts(t *testing.T) {
	if got := ComposeSystemPromptParts(); got != "" {
		t.Fatalf("no parts → %q", got)
	}
	if got := ComposeSystemPromptParts("", "   ", ""); got != "" {
		t.Fatalf("only blanks → %q", got)
	}
	if got := ComposeSystemPromptParts("a", "", "b"); got != "a\n\nb" {
		t.Fatalf("got %q", got)
	}
	// Each part is trimmed: a trailing newline in one part would otherwise become three newlines
	// between segments.
	if got := ComposeSystemPromptParts("  a  ", "\n\nb\n"); got != "a\n\nb" {
		t.Fatalf("got %q", got)
	}
}
