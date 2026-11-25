package providers

import (
	"context"
	"os"
	"runtime"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// ProviderCatalog is the model and mode metadata discovered from a provider runtime.
type ProviderCatalog struct {
	Models []sdk.CatalogModel
	Modes  []ModeDefinition
}

// FetchACPProviderCatalog starts a disposable ACP session and snapshots its native catalogs.
func FetchACPProviderCatalog(ctx context.Context, providerID string, providerConfig map[string]any, cwd string) (ProviderCatalog, error) {
	if cwd == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ProviderCatalog{}, err
		}
		cwd = home
	}
	spec, _ := ProviderSpecForLaunch(providerID, providerConfig)
	session, err := startACPSession(ctx, LaunchConfig{
		Provider: providerID, ProviderConfig: providerConfig, Cwd: cwd,
		Env: acpCatalogEnvironment(providerConfig),
	}, spec, "")
	if err != nil {
		return ProviderCatalog{}, err
	}
	defer session.Close()

	session.mu.Lock()
	defer session.mu.Unlock()
	catalog := ProviderCatalog{
		Models: make([]sdk.CatalogModel, 0, len(session.nativeModels)),
		Modes:  append([]ModeDefinition(nil), session.nativeModes...),
	}
	defaultModelID := session.model
	for _, model := range session.nativeModels {
		catalog.Models = append(catalog.Models, sdk.CatalogModel{
			ID: model.ID, Label: model.Name, Provider: providerID,
			IsDefault:    model.ID == defaultModelID || defaultModelID == "" && len(catalog.Models) == 0,
			IsSelectable: true,
		})
	}
	return catalog, nil
}

func acpCatalogEnvironment(providerConfig map[string]any) []string {
	env := acpConformanceEnvironment(providerConfig)
	filtered := env[:0]
	for _, entry := range env {
		name, _, _ := strings.Cut(entry, "=")
		if name == "NO_BROWSER" || runtime.GOOS == "windows" && strings.EqualFold(name, "NO_BROWSER") {
			continue
		}
		filtered = append(filtered, entry)
	}
	return append(filtered, "NO_BROWSER=true")
}
