package providers

import "testing"

// An xdev call names the tool it actually ran in its result; without unwrapping the card shows "xdev" and
// builds its detail from the wrong argument shape.
func TestResolveOmpToolCallName(t *testing.T) {
	wrapped := map[string]any{
		"details": map[string]any{"xdev": map[string]any{"tool": "read"}},
	}
	if got := ResolveOmpToolCallName("xdev", wrapped); got != "read" {
		t.Fatalf("wrapped = %q", got)
	}

	// A plain tool keeps its own name.
	if got := ResolveOmpToolCallName("bash", nil); got != "bash" {
		t.Fatalf("plain = %q", got)
	}

	// A result with the wrapper missing falls back to the outer name rather than becoming empty.
	for _, result := range []any{
		nil,
		"a string result",
		map[string]any{},
		map[string]any{"details": map[string]any{}},
		map[string]any{"details": map[string]any{"xdev": map[string]any{"tool": "  "}}},
	} {
		if got := ResolveOmpToolCallName("xdev", result); got != "xdev" {
			t.Fatalf("result %v → %q", result, got)
		}
	}
}
