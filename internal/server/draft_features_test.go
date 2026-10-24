package server

import "testing"

// The draft is what the provider sheet posts while the user is still choosing; a model-gated feature
// must not appear before a model that supports it is picked.
func TestDraftModelFromConfig(t *testing.T) {
	if got := draftModelFromConfig(map[string]any{"model": "claude-opus-5"}); got != "claude-opus-5" {
		t.Fatalf("model = %q", got)
	}
	if got := draftModelFromConfig(map[string]any{"modelId": "claude-opus-5"}); got != "claude-opus-5" {
		t.Fatalf("modelId = %q", got)
	}
	if got := draftModelFromConfig(nil); got != "" {
		t.Fatalf("nil = %q", got)
	}
	if got := draftModelFromConfig(map[string]any{"model": 42}); got != "" {
		t.Fatalf("non-string = %q", got)
	}
	if got := draftModelFromConfig(map[string]any{"model": "  claude-opus-5  "}); got != "claude-opus-5" {
		t.Fatalf("untrimmed = %q", got)
	}
}
