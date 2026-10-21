package quota

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Claude reads Claude Code's OAuth usage endpoint.
//
// Ported from providers/claude.ts. The credential comes from the CLI's own store — the file on
// Linux/Windows, the login keychain on macOS — and is used read-only: refreshing it would race with
// the CLI and can log the user out of their own tool.
type Claude struct {
	// HTTPFetch overrides the request, for tests.
	HTTPFetch func(ctx context.Context, url string, headers map[string]string) ([]byte, int, error)
	// CredentialsPath overrides the credential file location.
	CredentialsPath string
}

// claudeOAuthBeta is the header the usage endpoint requires.
const claudeOAuthBeta = "oauth-2025-04-20"

func (Claude) ProviderID() string  { return "claude" }
func (Claude) DisplayName() string { return "Claude Code" }

// FetchUsage reads the five-hour and weekly windows.
func (c Claude) FetchUsage(ctx context.Context) Usage {
	token, err := c.accessToken()
	if err != nil || token == "" {
		// No credential is "unavailable", not an error: the user has not signed in to Claude Code
		// on this machine, which the page should say plainly.
		return Unavailable("claude", "Claude Code", "")
	}

	body, status, fetchErr := c.fetch(ctx, "https://api.anthropic.com/api/oauth/usage", map[string]string{
		"Authorization":  "Bearer " + token,
		"Accept":         "application/json",
		"anthropic-beta": claudeOAuthBeta,
	})
	if fetchErr != nil {
		return Unavailable("claude", "Claude Code", fetchErr.Error())
	}
	if status == 401 || status == 403 {
		return Unavailable("claude", "Claude Code", "Claude Code needs to be signed in again")
	}
	if status < 200 || status >= 300 {
		return Unavailable("claude", "Claude Code", fmt.Sprintf("usage API returned %d", status))
	}

	var payload struct {
		FiveHour *struct {
			Utilization *float64 `json:"utilization"`
			ResetsAt    *string  `json:"resets_at"`
		} `json:"five_hour"`
		SevenDay *struct {
			Utilization *float64 `json:"utilization"`
			ResetsAt    *string  `json:"resets_at"`
		} `json:"seven_day"`
		ExtraUsage *struct {
			IsEnabled bool     `json:"is_enabled"`
			Used      *float64 `json:"used_credits"`
			Limit     *float64 `json:"monthly_limit"`
		} `json:"extra_usage"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Unavailable("claude", "Claude Code", "usage API returned an unexpected shape")
	}

	usage := Usage{
		ProviderID:  "claude",
		DisplayName: "Claude Code",
		Status:      "available",
		Windows:     []Window{},
		Balances:    []Balance{},
		Details:     []Detail{},
	}
	if payload.FiveHour != nil {
		usage.Windows = append(usage.Windows,
			windowFromUsedPct("five_hour", "5-hour window", payload.FiveHour.Utilization, payload.FiveHour.ResetsAt))
	}
	if payload.SevenDay != nil {
		usage.Windows = append(usage.Windows,
			windowFromUsedPct("seven_day", "Weekly", payload.SevenDay.Utilization, payload.SevenDay.ResetsAt))
	}
	if payload.ExtraUsage != nil && payload.ExtraUsage.IsEnabled {
		// Extra usage is a balance rather than a percentage: the vendor reports credits spent.
		usage.Balances = append(usage.Balances, Balance{
			ID:    "extra_usage",
			Label: "Extra usage",
			Value: payload.ExtraUsage.Used,
			Unit:  "credits",
		})
	}
	return usage
}

// fetch performs the request.
func (c Claude) fetch(ctx context.Context, url string, headers map[string]string) ([]byte, int, error) {
	if c.HTTPFetch != nil {
		return c.HTTPFetch(ctx, url, headers)
	}
	return fetchJSONRequest(ctx, url, headers)
}

// accessToken reads the OAuth token from Claude Code's store.
//
// macOS keeps it in the login keychain; the other platforms use ~/.claude/.credentials.json. The
// keychain path is not implemented here because it needs a `security` invocation and this daemon
// has no way to verify the result in CI — the file path covers Linux and Windows, and on macOS the
// caller gets "unavailable" rather than a wrong answer.
func (c Claude) accessToken() (string, error) {
	path := c.CredentialsPath
	if path == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(userHome, ".claude", ".credentials.json")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && runtime.GOOS == "darwin" {
			return "", fmt.Errorf("macOS stores Claude credentials in the login keychain")
		}
		return "", err
	}
	var stored struct {
		ClaudeAIOAuth *struct {
			AccessToken string `json:"accessToken"`
		} `json:"claudeAiOauth"`
	}
	if err := json.Unmarshal(raw, &stored); err != nil {
		return "", err
	}
	if stored.ClaudeAIOAuth == nil {
		return "", nil
	}
	return strings.TrimSpace(stored.ClaudeAIOAuth.AccessToken), nil
}
