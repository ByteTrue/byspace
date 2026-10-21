// Package quota fetches provider subscription usage.
//
// Ported from services/quota-fetcher. Each provider exposes a different API and credential
// store, but they all produce one Usage shape, so the Usage settings page renders one set of
// windows and balances regardless of vendor.
//
// The daemon used to answer provider.usage.list with an empty array, which made the page look
// like "you have no quotas" instead of "this build cannot read them" — the two are different
// facts and the user acts differently on each.
package quota

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// httpTimeout bounds a single provider call. A slow vendor API must not stall the settings
// page: it shows "unavailable" instead of spinning.
const httpTimeout = 15 * time.Second

// Window is one rolling quota window (session, weekly, …).
type Window struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	UsedPct      *float64 `json:"usedPct"`
	RemainingPct *float64 `json:"remainingPct"`
	ResetsAt     *string  `json:"resetsAt"`
	Tone         string   `json:"tone,omitempty"`
}

// Balance is a credit-style quantity rather than a percentage.
type Balance struct {
	ID    string   `json:"id"`
	Label string   `json:"label"`
	Value *float64 `json:"value"`
	Unit  string   `json:"unit,omitempty"`
	Tone  string   `json:"tone,omitempty"`
}

// Detail is an arbitrary key/value shown under the plan label.
type Detail struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Value string `json:"value"`
}

// Usage is the per-provider result.
type Usage struct {
	ProviderID  string    `json:"providerId"`
	DisplayName string    `json:"displayName"`
	Status      string    `json:"status"` // "available" | "unavailable" | "error"
	PlanLabel   *string   `json:"planLabel"`
	Windows     []Window  `json:"windows"`
	Balances    []Balance `json:"balances"`
	Details     []Detail  `json:"details"`
	Error       *string   `json:"error"`
}

// Fetcher reads one provider's usage.
type Fetcher interface {
	ProviderID() string
	DisplayName() string
	FetchUsage(ctx context.Context) Usage
}

// Unavailable builds the "nothing to show" result for a provider.
//
// An absent credential is not an error: the user simply has not configured that provider, and
// the page must say so without a red error.
func Unavailable(providerID, displayName, errText string) Usage {
	status := "unavailable"
	var errPtr *string
	if errText != "" {
		status = "error"
		errPtr = &errText
	}
	return Usage{
		ProviderID:  providerID,
		DisplayName: displayName,
		Status:      status,
		Windows:     []Window{},
		Balances:    []Balance{},
		Details:     []Detail{},
		Error:       errPtr,
	}
}

// windowFromUsedPct mirrors windowFromUsedPct in usage.ts: remaining is derived, never sent by
// the vendor, so the two can never disagree.
func windowFromUsedPct(id, label string, usedPct *float64, resetsAt *string) Window {
	w := Window{ID: id, Label: label, UsedPct: usedPct, ResetsAt: resetsAt}
	if usedPct != nil {
		remaining := 100 - *usedPct
		if remaining < 0 {
			remaining = 0
		}
		w.RemainingPct = &remaining
		w.Tone = ToneFromUsedPct(*usedPct)
	}
	return w
}

// ToneFromUsedPct maps utilisation to the UI's severity tone.
func ToneFromUsedPct(usedPct float64) string {
	switch {
	case usedPct >= 90:
		return "critical"
	case usedPct >= 75:
		return "warning"
	default:
		return "normal"
	}
}

// fetchJSON performs the shared provider HTTP call: bounded time, capped body, explicit status
// error.
func fetchJSON(ctx context.Context, url string, headers map[string]string, out any) (int, string, error) {
	cctx, cancel := context.WithTimeout(ctx, httpTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(cctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, "", err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return resp.StatusCode, "", readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, string(body), fmt.Errorf("provider API returned %d", resp.StatusCode)
	}
	if out != nil {
		if jsonErr := json.Unmarshal(body, out); jsonErr != nil {
			return resp.StatusCode, string(body), jsonErr
		}
	}
	return resp.StatusCode, string(body), nil
}
