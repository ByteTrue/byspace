package agentroles

import (
	"strings"
	"testing"
)

func TestStripReservedRemovesRoleAndDaemonLabels(t *testing.T) {
	got := StripReserved(map[string]string{
		RoleLabel:                        "chief",
		AutoArchiveLabel:                 "true",
		"byspace.schedule-id":            "sch_1",
		"byspace.schedule-run":           "run_1",
		OrchestrationMissionIDLabel:      "msn_1",
		OrchestrationThreadIDLabel:       "thr_1",
		OrchestrationRoleLabel:           "verifier",
		OrchestrationChatterShieldLabel:  "true",
		"BYSPACE.ORCHESTRATION.CUSTOM":   "forged",
		"byspace.parent-agent-id":        "agt_parent",
		"byspace.open-agent-tab.client1": "true",
		"team":                           "infra",
	})
	for _, forbidden := range []string{
		RoleLabel,
		AutoArchiveLabel,
		"byspace.schedule-id",
		"byspace.schedule-run",
		OrchestrationMissionIDLabel,
		OrchestrationThreadIDLabel,
		OrchestrationRoleLabel,
		OrchestrationChatterShieldLabel,
		"BYSPACE.ORCHESTRATION.CUSTOM",
	} {
		if _, present := got[forbidden]; present {
			t.Fatalf("reserved label %q survived StripReserved: %+v", forbidden, got)
		}
	}
	if got["byspace.parent-agent-id"] != "agt_parent" {
		t.Fatalf("parent-agent-id was dropped: %+v", got)
	}
	if got["byspace.open-agent-tab.client1"] != "true" {
		t.Fatalf("open-agent-tab label was dropped: %+v", got)
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
		"byspace chief mission create",
		"byspace chief mission upgrade",
		"byspace chief thread create",
		"byspace chief thread merge-check",
		"byspace chief thread land",
		"byspace chief thread cancel",
		"byspace chief agent hotswap",
		"wait for human landing approval",
		"open_pr",
		"unsupported",
		"never edit repository files",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("the prompt lost %q", want)
		}
	}
}

func TestOrchestrationPromptsStayDaemonOnlyAndSelfSufficient(t *testing.T) {
	author := OrchestrationPrompt("author")
	for _, want := range []string{"ownedPaths", "byspace chief thread submit", "BYSPACE_AGENT_ID"} {
		if !strings.Contains(author, want) {
			t.Fatalf("author prompt missing %q", want)
		}
	}

	verifier := OrchestrationPrompt(" VERIFIER ")
	for _, want := range []string{"Do NOT edit", "byspace chief thread verdict", "--pass|--reject", "read-only"} {
		if !strings.Contains(verifier, want) {
			t.Fatalf("verifier prompt missing %q", want)
		}
	}

	integrator := OrchestrationPrompt("integrator")
	for _, want := range []string{"worktree", "byspace chief thread submit", "Verifier", "Never land directly", "human landing approval"} {
		if !strings.Contains(integrator, want) {
			t.Fatalf("integrator prompt missing %q", want)
		}
	}

	for _, nonWorker := range []string{"", "chief", "unknown"} {
		if got := OrchestrationPrompt(nonWorker); got != "" {
			t.Fatalf("OrchestrationPrompt(%q) = %q, want empty", nonWorker, got)
		}
	}
	for _, name := range Names() {
		if name != "chief" {
			t.Fatalf("unexpected public built-in role %q", name)
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
