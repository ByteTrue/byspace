package server

import (
	"context"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
)

// providerCatalog is the provider snapshot the daemon serves from memory.
//
// It exists because building one is slow: every built-in provider's CLI is executed to decide
// whether it is available, and a cold pi probe spawns the CLI. Node keeps the same state in its
// snapshot manager and answers reads from it.
type providerCatalog struct {
	entries     []map[string]any
	hash        string
	fetchedAt   map[string]string
	generatedAt string
	compact     map[string]any
}

// providerCatalogKey normalizes the scope a catalog belongs to.
//
// An empty scope is the host-wide catalog. Anything else is a workspace: Node keys its snapshot
// manager the same way, because the same provider can expose different models (and a different
// availability answer) in different checkouts.
func providerCatalogKey(cwd string) string {
	trimmed := strings.TrimSpace(cwd)
	if trimmed == "" {
		return ""
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return filepath.Clean(trimmed)
	}
	return absolute
}

// buildProviderCatalog probes and assembles a fresh catalog for one scope.
//
// This is the expensive path; do not call it from a request handler that has nothing cached.
func (s *Server) buildProviderCatalog(ctx context.Context, cfg map[string]any, cwd string) *providerCatalog {
	models := s.probePiModelsInCwd(ctx, cwd)
	entries := providers.BuildSnapshotEntries(models, s.piCommand, providersFromConfig(cfg))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return &providerCatalog{
		entries:     entries,
		hash:        providerSnapshotHash(entries),
		fetchedAt:   providerFetchedAt(entries, now),
		generatedAt: now,
		compact:     providers.BuildCompactSnapshot(entries),
	}
}

// providerConfigFor returns the daemon-config entry for one provider, or nil.
//
// The saved entry decides `extends` and the launch argv, and a provider the user added exists only
// here — `GetProviderSpec` cannot know about it.
func (s *Server) providerConfigFor(providerID string) map[string]any {
	providersCfg := providersFromConfig(s.store.LoadDaemonConfig())
	if providersCfg == nil {
		return nil
	}
	entry, _ := providersCfg[providerID].(map[string]any)
	return entry
}

func (s *Server) cachedProviderCatalog(cwd string) *providerCatalog {
	s.providerCatalogMu.Lock()
	defer s.providerCatalogMu.Unlock()
	return s.providerCatalogs[providerCatalogKey(cwd)]
}

// storeProviderCatalog caches a catalog for one scope. A nil catalog drops the scope, which is how
// a refresh asks for a fresh probe instead of the cached answer.
func (s *Server) storeProviderCatalog(cwd string, catalog *providerCatalog) {
	key := providerCatalogKey(cwd)
	s.providerCatalogMu.Lock()
	defer s.providerCatalogMu.Unlock()
	if catalog == nil {
		delete(s.providerCatalogs, key)
		return
	}
	s.providerCatalogs[key] = catalog
}

// providerCatalogOrBuild returns the cached catalog, building one only when nothing is cached.
//
// Serving the request synchronously from a fresh probe made the first catalog arrive about a
// second late and every later one about 190ms late, which is long enough for a client to submit a
// form before it knows which provider is selected.
func (s *Server) providerCatalogOrBuild(ctx context.Context, cwd string) *providerCatalog {
	if catalog := s.cachedProviderCatalog(cwd); catalog != nil {
		return catalog
	}
	// A workspace without its own catalog reads the host one rather than paying a probe: the two
	// differ only when a refresh narrowed a scope, and the client keeps its per-cwd cache anyway.
	if cwd != "" {
		if catalog := s.cachedProviderCatalog(""); catalog != nil {
			return catalog
		}
	}
	catalog := s.buildProviderCatalog(ctx, s.store.LoadDaemonConfig(), cwd)
	s.storeProviderCatalog(cwd, catalog)
	return catalog
}

// payload renders the catalog as the body of get_providers_snapshot_response.
func (c *providerCatalog) payload(requestID, cwd string, notModified bool) map[string]any {
	if notModified {
		// The envelope still identifies the catalog: the client reuses the cached body and needs
		// the hash to know which one, so a bare notModified would drop the update.
		return map[string]any{
			"requestId":    requestID,
			"generatedAt":  c.generatedAt,
			"notModified":  true,
			"entries":      []any{},
			"snapshotHash": c.hash,
			"fetchedAt":    c.fetchedAt,
		}
	}
	payload := map[string]any{
		"requestId":   requestID,
		"generatedAt": c.generatedAt,
		"entries":     c.entries,
		// snapshotHash lets the client skip re-applying an identical catalog and is what
		// `ifNoneMatch` compares against on the next call.
		"snapshotHash": c.hash,
		// fetchedAt drives the "last refreshed" line in the providers sheet.
		"fetchedAt": c.fetchedAt,
		// compactSnapshot is the same catalog with thinking option lists deduped; the app's
		// provider cache reads it to avoid re-downloading identical option sets.
		"compactSnapshot": c.compact,
	}
	if strings.TrimSpace(cwd) != "" {
		payload["cwd"] = cwd
	}
	return payload
}
