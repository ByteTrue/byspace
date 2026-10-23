package server

import (
	"context"
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

// buildProviderCatalog probes and assembles a fresh catalog.
//
// This is the expensive path; do not call it from a request handler that has nothing cached.
func (s *Server) buildProviderCatalog(ctx context.Context, cfg map[string]any) *providerCatalog {
	models := s.probeOrCachedPiModels(ctx)
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

func (s *Server) cachedProviderCatalog() *providerCatalog {
	s.providerCatalogMu.Lock()
	defer s.providerCatalogMu.Unlock()
	return s.providerCatalogValue
}

func (s *Server) storeProviderCatalog(catalog *providerCatalog) {
	s.providerCatalogMu.Lock()
	s.providerCatalogValue = catalog
	s.providerCatalogMu.Unlock()
}

// providerCatalogOrBuild returns the cached catalog, building one only when nothing is cached.
//
// Serving the request synchronously from a fresh probe made the first catalog arrive about a
// second late and every later one about 190ms late, which is long enough for a client to submit a
// form before it knows which provider is selected.
func (s *Server) providerCatalogOrBuild(ctx context.Context) *providerCatalog {
	if catalog := s.cachedProviderCatalog(); catalog != nil {
		return catalog
	}
	catalog := s.buildProviderCatalog(ctx, s.store.LoadDaemonConfig())
	s.storeProviderCatalog(catalog)
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
