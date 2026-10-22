package server

import (
	"context"
	"strings"
	"sync"

	"github.com/ByteTrue/byspace/internal/agent/providers"
)

// providerCatalogByScope caches the provider catalog per probe scope.
//
// Ported from ProviderSnapshotManager's `catalogs: Map<scopeKey, Map<provider, catalog>>`. A scope is a cwd, with the
// empty string for the host-wide catalog. The separation is load-bearing: refreshing a project's catalog refreshes only
// that project, and the host catalog keeps whatever it last observed. Sharing one cache made a project refresh overwrite
// the host's answer, so a provider that was unavailable host-wide reported ready again after any project refresh.
type providerCatalogByScope struct {
	mu    sync.RWMutex
	byKey map[string][]map[string]any
}

// providerScopeKey normalizes a probe scope.
//
// The empty scope and the daemon's own directory are the same catalog in node, so they share one key; otherwise
// `getProvidersSnapshot()` and `getProvidersSnapshot({cwd: <daemon cwd>})` would disagree.
func providerScopeKey(cwd string) string {
	return strings.TrimSpace(cwd)
}

// catalog returns the entries a scope last observed, or nil when it has never been probed.
//
// The whole entry list is cached, not just availability: a read must answer from what this scope already established,
// because re-probing on every read is exactly what erased the difference between "the host saw the binary go missing" and
// "a project happened to refresh afterwards".
func (c *providerCatalogByScope) catalog(scope string) []map[string]any {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entries := c.byKey[providerScopeKey(scope)]
	if entries == nil {
		return nil
	}
	out := make([]map[string]any, len(entries))
	copy(out, entries)
	return out
}

// store records the entries observed in a scope.
func (c *providerCatalogByScope) store(scope string, entries []map[string]any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.byKey == nil {
		c.byKey = make(map[string][]map[string]any)
	}
	stored := make([]map[string]any, len(entries))
	copy(stored, entries)
	c.byKey[providerScopeKey(scope)] = stored
}

// invalidate drops one scope, or every scope when cwd is empty.
func (c *providerCatalogByScope) invalidate(scope string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.TrimSpace(scope) == "" {
		c.byKey = nil
		return
	}
	delete(c.byKey, providerScopeKey(scope))
}

// buildSnapshotForScope probes the catalog for one scope and records its availability.
//
// Probing always runs: models and modes can change without the binary moving. What the scope cache pins is availability,
// which is the fact a refresh is asserting.
func (s *Server) buildSnapshotForScope(ctx context.Context, scope string) []map[string]any {
	models := s.probeOrCachedPiModels(ctx)
	cfg := s.store.LoadDaemonConfig()
	customProvs, _ := cfg["providers"].(map[string]any)
	entries := providers.BuildSnapshotEntries(models, s.piCommand, customProvs)
	s.providerStatuses.store(scope, entries)
	return entries
}
