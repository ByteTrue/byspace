package quota

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// codexUsageURL is a variable so tests can point it at a stub server; the real endpoint
// rejects anything but a live ChatGPT access token.
var codexUsageURL = "https://chatgpt.com/backend-api/wham/usage"

// Codex reads ~/.codex/auth.json and asks OpenAI for the account's rate windows.
//
// Ported from providers/codex.ts. The credential is read-only: the Codex CLI owns refresh, and
// two daemons rotating the same token would log the user out.
type Codex struct{}

// ProviderID identifies this fetcher.
func (Codex) ProviderID() string { return "codex" }

// DisplayName is the label shown on the Usage page.
func (Codex) DisplayName() string { return "Codex" }

type codexAuth struct {
	Tokens *struct {
		AccessToken string `json:"access_token"`
		AccountID   string `json:"account_id"`
	} `json:"tokens"`
}

type codexWindow struct {
	UsedPercent *float64 `json:"used_percent"`
	ResetAt     *float64 `json:"reset_at"`
}

type codexUsageResponse struct {
	PlanType  string `json:"plan_type"`
	RateLimit *struct {
		PrimaryWindow   *codexWindow `json:"primary_window"`
		SecondaryWindow *codexWindow `json:"secondary_window"`
	} `json:"rate_limit"`
	CodeReviewRateLimit *struct {
		PrimaryWindow *codexWindow `json:"primary_window"`
	} `json:"code_review_rate_limit"`
	Credits *struct {
		HasCredits bool     `json:"has_credits"`
		Unlimited  bool     `json:"unlimited"`
		Balance    *float64 `json:"balance"`
	} `json:"credits"`
}

// FetchUsage returns the account's windows, or unavailable when no credential is present.
func (c Codex) FetchUsage(ctx context.Context) Usage {
	auth, ok := readCodexAuth()
	if !ok || auth.Tokens == nil || auth.Tokens.AccessToken == "" {
		return Unavailable(c.ProviderID(), c.DisplayName(), "")
	}

	headers := map[string]string{
		"Authorization": "Bearer " + auth.Tokens.AccessToken,
		// The endpoint rejects the default Go user agent.
		"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
	}
	if auth.Tokens.AccountID != "" {
		headers["ChatGPT-Account-Id"] = auth.Tokens.AccountID
	}

	var resp codexUsageResponse
	status, body, err := fetchJSON(ctx, codexUsageURL, headers, &resp)
	if status == 401 || status == 403 || strings.HasPrefix(strings.TrimSpace(body), "<") {
		// Needs a refresh only the CLI can do; not an error the user can act on here.
		return Unavailable(c.ProviderID(), c.DisplayName(), "")
	}
	if err != nil {
		return Unavailable(c.ProviderID(), c.DisplayName(), err.Error())
	}

	usage := Usage{
		ProviderID:  c.ProviderID(),
		DisplayName: c.DisplayName(),
		Status:      "available",
		Windows:     []Window{},
		Balances:    []Balance{},
		Details:     []Detail{},
	}
	if resp.PlanType != "" {
		plan := resp.PlanType
		usage.PlanLabel = &plan
	}
	if resp.RateLimit != nil {
		if w := toCodexWindow(resp.RateLimit.PrimaryWindow); w != nil {
			usage.Windows = append(usage.Windows, windowFromUsedPct("session", "Session", w.used, w.resetsAt))
		}
		if w := toCodexWindow(resp.RateLimit.SecondaryWindow); w != nil {
			usage.Windows = append(usage.Windows, windowFromUsedPct("weekly", "Weekly", w.used, w.resetsAt))
		}
	}
	if resp.CodeReviewRateLimit != nil {
		if w := toCodexWindow(resp.CodeReviewRateLimit.PrimaryWindow); w != nil {
			usage.Windows = append(usage.Windows, windowFromUsedPct("code_review", "Code review", w.used, w.resetsAt))
		}
	}
	if resp.Credits != nil && resp.Credits.HasCredits && !resp.Credits.Unlimited && resp.Credits.Balance != nil {
		usage.Balances = append(usage.Balances, Balance{
			ID:    "credits",
			Label: "Credits",
			Value: resp.Credits.Balance,
		})
	}
	return usage
}

type codexWindowValue struct {
	used     *float64
	resetsAt *string
}

func toCodexWindow(w *codexWindow) *codexWindowValue {
	if w == nil {
		return nil
	}
	out := &codexWindowValue{used: w.UsedPercent}
	if w.ResetAt != nil {
		// The API reports seconds since epoch.
		ts := time.Unix(int64(*w.ResetAt), 0).UTC().Format(time.RFC3339)
		out.resetsAt = &ts
	}
	return out
}

// readCodexAuth loads ~/.codex/auth.json, honouring CODEX_HOME.
func readCodexAuth() (codexAuth, bool) {
	home := strings.TrimSpace(os.Getenv("CODEX_HOME"))
	if home == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return codexAuth{}, false
		}
		home = filepath.Join(userHome, ".codex")
	}
	raw, err := os.ReadFile(filepath.Join(home, "auth.json"))
	if err != nil {
		return codexAuth{}, false
	}
	var auth codexAuth
	if json.Unmarshal(raw, &auth) != nil {
		return codexAuth{}, false
	}
	return auth, true
}
