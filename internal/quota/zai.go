package quota

import (
	"context"
	"os"
	"strings"
)

// zaiUsageURL is a variable so tests can point it at a stub server.
var zaiUsageURL = "https://api.z.ai/api/biz/subscription/list"

// Zai reads the Z.ai / GLM subscription list with an API key from the environment.
//
// Ported from providers/zai.ts. Two env names exist because the vendor renamed the product; the
// old one still ships in users' shells.
type Zai struct{}

// ProviderID identifies this fetcher.
func (Zai) ProviderID() string { return "zai" }

// DisplayName is the label shown on the Usage page.
func (Zai) DisplayName() string { return "Z.ai" }

type zaiUsageResponse struct {
	Data []struct {
		ProductName  string `json:"productName"`
		Status       string `json:"status"`
		PurchaseTime string `json:"purchaseTime"`
		Valid        string `json:"valid"`
	} `json:"data"`
}

// FetchUsage returns the first subscription's details, or unavailable without a key.
func (z Zai) FetchUsage(ctx context.Context) Usage {
	token := firstEnv("ZAI_API_KEY", "GLM_API_KEY")
	if token == "" {
		return Unavailable(z.ProviderID(), z.DisplayName(), "")
	}

	var resp zaiUsageResponse
	_, _, err := fetchJSON(ctx, zaiUsageURL, map[string]string{
		"Authorization": "Bearer " + token,
	}, &resp)
	if err != nil {
		return Unavailable(z.ProviderID(), z.DisplayName(), err.Error())
	}
	if len(resp.Data) == 0 {
		return Unavailable(z.ProviderID(), z.DisplayName(), "")
	}

	sub := resp.Data[0]
	usage := Usage{
		ProviderID:  z.ProviderID(),
		DisplayName: z.DisplayName(),
		Status:      "available",
		Windows:     []Window{},
		Balances:    []Balance{},
		Details:     []Detail{},
	}
	if sub.ProductName != "" {
		plan := sub.ProductName
		usage.PlanLabel = &plan
	}
	if sub.Status != "" {
		usage.Details = append(usage.Details, Detail{ID: "status", Label: "Status", Value: sub.Status})
	}
	if sub.Valid != "" {
		usage.Details = append(usage.Details, Detail{ID: "valid", Label: "Valid", Value: sub.Valid})
	}
	if sub.PurchaseTime != "" {
		usage.Details = append(usage.Details, Detail{ID: "purchase_time", Label: "Purchased", Value: sub.PurchaseTime})
	}
	return usage
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			return v
		}
	}
	return ""
}
