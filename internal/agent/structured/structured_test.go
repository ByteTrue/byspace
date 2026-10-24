package structured

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Models wrap the answer in a fence, prepend prose, or append a summary. All three are common and
// none is worth failing over.
func TestExtractJSON(t *testing.T) {
	cases := map[string]string{
		"```json\n{\"a\":1}\n```":              `{"a":1}`,
		"```\n{\"a\":1}\n```":                  `{"a":1}`,
		"Here you go:\n{\"a\":1}":              `{"a":1}`,
		"{\"a\":1}\nLet me know if that helps": `{"a":1}`,
		`plain {"a":1} text {"b":2}`:           `{"a":1}`,
		"[1,2,3]":                              "[1,2,3]",
		"no json here":                         "no json here",
	}
	for input, want := range cases {
		if got := ExtractJSON(input); got != want {
			t.Fatalf("ExtractJSON(%q) = %q, want %q", input, got, want)
		}
	}
}

// A brace inside a JSON string must not end the scan early.
func TestExtractJSONHandlesBracesInStrings(t *testing.T) {
	input := `{"template":"if (x) { y }","count":2}`
	if got := ExtractJSON(input); got != input {
		t.Fatalf("got %q", got)
	}
}

// A model told the specific error fixes it; one told "invalid" guesses differently.
func TestGetRetriesWithValidationErrors(t *testing.T) {
	schema := []byte(`{"type":"object","required":["answer"],"properties":{"answer":{"type":"string"}}}`)
	var prompts []string
	caller := func(_ context.Context, prompt string) (string, error) {
		prompts = append(prompts, prompt)
		if len(prompts) == 1 {
			return `{"wrong":"shape"}`, nil
		}
		return `{"answer":"42"}`, nil
	}

	value, err := Get(context.Background(), caller, Options{Prompt: "answer please", Schema: schema}, ValidateJSONSchema(schema))
	if err != nil {
		t.Fatal(err)
	}
	if record, ok := value.(map[string]any); !ok || record["answer"] != "42" {
		t.Fatalf("value = %+v", value)
	}
	if len(prompts) != 2 {
		t.Fatalf("prompts = %d", len(prompts))
	}
	if !strings.Contains(prompts[1], "missing required property 'answer'") {
		t.Fatalf("the retry did not carry the error: %q", prompts[1])
	}
}

// Exhausting the retries reports what was wrong, not just that it failed.
func TestGetReportsValidationErrors(t *testing.T) {
	schema := []byte(`{"type":"object","required":["answer"]}`)
	caller := func(context.Context, string) (string, error) { return `{}`, nil }

	_, err := Get(context.Background(), caller, Options{Prompt: "x", Schema: schema}, ValidateJSONSchema(schema))
	var responseErr *ResponseError
	if !errors.As(err, &responseErr) {
		t.Fatalf("err = %v", err)
	}
	if responseErr.LastResponse != `{}` {
		t.Fatalf("lastResponse = %q", responseErr.LastResponse)
	}
	if len(responseErr.ValidationErrors) == 0 {
		t.Fatal("the errors are what the caller logs")
	}
}

// A transport error is not a schema violation: retrying with the same prompt would repeat it.
func TestGetDoesNotRetryTransportErrors(t *testing.T) {
	calls := 0
	caller := func(context.Context, string) (string, error) {
		calls++
		return "", errors.New("provider died")
	}
	_, err := Get(context.Background(), caller, Options{Prompt: "x", Schema: []byte(`{}`)}, ValidateJSONSchema(nil))
	if err == nil || calls != 1 {
		t.Fatalf("calls = %d err = %v", calls, err)
	}
}

// An unavailable provider is recorded and skipped: a missing CLI fails the same way every time, and
// the user needs to know which one it was.
func TestFallbackSkipsUnavailableAndReportsAll(t *testing.T) {
	candidates := []Candidate{{Provider: "claude"}, {Provider: "codex", Model: "gpt-5"}}
	available := func(_ context.Context, provider string) (bool, string) {
		if provider == "claude" {
			return false, "not installed"
		}
		return true, ""
	}
	run := func(context.Context, Candidate, Options) (any, error) {
		return nil, errors.New("bad json")
	}

	_, err := GetWithFallback(context.Background(), candidates, Options{}, available, run)
	var fallbackErr *FallbackError
	if !errors.As(err, &fallbackErr) {
		t.Fatalf("err = %v", err)
	}
	if len(fallbackErr.Attempts) != 2 {
		t.Fatalf("attempts = %+v", fallbackErr.Attempts)
	}
	if fallbackErr.Attempts[0].Available {
		t.Fatal("claude was unavailable")
	}
	message := fallbackErr.Error()
	for _, want := range []string{"claude: unavailable (not installed)", "codex (gpt-5): failed"} {
		if !strings.Contains(message, want) {
			t.Fatalf("message %q missing %q", message, want)
		}
	}
}

// The second provider succeeding is a success, not a partial failure.
func TestFallbackSucceedsOnSecondProvider(t *testing.T) {
	candidates := []Candidate{{Provider: "a"}, {Provider: "b"}}
	available := func(context.Context, string) (bool, string) { return true, "" }
	run := func(_ context.Context, candidate Candidate, _ Options) (any, error) {
		if candidate.Provider == "a" {
			return nil, errors.New("nope")
		}
		return "ok", nil
	}
	value, err := GetWithFallback(context.Background(), candidates, Options{}, available, run)
	if err != nil || value != "ok" {
		t.Fatalf("value = %v err = %v", value, err)
	}
}

// No providers is a defined error, not a panic.
func TestFallbackWithNoCandidates(t *testing.T) {
	_, err := GetWithFallback(context.Background(), nil, Options{}, nil, nil)
	var fallbackErr *FallbackError
	if !errors.As(err, &fallbackErr) {
		t.Fatalf("err = %v", err)
	}
}

// A false accept shows the caller a value it can reject; a false reject burns the retries.
func TestValidateJSONSchema(t *testing.T) {
	schema := []byte(`{
		"type":"object",
		"required":["name","count"],
		"properties":{
			"name":{"type":"string"},
			"count":{"type":"integer"},
			"kind":{"enum":["a","b"]}
		}
	}`)
	validate := ValidateJSONSchema(schema)

	if _, problems := validate(map[string]any{"name": "x", "count": float64(2), "kind": "a"}); len(problems) != 0 {
		t.Fatalf("valid value rejected: %v", problems)
	}
	_, problems := validate(map[string]any{"count": float64(1)})
	if len(problems) != 1 || !strings.Contains(problems[0], "missing required property 'name'") {
		t.Fatalf("problems = %v", problems)
	}
	_, problems = validate(map[string]any{"name": "x", "count": "two"})
	if len(problems) != 1 || !strings.Contains(problems[0], "count: expected integer") {
		t.Fatalf("problems = %v", problems)
	}
	_, problems = validate(map[string]any{"name": "x", "count": float64(1), "kind": "z"})
	if len(problems) != 1 || !strings.Contains(problems[0], "allowed values") {
		t.Fatalf("problems = %v", problems)
	}

	// An unparseable schema cannot constrain anything; accepting is the safe direction.
	permissive := ValidateJSONSchema([]byte("not json"))
	if _, problems := permissive(map[string]any{"anything": true}); len(problems) != 0 {
		t.Fatalf("permissive validate rejected: %v", problems)
	}
}
