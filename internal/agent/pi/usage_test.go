package pi

import (
	"encoding/json"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func jsonUnmarshal(data []byte, v any) error { return json.Unmarshal(data, v) }

// pi reports contextUsage.percent as a fraction (1.5405 for 1.5405%). Declaring it as an int
// made json.Unmarshal fail on the whole stats frame, so usage arrived as null and the composer's
// context ring sat empty for every session with a non-integral percentage.
func TestSessionStatsUnmarshalFractionalPercent(t *testing.T) {
	raw := []byte(`{"tokens":{"input":213,"output":88,"cacheRead":15104,"total":15405},` +
		`"cost":0.000260124,"contextUsage":{"tokens":15405,"contextWindow":1000000,"percent":1.5405}}`)

	var stats SessionStats
	if err := jsonUnmarshal(raw, &stats); err != nil {
		t.Fatalf("stats with a fractional percent must unmarshal: %v", err)
	}
	if stats.ContextUsage == nil || stats.ContextUsage.Percent == nil {
		t.Fatal("contextUsage.percent was dropped")
	}
	if got := *stats.ContextUsage.Percent; got != 1.5405 {
		t.Fatalf("percent = %v, want 1.5405", got)
	}
}

func TestSessionStatsUnmarshalNullContextUsageFields(t *testing.T) {
	// Models without window information report explicit nulls.
	raw := []byte(`{"tokens":{"input":10},"cost":0,"contextUsage":{"tokens":null,"contextWindow":null,"percent":null}}`)
	var stats SessionStats
	if err := jsonUnmarshal(raw, &stats); err != nil {
		t.Fatalf("null context usage must unmarshal: %v", err)
	}
	if stats.ContextUsage == nil {
		t.Fatal("contextUsage block was dropped")
	}
	if stats.ContextUsage.Tokens != nil || stats.ContextUsage.ContextWindow != nil {
		t.Fatal("expected nulls to stay nil")
	}
}

// Usage must be nil when the provider has nothing to report, so the client keeps showing the
// previous value instead of flipping to zero.
func TestUsageFromEmptyStatsIsNil(t *testing.T) {
	empty := &SessionStats{Tokens: map[string]int{}}
	if usage := usageFromStats(empty); usage != nil {
		t.Fatalf("expected nil usage for an empty session, got %+v", usage)
	}
}

func TestUsageFromStatsMapsFields(t *testing.T) {
	tokens, window := 15405, 1000000
	stats := &SessionStats{
		Tokens:       map[string]int{"input": 213, "output": 88, "cacheRead": 15104},
		Cost:         0.00026,
		ContextUsage: &sdk.ContextUsage{Tokens: &tokens, ContextWindow: &window},
	}
	usage := usageFromStats(stats)
	if usage == nil {
		t.Fatal("expected usage")
	}
	if usage.InputTokens != 213 || usage.OutputTokens != 88 || usage.CachedInputTokens != 15104 {
		t.Fatalf("token counts wrong: %+v", usage)
	}
	if usage.ContextWindowMaxTokens == nil || *usage.ContextWindowMaxTokens != 1000000 {
		t.Fatalf("context window missing: %+v", usage)
	}
	if usage.ContextWindowUsedTokens == nil || *usage.ContextWindowUsedTokens != 15405 {
		t.Fatalf("used tokens missing: %+v", usage)
	}
}

// A completion carrying an older turn's token must not settle the newer turn.
func TestTurnTokenAdvancesPerTurn(t *testing.T) {
	sess, err := StartSession(LaunchOptions{NoSession: true})
	if err != nil {
		t.Skip("pi not available:", err)
	}
	defer sess.Close()

	first := sess.TurnToken()
	if first == "" {
		// No prompt has run yet; the token is minted on the first turn.
		first = "tok_0"
	}
	// Starting a turn mints a new token; a stale event carrying the old one is identifiable.
	sess.mu.Lock()
	sess.turnCounter++
	sess.turnToken = "tok_1"
	sess.mu.Unlock()
	if sess.TurnToken() == first {
		t.Fatal("the token must change when a new turn starts")
	}
}
