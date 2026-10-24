package advisor

import (
	"strings"
	"testing"
)

// Without this the review is invisible: the message is `role: "custom"`, which the history mapper skips
// because it has no user-facing role.
func TestMapMessage(t *testing.T) {
	card := MapMessage("advisor", "overall", map[string]any{
		"id": "msg_1",
		"notes": []any{
			map[string]any{"note": "this loop can be a slice", "severity": "nit", "advisor": "reviewer-a"},
			map[string]any{"note": "the error is swallowed", "severity": "blocker"},
			map[string]any{"note": "no severity here"},
		},
	})
	if card == nil {
		t.Fatal("no card")
	}
	if card.CallID != "omp-advisor:msg_1" || card.Name != "advisor" || card.Status != "completed" {
		t.Fatalf("card = %+v", card)
	}
	if card.Detail["type"] != "plain_text" || card.Detail["icon"] != "brain" {
		t.Fatalf("detail = %+v", card.Detail)
	}
	if card.Detail["label"] != "Advisor · 3 notes · 1 blocker" {
		t.Fatalf("label = %v", card.Detail["label"])
	}

	body, _ := card.Detail["text"].(string)
	for _, want := range []string{
		"[nit] [reviewer-a] this loop can be a slice",
		"[blocker] the error is swallowed",
		"no severity here",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("body %q lacks %q", body, want)
		}
	}
	if card.Metadata["synthetic"] != true || card.Metadata["source"] != "omp_advisor" {
		t.Fatalf("metadata = %+v", card.Metadata)
	}
	if card.Metadata["noteCount"] != 3 || card.Metadata["blockerCount"] != 1 {
		t.Fatalf("counts = %+v", card.Metadata)
	}
}

// Every other custom message is skipped elsewhere; rendering one here would attribute it to the advisor.
func TestMapMessageIgnoresOtherCustomTypes(t *testing.T) {
	for _, customType := range []string{"", "system", "notice", "Advisor-typo"} {
		if card := MapMessage(customType, "text", map[string]any{"notes": []any{}}); card != nil {
			t.Fatalf("%q produced a card: %+v", customType, card)
		}
	}
	// The type is matched case-insensitively.
	if card := MapMessage("ADVISOR", "text", nil); card == nil {
		t.Fatal("the type should match case-insensitively")
	}
}

// A note without text is dropped rather than rendered blank.
func TestNotesWithoutTextAreDropped(t *testing.T) {
	card := MapMessage("advisor", "fallback text", map[string]any{
		"notes": []any{
			map[string]any{"severity": "blocker"},
			map[string]any{"note": "  "},
			map[string]any{"note": "real"},
			"not a record",
		},
	})
	if card.Metadata["noteCount"] != 1 {
		t.Fatalf("notes = %v", card.Metadata["noteCount"])
	}
	if card.Detail["text"] != "real" {
		t.Fatalf("text = %v", card.Detail["text"])
	}
}

// No notes means the card shows the raw text, and a count of zero would read as an empty review.
func TestNoNotes(t *testing.T) {
	card := MapMessage("advisor", "the advisor said this", nil)
	if card.Detail["label"] != "Advisor" {
		t.Fatalf("label = %v", card.Detail["label"])
	}
	if card.Detail["text"] != "the advisor said this" {
		t.Fatalf("text = %v", card.Detail["text"])
	}
}

// An unknown severity is dropped: the client colours a recognised value by lookup, and an unrecognised one
// renders as a plain label that looks like part of the note.
func TestUnknownSeverityIsDropped(t *testing.T) {
	card := MapMessage("advisor", "", map[string]any{
		"notes": []any{map[string]any{"note": "x", "severity": "catastrophe"}},
	})
	if body, _ := card.Detail["text"].(string); strings.Contains(body, "catastrophe") {
		t.Fatalf("body = %q", body)
	}
	if card.Detail["text"] != "x" {
		t.Fatalf("text = %v", card.Detail["text"])
	}
}

// The id has to be stable across a reload; a random one would duplicate the card every time.
func TestCallIDStability(t *testing.T) {
	first := MapMessage("advisor", "same text", nil)
	second := MapMessage("advisor", "same text", nil)
	if first.CallID != second.CallID {
		t.Fatalf("unstable: %q vs %q", first.CallID, second.CallID)
	}
	if first.CallID == MapMessage("advisor", "other text", nil).CallID {
		t.Fatal("different text produced the same id")
	}
	if len(first.CallID) != len("omp-advisor:")+12 {
		t.Fatalf("id = %q", first.CallID)
	}
}
