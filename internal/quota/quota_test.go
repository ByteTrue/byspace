package quota

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Without a credential the page must say "unavailable", not "no quotas": the user acts
// differently on each.
func TestCodexUnavailableWithoutCredential(t *testing.T) {
	t.Setenv("CODEX_HOME", t.TempDir())
	usage := Codex{}.FetchUsage(context.Background())
	if usage.Status != "unavailable" {
		t.Fatalf("status = %q, want unavailable", usage.Status)
	}
	if usage.Windows == nil || usage.Balances == nil || usage.Details == nil {
		t.Fatal("empty collections must be [] not nil: the wire schema requires arrays")
	}
	if usage.Error != nil {
		t.Fatalf("a missing credential is not an error, got %v", *usage.Error)
	}
}

func TestZaiUnavailableWithoutKey(t *testing.T) {
	t.Setenv("ZAI_API_KEY", "")
	t.Setenv("GLM_API_KEY", "")
	usage := Zai{}.FetchUsage(context.Background())
	if usage.Status != "unavailable" {
		t.Fatalf("status = %q, want unavailable", usage.Status)
	}
}

// Windows, balances and the plan label all come from the vendor payload; a mapping mistake here
// shows wrong quota numbers, which is worse than showing none.
func TestCodexFetchesAndMapsWindows(t *testing.T) {
	home := t.TempDir()
	auth := map[string]any{
		"tokens": map[string]any{"access_token": "tok", "account_id": "acct"},
	}
	raw, _ := json.Marshal(auth)
	if err := os.WriteFile(filepath.Join(home, "auth.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEX_HOME", home)

	srv := stubServer(t, `{
      "plan_type": "pro",
      "rate_limit": {
        "primary_window": {"used_percent": 82, "reset_at": 1900000000},
        "secondary_window": {"used_percent": 12}
      },
      "credits": {"has_credits": true, "unlimited": false, "balance": 25}
    }`, &codexUsageURL)
	defer srv.Close()

	usage := Codex{}.FetchUsage(context.Background())
	if usage.Status != "available" {
		t.Fatalf("status = %q (%v)", usage.Status, usage.Error)
	}
	if usage.PlanLabel == nil || *usage.PlanLabel != "pro" {
		t.Fatalf("plan = %v", usage.PlanLabel)
	}
	if len(usage.Windows) != 2 {
		t.Fatalf("windows = %d, want 2", len(usage.Windows))
	}
	session := usage.Windows[0]
	if session.ID != "session" || session.UsedPct == nil || *session.UsedPct != 82 {
		t.Fatalf("session window: %+v", session)
	}
	if session.RemainingPct == nil || *session.RemainingPct != 18 {
		t.Fatalf("remaining must be derived: %+v", session.RemainingPct)
	}
	if session.Tone != "warning" {
		t.Fatalf("82%% should be warning, got %q", session.Tone)
	}
	if session.ResetsAt == nil {
		t.Fatal("resetsAt should be an RFC3339 string from the epoch seconds")
	}
	if len(usage.Balances) != 1 || usage.Balances[0].Value == nil || *usage.Balances[0].Value != 25 {
		t.Fatalf("balances: %+v", usage.Balances)
	}
}

// An expired token comes back as 401; that is "unavailable", not an error banner.
func TestCodexNeedsAuthIsUnavailable(t *testing.T) {
	home := t.TempDir()
	raw, _ := json.Marshal(map[string]any{"tokens": map[string]any{"access_token": "expired"}})
	if err := os.WriteFile(filepath.Join(home, "auth.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEX_HOME", home)

	srv := stubStatus(t, 401, &codexUsageURL)
	defer srv.Close()

	usage := Codex{}.FetchUsage(context.Background())
	if usage.Status != "unavailable" {
		t.Fatalf("status = %q, want unavailable", usage.Status)
	}
	if usage.Error != nil {
		t.Fatalf("401 is not an error the user can fix here: %v", *usage.Error)
	}
}

func TestZaiMapsSubscription(t *testing.T) {
	t.Setenv("ZAI_API_KEY", "key")
	srv := stubServer(t, `{"data":[{"productName":"GLM Pro","status":"active","valid":"2027-01-01"}]}`, &zaiUsageURL)
	defer srv.Close()

	usage := Zai{}.FetchUsage(context.Background())
	if usage.Status != "available" {
		t.Fatalf("status = %q (%v)", usage.Status, usage.Error)
	}
	if usage.PlanLabel == nil || *usage.PlanLabel != "GLM Pro" {
		t.Fatalf("plan = %v", usage.PlanLabel)
	}
	if len(usage.Details) != 2 {
		t.Fatalf("details = %+v", usage.Details)
	}
}

func TestToneThresholds(t *testing.T) {
	cases := map[float64]string{0: "normal", 74: "normal", 75: "warning", 89: "warning", 90: "critical", 100: "critical"}
	for used, want := range cases {
		if got := ToneFromUsedPct(used); got != want {
			t.Fatalf("ToneFromUsedPct(%v) = %q, want %q", used, got, want)
		}
	}
}
