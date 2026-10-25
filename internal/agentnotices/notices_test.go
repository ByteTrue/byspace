package agentnotices

import "testing"

// The messages are shown verbatim next to the setting that produced them.
func TestNoticeText(t *testing.T) {
	if ModeAppliesNextTurn.Message != "Permission mode applies next turn" {
		t.Fatalf("mode notice = %q", ModeAppliesNextTurn.Message)
	}
	if ThinkingAppliesNextTurn.Message != "Thinking level applies next turn" {
		t.Fatalf("thinking notice = %q", ThinkingAppliesNextTurn.Message)
	}
	if ModeAppliesNextTurn.Type != "warning" || ThinkingAppliesNextTurn.Type != "warning" {
		t.Fatal("both notices are warnings: the change is not rejected, just deferred")
	}
}

// `notice` is nullable and optional; an empty object fails the discriminated union that validates it.
func TestToPayload(t *testing.T) {
	if got := ToPayload(nil); got != nil {
		t.Fatalf("nil notice → %v", got)
	}
	if got := ToPayload(&Notice{}); got != nil {
		t.Fatalf("a notice without a message must render as nil, got %v", got)
	}

	payload, ok := ToPayload(&ModeAppliesNextTurn).(map[string]any)
	if !ok {
		t.Fatal("payload is not a map")
	}
	if payload["type"] != "warning" || payload["message"] != ModeAppliesNextTurn.Message {
		t.Fatalf("payload = %+v", payload)
	}
}
