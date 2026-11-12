package server

import (
	"context"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
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

// buildCatalog assembles a catalog from the models the caller already has.
//
// A nil discover func means "spec models only": the runtime model-discovery probes do not run,
// which is what a request can afford while the probing build is still in flight.
func (s *Server) buildCatalog(cfg map[string]any, discover func(providerID string) []sdk.CatalogModel) *providerCatalog {
	entries := providers.BuildSnapshotEntries(discover, s.piCommand, providersFromConfig(cfg))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return &providerCatalog{
		entries:     entries,
		hash:        providerSnapshotHash(entries),
		fetchedAt:   providerFetchedAt(entries, now),
		generatedAt: now,
		compact:     providers.BuildCompactSnapshot(entries),
	}
}

// buildProviderCatalog probes and assembles a fresh catalog for one scope.
//
// This is the expensive path; it runs in the background, never in a request handler.
func (s *Server) buildProviderCatalog(ctx context.Context, cfg map[string]any, cwd string) *providerCatalog {
	piModels := s.probePiModelsInCwd(ctx, cwd)
	return s.buildCatalog(cfg, func(providerID string) []sdk.CatalogModel {
		// Pi was just probed (its catalog drives the naming model too); do not spawn it twice.
		if providerID == "pi" {
			return piModels
		}
		return s.discoveredModels(ctx, providerID, cwd)
	})
}

// discoveredModels asks a provider for the models it actually offers right now.
//
// Only providers whose catalog depends on the user's own config live here. The result is empty when
// the probe fails or the provider has no runtime discovery, and the caller keeps the spec catalog.
func (s *Server) discoveredModels(ctx context.Context, providerID, cwd string) []sdk.CatalogModel {
	switch providerID {
	case "pi":
		return s.probePiModelsInCwd(ctx, cwd)
	case "claude":
		return providers.ClaudeModelsWithSettings()
	case "opencode":
		spec, argv := providers.ProviderSpecForLaunch(providerID, s.providerConfigFor(providerID))
		command := spec.Binary
		if len(argv) > 0 {
			command = argv[0]
		}
		return providers.ProbeOpenCodeModels(ctx, command, cwd)
	}
	return nil
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

// rebuildProviderCatalog builds a fresh catalog and caches it, unless it went stale while it
// probed: a build that started later already cached its catalog, or a providers edit happened. It
// reports whether the catalog is current.
//
// Builds take a second or more, so two overlap whenever a config edit lands during one (adding a
// provider right after removing one). Caching whichever finished last let the older catalog
// overwrite the newer and broadcast a provider list without the provider just added. Node's
// snapshot manager drops results from a superseded registry generation the same way.
func (s *Server) rebuildProviderCatalog(ctx context.Context, cfg map[string]any, cwd string) (*providerCatalog, bool) {
	ticket := s.beginProviderCatalogBuild()
	catalog := s.buildProviderCatalog(ctx, cfg, cwd)
	return catalog, s.commitProviderCatalog(cwd, ticket, catalog)
}

func (s *Server) beginProviderCatalogBuild() uint64 {
	s.providerCatalogMu.Lock()
	defer s.providerCatalogMu.Unlock()
	s.providerCatalogSeq++
	return s.providerCatalogSeq
}

// commitProviderCatalog caches the catalog a build produced if the build is still the newest for
// its scope and started after the last providers edit.
func (s *Server) commitProviderCatalog(cwd string, ticket uint64, catalog *providerCatalog) bool {
	key := providerCatalogKey(cwd)
	s.providerCatalogMu.Lock()
	defer s.providerCatalogMu.Unlock()
	if ticket <= s.providerCatalogFloor || ticket <= s.providerCatalogPublished[key] {
		return false
	}
	if s.providerCatalogPublished == nil {
		s.providerCatalogPublished = make(map[string]uint64)
	}
	s.providerCatalogPublished[key] = ticket
	s.providerCatalogs[key] = catalog
	return true
}

// invalidateProviderCatalogs drops every scope, and makes every build already running stale.
//
// A providers-config edit is global: the same entry decides availability, models and modes in the
// host catalog and in every workspace-scoped one. Rebuilding only the host scope left the
// workspace catalogs serving the provider exactly as it was before the edit, so a client that had
// already read the scoped catalog kept seeing a provider the user had just disabled.
func (s *Server) invalidateProviderCatalogs() {
	s.providerCatalogMu.Lock()
	defer s.providerCatalogMu.Unlock()
	s.providerCatalogs = make(map[string]*providerCatalog)
	s.providerCatalogFloor = s.providerCatalogSeq
}

// providerCatalogOrBuild returns the cached catalog, or the spec-only one while the probing build
// runs in the background.
//
// The read must never wait for a probe. Building runs every provider CLI to discover its models —
// `opencode models` alone can take seconds, and a stuck one runs to its timeout — so serving the
// first request synchronously left the app rendering an empty provider list; the model picker then
// opened before any provider existed and stayed on the provider step.
func (s *Server) providerCatalogOrBuild(cwd string) *providerCatalog {
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
	catalog, stored := s.cacheStaticProviderCatalog(cwd)
	if stored {
		s.startProviderCatalogBuild(cwd)
	}
	return catalog
}

// cacheStaticProviderCatalog stores the spec-only catalog unless a probing build got there first.
//
// Storing it is what keeps a burst of cold requests from each running the availability probes, and
// what lets `providerCatalogOrBuild` tell "no catalog yet" from "cache is warm". It reports whether
// this call stored the catalog, which is also when a background build has to start.
func (s *Server) cacheStaticProviderCatalog(cwd string) (*providerCatalog, bool) {
	catalog := s.buildCatalog(s.store.LoadDaemonConfig(), nil)
	key := providerCatalogKey(cwd)
	s.providerCatalogMu.Lock()
	defer s.providerCatalogMu.Unlock()
	if s.providerCatalogs == nil {
		s.providerCatalogs = make(map[string]*providerCatalog)
	}
	if cached := s.providerCatalogs[key]; cached != nil {
		return cached, false
	}
	s.providerCatalogs[key] = catalog
	return catalog, true
}

// startProviderCatalogBuild probes one scope in the background and broadcasts the catalog when it
// lands. One build per scope at a time: the clients that ask meanwhile read the static catalog.
func (s *Server) startProviderCatalogBuild(cwd string) {
	key := providerCatalogKey(cwd)
	s.providerCatalogMu.Lock()
	if s.providerCatalogBuilding[key] {
		s.providerCatalogMu.Unlock()
		return
	}
	if s.providerCatalogBuilding == nil {
		s.providerCatalogBuilding = make(map[string]bool)
	}
	s.providerCatalogBuilding[key] = true
	s.providerCatalogMu.Unlock()

	go func() {
		defer func() {
			s.providerCatalogMu.Lock()
			delete(s.providerCatalogBuilding, key)
			s.providerCatalogMu.Unlock()
		}()
		ctx := s.backgroundContext()
		probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		s.pushProviderSnapshot(probeCtx, s.store.LoadDaemonConfig(), nil, cwd)
	}()
}

// backgroundContext bounds work that outlives the request that asked for it.
func (s *Server) backgroundContext() context.Context {
	if s.bgCtx != nil {
		return s.bgCtx
	}
	return context.Background()
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
