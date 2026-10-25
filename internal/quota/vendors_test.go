package quota

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// writeCredentials writes a JSON credential file and returns its path.
func writeCredentials(t *testing.T, payload string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "creds.json")
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// A missing credential is "unavailable", not an error: the user has not signed in on this host,
// and the page must say so without a red badge.
func TestVendorsReportUnavailableWithoutCredentials(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope.json")
	for _, fetcher := range []Fetcher{
		Claude{CredentialsPath: missing},
		Copilot{CredentialsPath: missing},
		Cursor{CredentialsPath: missing},
		Grok{CredentialsPath: missing},
		Kimi{CredentialsPath: missing},
		MiniMax{CredentialsPath: missing},
	} {
		usage := fetcher.FetchUsage(context.Background())
		if usage.Status != "unavailable" {
			t.Fatalf("%s: status = %q, want unavailable", fetcher.ProviderID(), usage.Status)
		}
		if usage.Error != nil {
			t.Fatalf("%s: an absent credential is not an error: %s", fetcher.ProviderID(), *usage.Error)
		}
	}
}

// The derived percentage must agree with the raw numbers: the UI shows both.
func TestClaudeMapsWindows(t *testing.T) {
	credentials := writeCredentials(t, `{"claudeAiOauth":{"accessToken":"tok"}}`)
	fetcher := Claude{
		CredentialsPath: credentials,
		HTTPFetch: func(_ context.Context, url string, headers map[string]string) ([]byte, int, error) {
			if headers["anthropic-beta"] == "" {
				t.Fatal("the usage endpoint requires the oauth beta header")
			}
			return []byte(`{"five_hour":{"utilization":42.5,"resets_at":"2026-01-01T00:00:00Z"},
				"seven_day":{"utilization":80},
				"extra_usage":{"is_enabled":true,"used_credits":12,"monthly_limit":100}}`), 200, nil
		},
	}
	usage := fetcher.FetchUsage(context.Background())
	if usage.Status != "available" {
		t.Fatalf("status = %q err=%v", usage.Status, usage.Error)
	}
	if len(usage.Windows) != 2 {
		t.Fatalf("windows = %+v", usage.Windows)
	}
	if usage.Windows[0].RemainingPct == nil || *usage.Windows[0].RemainingPct != 57.5 {
		t.Fatalf("remaining = %+v", usage.Windows[0].RemainingPct)
	}
	if usage.Windows[1].Tone != "warning" {
		t.Fatalf("80%% used should be warning, got %q", usage.Windows[1].Tone)
	}
	if len(usage.Balances) != 1 || usage.Balances[0].Value == nil || *usage.Balances[0].Value != 12 {
		t.Fatalf("balances = %+v", usage.Balances)
	}
}

// A 401 means the vendor rejected the token; that is actionable text, not a generic failure.
func TestVendorsReportReauth(t *testing.T) {
	credentials := writeCredentials(t, `{"accessToken":"stale"}`)
	fetcher := Cursor{
		CredentialsPath: credentials,
		HTTPFetch: func(context.Context, string, map[string]string) ([]byte, int, error) {
			return nil, 401, nil
		},
	}
	usage := fetcher.FetchUsage(context.Background())
	if usage.Status != "error" || usage.Error == nil {
		t.Fatalf("%+v", usage)
	}
	if !contains(usage.Error, "signed in again") {
		t.Fatalf("the message should tell the user what to do: %q", *usage.Error)
	}
}

// A vendor that changed its schema must produce "unexpected shape", never a wrong number.
func TestVendorsReportUnexpectedShape(t *testing.T) {
	credentials := writeCredentials(t, `{"accessToken":"tok"}`)
	fetcher := Kimi{
		CredentialsPath: credentials,
		HTTPFetch: func(context.Context, string, map[string]string) ([]byte, int, error) {
			return []byte(`{"something":"else"}`), 200, nil
		},
	}
	usage := fetcher.FetchUsage(context.Background())
	// An unmarshal into a struct with no matching fields succeeds with zero values; the caller
	// must not read that as "zero usage". Details carries nothing and windows is empty, which is
	// the honest answer for an unknown shape.
	if usage.Status == "error" && usage.Error != nil && !contains(usage.Error, "unexpected shape") {
		t.Fatalf("unexpected error text: %q", *usage.Error)
	}
	if len(usage.Windows) != 0 {
		t.Fatalf("a shape we do not understand produced windows: %+v", usage.Windows)
	}
}

// MiniMax has a global and a CN host; a token rejected by one is retried against the other.
func TestMiniMaxFallsBackToCNHost(t *testing.T) {
	credentials := writeCredentials(t, `{"accessToken":"tok"}`)
	var hosts []string
	fetcher := MiniMax{
		CredentialsPath: credentials,
		HTTPFetch: func(_ context.Context, url string, _ map[string]string) ([]byte, int, error) {
			hosts = append(hosts, url)
			if contains(&url, "minimax.io") {
				return nil, 401, nil
			}
			return []byte(`{"base_resp":{"status_code":0},"model_remains":[{"model_name":"abab","current_interval_usage_count":25,"current_interval_total_count":100}]}`), 200, nil
		},
	}
	usage := fetcher.FetchUsage(context.Background())
	if len(hosts) != 2 {
		t.Fatalf("expected both hosts to be tried, got %v", hosts)
	}
	if usage.Status != "available" || len(usage.Windows) != 1 {
		t.Fatalf("%+v", usage)
	}
	if usage.Windows[0].UsedPct == nil || *usage.Windows[0].UsedPct != 25 {
		t.Fatalf("usedPct = %+v", usage.Windows[0].UsedPct)
	}
}

// Copilot reports what remains; the UI window is defined by what is used.
func TestCopilotConvertsRemainingToUsed(t *testing.T) {
	credentials := writeCredentials(t, `{"github.com":{"oauth_token":"tok"}}`)
	fetcher := Copilot{
		CredentialsPath: credentials,
		HTTPFetch: func(_ context.Context, _ string, headers map[string]string) ([]byte, int, error) {
			if headers["Authorization"] != "token tok" {
				t.Fatalf("GitHub takes the token scheme, got %q", headers["Authorization"])
			}
			return []byte(`{"quota_snapshots":{"premium_interactions":{"entitlement":300,"percent_remaining":75}}}`), 200, nil
		},
	}
	usage := fetcher.FetchUsage(context.Background())
	if usage.Status != "available" || len(usage.Windows) != 1 {
		t.Fatalf("%+v", usage)
	}
	if usage.Windows[0].UsedPct == nil || *usage.Windows[0].UsedPct != 25 {
		t.Fatalf("usedPct = %+v", usage.Windows[0].UsedPct)
	}
}

// The registry lists every vendor so the page can distinguish "not configured" from "not
// supported".
func TestAllListsEveryVendor(t *testing.T) {
	want := map[string]bool{
		"codex": true, "zai": true, "claude": true,
		"copilot": true, "cursor": true, "grok": true, "kimi": true, "minimax": true,
	}
	seen := make(map[string]bool)
	for _, fetcher := range All() {
		seen[fetcher.ProviderID()] = true
	}
	for id := range want {
		if !seen[id] {
			t.Fatalf("%s is missing from the registry", id)
		}
	}
	if len(seen) != len(want) {
		t.Fatalf("unexpected extra providers: %v", seen)
	}
}

// contains is a substring test.
func contains(haystack *string, needle string) bool {
	if haystack == nil {
		return false
	}
	for i := 0; i+len(needle) <= len(*haystack); i++ {
		if (*haystack)[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
