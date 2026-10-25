package providers

import "testing"

// The context-window ring in the composer reads this; without it a Codex agent shows no usage at
// all even though the provider reports it on every turn.
func TestCodexAgentUsage(t *testing.T) {
	usage := codexAgentUsage(map[string]any{
		"model_context_window": float64(200000),
		"last": map[string]any{
			"inputTokens":       float64(1200),
			"cachedInputTokens": float64(800),
			"outputTokens":      float64(300),
			"total_tokens":      float64(1500),
		},
	})
	if usage == nil {
		t.Fatal("expected usage")
	}
	if usage.InputTokens != 1200 || usage.CachedInputTokens != 800 || usage.OutputTokens != 300 {
		t.Fatalf("token fields: %+v", usage)
	}
	if usage.ContextWindowMaxTokens == nil || *usage.ContextWindowMaxTokens != 200000 {
		t.Fatalf("max: %v", usage.ContextWindowMaxTokens)
	}
	if usage.ContextWindowUsedTokens == nil || *usage.ContextWindowUsedTokens != 1500 {
		t.Fatalf("used: %v", usage.ContextWindowUsedTokens)
	}
}

// The camelCase spellings are what a newer app-server sends.
func TestCodexAgentUsageCamelCase(t *testing.T) {
	usage := codexAgentUsage(map[string]any{
		"modelContextWindow": float64(128000),
		"last": map[string]any{
			"totalTokens": float64(900),
		},
	})
	if usage == nil || usage.ContextWindowMaxTokens == nil || *usage.ContextWindowMaxTokens != 128000 {
		t.Fatalf("%+v", usage)
	}
	if usage.ContextWindowUsedTokens == nil || *usage.ContextWindowUsedTokens != 900 {
		t.Fatalf("used: %v", usage.ContextWindowUsedTokens)
	}
}

// An empty payload must not reset a previously reported usage to zero.
func TestCodexAgentUsageEmpty(t *testing.T) {
	if got := codexAgentUsage(map[string]any{}); got != nil {
		t.Fatalf("empty payload should be nil, got %+v", got)
	}
	if got := codexAgentUsage(map[string]any{"last": map[string]any{}}); got != nil {
		t.Fatalf("empty last should be nil, got %+v", got)
	}
}
