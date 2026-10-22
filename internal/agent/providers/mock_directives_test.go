package providers

import "testing"

// Each phrase below is a contract with a Playwright spec: the spec sends it and asserts the resulting
// behaviour, so a pattern that stops matching silently disables that test's subject.
func TestParseMockDirectives(t *testing.T) {
	cases := []struct {
		prompt  string
		check   func(MockDirectives) bool
		meaning string
	}{
		{"Emit synthetic plan approval.", func(d MockDirectives) bool { return d.PlanApproval }, "plan approval"},
		{"emit a synthetic turn failure", func(d MockDirectives) bool { return d.TurnFailure }, "turn failure"},
		{"emit synthetic notification", func(d MockDirectives) bool { return d.Notification }, "notification"},
		{"emit synthetic custom message", func(d MockDirectives) bool { return d.CustomMessage }, "custom message"},
		{"emit synthetic todowrite", func(d MockDirectives) bool { return d.ToolCallTodo }, "todowrite"},
		{"emit synthetic questions", func(d MockDirectives) bool { return d.Questions }, "questions"},
		{
			"Emit synthetic user message before accepting turn.",
			func(d MockDirectives) bool { return d.UserMessageFirst },
			"user message before the turn is accepted",
		},
		{
			"Emit 12 coalesced agent stream updates",
			func(d MockDirectives) bool { return d.StreamUpdates == 12 },
			"a fixed number of stream updates",
		},
		{
			"emit 3 assistant messages before synthetic user message",
			func(d MockDirectives) bool { return d.AssistantBeforeUser == 3 },
			"assistant text before the echoed user message",
		},
		{
			"emit settled assistant image markdown: ![shot](./shot.png)",
			func(d MockDirectives) bool { return d.ImageMarkdown == "![shot](./shot.png)" },
			"a settled assistant image",
		},
	}
	for _, testCase := range cases {
		directives := ParseMockDirectives(testCase.prompt)
		if !testCase.check(directives) {
			t.Fatalf("%s: no directive parsed from %q → %+v", testCase.meaning, testCase.prompt, directives)
		}
	}

	// An ordinary prompt asks for nothing: otherwise every message would trigger a permission dialog.
	if ParseMockDirectives("Please fix the failing test").hasAny() {
		t.Fatal("a plain prompt produced directives")
	}
}

// An unknown model still streams: several specs create agents without naming one.
func TestResolveMockModelFallsBack(t *testing.T) {
	if got := ResolveMockModel("nope").ID; got != MockDefaultModelID {
		t.Fatalf("fallback = %q", got)
	}
	// An id that is also an alias of another model resolves to itself: node matches by id only, and the retired
	// model is selected on purpose by the spec that checks it stays addressable.
	if got := ResolveMockModel("legacy-five-minute-stream"); got.ID != "legacy-five-minute-stream" || got.IsSelectable {
		t.Fatalf("legacy id resolved to %+v", got)
	}
	if got := ResolveMockModel("bursty-stream"); got.Burst == nil {
		t.Fatal("bursty-stream lost its burst profile")
	}
}
