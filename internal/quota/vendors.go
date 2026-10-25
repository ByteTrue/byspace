package quota

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// The remaining five vendors, ported from services/quota-fetcher/providers/**.
//
// Every one of them reads a credential the vendor's own CLI wrote and calls the vendor's usage
// endpoint read-only. None of them refreshes a token: a refresh races with the user's CLI and can
// log them out of their own tool, which is a worse outcome than a stale reading.
//
// What is NOT verified: the response shapes below come from reading the TypeScript parsers, and
// without real credentials nobody has confirmed the live endpoints still return them. A vendor
// that changed its schema shows up as "usage API returned an unexpected shape" rather than a wrong
// number, which is the safe failure — see the tests.

// Cursor reads Cursor's dashboard usage.
//
// The desktop build keeps the token in VS Code's SQLite state; the headless build (cursor-agent on
// a server) keeps it in ~/.config/cursor/auth.json. Only the file is read here: opening the SQLite
// database needs a driver this daemon does not carry, and a headless host is where a daemon
// usually runs.
type Cursor struct {
	HTTPFetch       func(ctx context.Context, url string, headers map[string]string) ([]byte, int, error)
	CredentialsPath string
}

func (Cursor) ProviderID() string  { return "cursor" }
func (Cursor) DisplayName() string { return "Cursor" }

// FetchUsage reads Cursor's current period usage.
func (c Cursor) FetchUsage(ctx context.Context) Usage {
	token, err := readTokenFile(c.CredentialsPath, filepath.Join(".config", "cursor", "auth.json"), "accessToken")
	if err != nil || token == "" {
		return Unavailable("cursor", "Cursor", "")
	}
	fetch := c.HTTPFetch
	if fetch == nil {
		fetch = fetchJSONRequest
	}
	body, status, fetchErr := fetch(ctx,
		"https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
		map[string]string{"Authorization": "Bearer " + token})
	if fetchErr != nil {
		return Unavailable("cursor", "Cursor", fetchErr.Error())
	}
	if status == 401 || status == 403 {
		return Unavailable("cursor", "Cursor", "Cursor needs to be signed in again")
	}

	var payload struct {
		HardLimit    *float64 `json:"hardLimit"`
		RequestsUsed *float64 `json:"requestsUsed"`
		UsagePercent *float64 `json:"usagePercent"`
		CycleEnd     *string  `json:"cycleEnd"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Unavailable("cursor", "Cursor", "usage API returned an unexpected shape")
	}

	usage := Usage{ProviderID: "cursor", DisplayName: "Cursor", Status: "available",
		Windows: []Window{}, Balances: []Balance{}, Details: []Detail{}}
	usedPct := payload.UsagePercent
	if usedPct == nil && payload.HardLimit != nil && payload.RequestsUsed != nil && *payload.HardLimit > 0 {
		// The vendor does not always send a percentage; deriving it keeps the two facts consistent.
		derived := (*payload.RequestsUsed / *payload.HardLimit) * 100
		usedPct = &derived
	}
	usage.Windows = append(usage.Windows, windowFromUsedPct("current_period", "Current period", usedPct, payload.CycleEnd))
	return usage
}

// Grok reads xAI's CLI billing credits.
type Grok struct {
	HTTPFetch       func(ctx context.Context, url string, headers map[string]string) ([]byte, int, error)
	CredentialsPath string
}

func (Grok) ProviderID() string  { return "grok" }
func (Grok) DisplayName() string { return "Grok" }

// FetchUsage reads the credit balance.
func (g Grok) FetchUsage(ctx context.Context) Usage {
	token, err := readTokenFile(g.CredentialsPath, filepath.Join(".grok", "auth.json"), "access_token")
	if err != nil || token == "" {
		return Unavailable("grok", "Grok", "")
	}
	fetch := g.HTTPFetch
	if fetch == nil {
		fetch = fetchJSONRequest
	}
	body, status, fetchErr := fetch(ctx,
		"https://cli-chat-proxy.grok.com/v1/billing?format=credits",
		map[string]string{"Authorization": "Bearer " + token})
	if fetchErr != nil {
		return Unavailable("grok", "Grok", fetchErr.Error())
	}
	if status == 401 || status == 403 {
		return Unavailable("grok", "Grok", "Grok needs to be signed in again")
	}

	var payload struct {
		Credits *float64 `json:"credits"`
		Balance *float64 `json:"balance"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Unavailable("grok", "Grok", "billing API returned an unexpected shape")
	}
	value := payload.Credits
	if value == nil {
		value = payload.Balance
	}
	usage := Usage{ProviderID: "grok", DisplayName: "Grok", Status: "available",
		Windows: []Window{}, Balances: []Balance{}, Details: []Detail{}}
	if value != nil {
		usage.Balances = append(usage.Balances, Balance{ID: "credits", Label: "Credits", Value: value, Unit: "credits"})
	}
	return usage
}

// Kimi reads Moonshot's coding usage.
type Kimi struct {
	HTTPFetch       func(ctx context.Context, url string, headers map[string]string) ([]byte, int, error)
	CredentialsPath string
}

func (Kimi) ProviderID() string  { return "kimi" }
func (Kimi) DisplayName() string { return "Kimi" }

// FetchUsage reads the usage windows.
func (k Kimi) FetchUsage(ctx context.Context) Usage {
	token, err := readTokenFile(k.CredentialsPath, filepath.Join(".kimi", "kimi-code.json"), "accessToken")
	if err != nil || token == "" {
		return Unavailable("kimi", "Kimi", "")
	}
	fetch := k.HTTPFetch
	if fetch == nil {
		fetch = fetchJSONRequest
	}
	body, status, fetchErr := fetch(ctx, "https://api.kimi.com/coding/v1/usages",
		map[string]string{"Authorization": "Bearer " + token})
	if fetchErr != nil {
		return Unavailable("kimi", "Kimi", fetchErr.Error())
	}
	if status == 401 || status == 403 {
		return Unavailable("kimi", "Kimi", "Kimi needs to be signed in again")
	}

	var payload struct {
		Data struct {
			Windows []struct {
				ID          string   `json:"id"`
				Label       string   `json:"label"`
				UsedPercent *float64 `json:"usedPercent"`
				ResetsAt    *string  `json:"resetsAt"`
			} `json:"windows"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Unavailable("kimi", "Kimi", "usage API returned an unexpected shape")
	}
	usage := Usage{ProviderID: "kimi", DisplayName: "Kimi", Status: "available",
		Windows: []Window{}, Balances: []Balance{}, Details: []Detail{}}
	for _, window := range payload.Data.Windows {
		label := window.Label
		if label == "" {
			label = window.ID
		}
		usage.Windows = append(usage.Windows, windowFromUsedPct(window.ID, label, window.UsedPercent, window.ResetsAt))
	}
	return usage
}

// MiniMax reads its coding plan usage, trying the global endpoint then the CN one.
type MiniMax struct {
	HTTPFetch       func(ctx context.Context, url string, headers map[string]string) ([]byte, int, error)
	CredentialsPath string
}

func (MiniMax) ProviderID() string  { return "minimax" }
func (MiniMax) DisplayName() string { return "MiniMax" }

// FetchUsage reads the plan usage.
func (m MiniMax) FetchUsage(ctx context.Context) Usage {
	token, err := readTokenFile(m.CredentialsPath, filepath.Join(".minimax", "credentials.json"), "accessToken")
	if err != nil || token == "" {
		return Unavailable("minimax", "MiniMax", "")
	}
	fetch := m.HTTPFetch
	if fetch == nil {
		fetch = fetchJSONRequest
	}

	// Two regions, two hostnames. Trying the global one first and falling back is what the node
	// implementation does: a CN account's token is rejected by the global host, and the reverse.
	var body []byte
	var status int
	var fetchErr error
	for _, base := range []string{"https://api.minimax.io", "https://api.minimaxi.com"} {
		body, status, fetchErr = fetch(ctx, base+"/v1/api/openplatform/coding_plan/remains",
			map[string]string{"Authorization": "Bearer " + token})
		if fetchErr == nil && status >= 200 && status < 300 {
			break
		}
	}
	if fetchErr != nil {
		return Unavailable("minimax", "MiniMax", fetchErr.Error())
	}
	if status == 401 || status == 403 {
		return Unavailable("minimax", "MiniMax", "MiniMax needs to be signed in again")
	}

	var payload struct {
		BaseResp *struct {
			StatusCode int    `json:"status_code"`
			StatusMsg  string `json:"status_msg"`
		} `json:"base_resp"`
		ModelRemains []struct {
			ModelName string   `json:"model_name"`
			Used      *float64 `json:"current_interval_usage_count"`
			Total     *float64 `json:"current_interval_total_count"`
		} `json:"model_remains"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Unavailable("minimax", "MiniMax", "usage API returned an unexpected shape")
	}
	if payload.BaseResp != nil && payload.BaseResp.StatusCode != 0 {
		return Unavailable("minimax", "MiniMax", payload.BaseResp.StatusMsg)
	}

	usage := Usage{ProviderID: "minimax", DisplayName: "MiniMax", Status: "available",
		Windows: []Window{}, Balances: []Balance{}, Details: []Detail{}}
	for _, remain := range payload.ModelRemains {
		if remain.Total == nil || *remain.Total <= 0 || remain.Used == nil {
			continue
		}
		usedPct := (*remain.Used / *remain.Total) * 100
		usage.Windows = append(usage.Windows,
			windowFromUsedPct(remain.ModelName, remain.ModelName, &usedPct, nil))
	}
	return usage
}

// Copilot reads GitHub Copilot's entitlement.
type Copilot struct {
	HTTPFetch       func(ctx context.Context, url string, headers map[string]string) ([]byte, int, error)
	CredentialsPath string
}

func (Copilot) ProviderID() string  { return "copilot" }
func (Copilot) DisplayName() string { return "GitHub Copilot" }

// FetchUsage reads the premium-request entitlement.
func (c Copilot) FetchUsage(ctx context.Context) Usage {
	token, err := readTokenFile(c.CredentialsPath, filepath.Join(".config", "github-copilot", "hosts.json"), "")
	if err != nil || token == "" {
		return Unavailable("copilot", "GitHub Copilot", "")
	}
	fetch := c.HTTPFetch
	if fetch == nil {
		fetch = fetchJSONRequest
	}
	// `token`, not `Bearer`: the Copilot endpoint takes GitHub's own scheme.
	body, status, fetchErr := fetch(ctx, "https://api.github.com/copilot_internal/user",
		map[string]string{
			"Authorization":  "token " + token,
			"Accept":         "application/json",
			"Editor-Version": "byspace",
		})
	if fetchErr != nil {
		return Unavailable("copilot", "GitHub Copilot", fetchErr.Error())
	}
	if status == 401 || status == 403 {
		return Unavailable("copilot", "GitHub Copilot", "GitHub Copilot needs to be signed in again")
	}

	var payload struct {
		QuotaSnapshots map[string]struct {
			Entitlement      *float64 `json:"entitlement"`
			PercentRemaining *float64 `json:"percent_remaining"`
		} `json:"quota_snapshots"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Unavailable("copilot", "GitHub Copilot", "usage API returned an unexpected shape")
	}

	usage := Usage{ProviderID: "copilot", DisplayName: "GitHub Copilot", Status: "available",
		Windows: []Window{}, Balances: []Balance{}, Details: []Detail{}}
	for id, snapshot := range payload.QuotaSnapshots {
		if snapshot.PercentRemaining == nil {
			continue
		}
		// The endpoint reports what remains; the UI window is defined by what is used, so the
		// conversion happens once, here.
		usedPct := 100 - *snapshot.PercentRemaining
		if usedPct < 0 {
			usedPct = 0
		}
		usage.Windows = append(usage.Windows, windowFromUsedPct(id, id, &usedPct, nil))
	}
	return usage
}

// readTokenFile loads the first non-empty token found in a JSON credential file.
//
// `key` names the field holding the token. Empty means the file is a map of host to token object
// (GitHub Copilot's hosts.json), so the first value wins.
func readTokenFile(override, relativePath, key string) (string, error) {
	path := override
	if path == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(userHome, relativePath)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		// A missing credential is normal: the vendor's CLI is simply not installed or not signed
		// in on this host.
		return "", nil
	}

	if key != "" {
		var stored map[string]any
		if err := json.Unmarshal(raw, &stored); err != nil {
			return "", err
		}
		if value, ok := stored[key].(string); ok {
			return strings.TrimSpace(value), nil
		}
		return "", nil
	}

	var hosts map[string]map[string]any
	if err := json.Unmarshal(raw, &hosts); err != nil {
		return "", err
	}
	for _, entry := range hosts {
		for _, field := range []string{"oauth_token", "token", "accessToken"} {
			if value, ok := entry[field].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value), nil
			}
		}
	}
	return "", nil
}
