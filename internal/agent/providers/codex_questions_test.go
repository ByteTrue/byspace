package providers

import (
	"testing"
)

// A question and an approval are different RPCs: the question expects the answers, the approval
// expects a decision. Sending `decision` to a question leaves Codex waiting on a reply it cannot
// parse — the turn stalls with nothing shown.
func TestQuestionAnswersFlattenToOrderedList(t *testing.T) {
	fromList := questionAnswersFrom(map[string]any{
		"updatedInput": map[string]any{"answers": []any{"first", "second"}},
	})
	if len(fromList) != 2 || fromList[0] != "first" || fromList[1] != "second" {
		t.Fatalf("list: %v", fromList)
	}

	// Keyed by id: ordered numerically so "10" does not sort before "2".
	fromMap := questionAnswersFrom(map[string]any{
		"updatedInput": map[string]any{"answers": map[string]any{
			"10": "ten", "2": "two", "1": "one",
		}},
	})
	want := []string{"one", "two", "ten"}
	if len(fromMap) != len(want) {
		t.Fatalf("map: %v", fromMap)
	}
	for i := range want {
		if fromMap[i] != want[i] {
			t.Fatalf("map order: %v, want %v", fromMap, want)
		}
	}

	// A single answer in the top-level field.
	if got := questionAnswersFrom(map[string]any{"answer": "yes"}); len(got) != 1 || got[0] != "yes" {
		t.Fatalf("scalar: %v", got)
	}

	// A denied question still needs a reply, or Codex waits forever.
	if got := questionAnswersFrom(map[string]any{"behavior": "deny"}); len(got) != 1 || got[0] != "" {
		t.Fatalf("deny: %v", got)
	}
}

func TestFirstQuestionTitle(t *testing.T) {
	if got := firstQuestionTitle(nil); got == "" {
		t.Fatal("a question with no items still needs a notice")
	}
	questions := []map[string]any{{"question": "Which branch?"}}
	if got := firstQuestionTitle(questions); got != "Which branch?" {
		t.Fatalf("got %q", got)
	}
	// A question with no text must not produce an empty notice.
	if got := firstQuestionTitle([]map[string]any{{}}); got == "" {
		t.Fatal("an empty question text should fall back")
	}
}

func TestNumericLess(t *testing.T) {
	if !numericLess("2", "10") {
		t.Fatal("2 < 10 numerically")
	}
	if numericLess("10", "2") {
		t.Fatal("10 is not < 2")
	}
	if !numericLess("a", "b") {
		t.Fatal("non-numeric falls back to lexical")
	}
}
