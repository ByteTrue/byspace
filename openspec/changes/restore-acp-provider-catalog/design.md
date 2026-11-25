# Design

## Context

See proposal.md for motivation. BySpace already has the four primary built-ins, generic ACP launch support, declarative custom provider configuration, and cached provider snapshots. The current PASEO reference vendors 40 ACP presets and probes configured providers through a throwaway ACP session. The deleted BySpace DOM catalog is an adaptation reference only; its data predates the current PASEO catalog.

The separate standardize-acp-provider-onboarding change owns arbitrary CLI writing and conformance. This change uses the existing daemon config patch and snapshot refresh paths for official presets.

## Goals / Non-Goals

**Goals:**

- Port PASEO's current preset data, icons, ranking, filtering, and serialized Add behavior into the existing web settings surface.
- Discover standard ACP models and modes when an enabled generic ACP provider snapshot is refreshed.
- Preserve explicit model overrides, unavailable-provider behavior, and existing configured providers.

**Non-Goals:**

- No new catalog RPC, eager config seeding, provider-specific runtime adapter, bundled plugin branch, Expo/Node resurrection, or automatic version-update service.
- No new default-mode selection rule; PASEO's generic fetchCatalog returns models and modes, with only the current model marked as default.

## Decisions

### Vendor the current PASEO catalog in the web client

Port C:/Users/byte/workspace/reference/paseo/packages/app/src/data/acp-provider-catalog.ts and its SVG assets into the existing web data/icon modules. Keep all 40 entries and their pinned commands, environment, and protocol params verbatim. All PASEO entries have local SVGs; use the existing fallback only for non-catalog custom providers.

PASEO's agy is absent, so agy remains a Copy prompt/canonical-writer case rather than receiving an invented preset. Do not add a 41st entry in this change.

Ignore PASEO's bundledProvider host-feature branches. goose, fx, and hoplite use the same declarative generic ACP patch as every other entry; no bundled plugin implementation is ported. Likewise, Cursor, Kimi, Kiro, and TRAE use BySpace's existing runtime behavior without importing PASEO's dedicated adapters.

### Reuse PASEO ranking and the current daemon config path

Port provider-catalog-search.ts using the existing @bytetrue/protocol/search/text-match functions. An empty query sorts by title; a query ranks only title and id, with alphabetical tie-breaking. Filter every configured provider id, including disabled entries, so Add cannot silently overwrite an existing configuration.

Use the existing SettingsSection rather than adding a parallel modal/navigation system. Render ProviderCatalogList and the existing AcpOnboardingCopyPrompt together in Add provider. Adapt PASEO's React Native rows to the current Item, InputGroup, Empty, Button, Spinner, and SvgXml components.

Serialize adds with one addingProviderId/ref. Add performs patchConfig(buildAcpProviderConfigPatch(entry)), awaits refresh([entry.id]), then opens that provider's detail. A patch or refresh failure shows an error and does not open detail. Opening or searching the list performs no config write, refresh, launch, or enable action. Added presets are ordinary enabled custom providers; unchosen presets remain absent rather than being persisted as disabled entries.

### Extend the existing snapshot discovery callback to return a catalog

Replace the models-only discovery callback used by BuildSnapshotEntries with a ProviderCatalog result containing Models and Modes. Do not add a second discovery pipeline. Built-in providers return Models only and retain their static modes. Ready generic ACP providers return both; unavailable or disabled providers are never passed to the callback.

In internal/server/provider_catalog.go, dispatch generic ACP IDs to the ACP probe and keep the existing built-in discoveredModels path for the four primary providers. The existing cached snapshot and refresh([id]) flow determine when probing runs; catalog rendering itself never triggers it.

### Implement one bounded generic ACP probe

Add an exported providers.FetchACPProviderCatalog helper that resolves the saved provider launch configuration, starts a temporary ACP session, snapshots its negotiated native models and modes, and always closes the session. Refactor the existing ACP startup internals to accept a startup context while leaving StartACPSession's public signature and interactive 3-second budget unchanged.

The snapshot refresh supplies a 30-second probe context. Use the refresh cwd, or the daemon user's home directory for a global refresh, and set NO_BROWSER=true as PASEO does. The helper returns only the runtime catalog; BuildSnapshotEntries applies MergeProviderModels afterward so models replaces and additionalModels appends exactly once. applyACPSessionCatalog already marks currentModelId as the default model, so no second model mapping is needed.

On probe error or an empty runtime response, return the configured/static fallback catalog without failing the snapshot refresh or rolling back Add. Defer ACPSession.Close so timeout and success paths both reap the probe process. No BySpace agent or workspace is created.

## Risks / Trade-offs

- [A first npx/uvx download can exceed the probe budget] → Keep the saved provider and fallback snapshot; an explicit later refresh retries after the package is cached.
- [A generic probe can trigger provider-side startup work] → Probe only explicitly enabled, executable providers, set NO_BROWSER, bound startup, and always close the process.
- [Pinned catalog data becomes stale] → Copy PASEO's current versions and cover representative commands in tests; leave ongoing upstream sync/version automation out of this change.
- [Existing custom ACP providers gain process launches on refresh] → Reuse the cached snapshot path, probe only ready providers, and preserve fallback behavior on failure.
- [Forty presets increase the settings payload] → Keep the catalog static and web-local; no daemon or wire payload changes are needed.

## Migration Plan

No configuration migration is required. Existing custom ACP providers retain their entries and gain runtime catalog discovery on their next snapshot refresh. Rollback can remove the catalog UI and probe while leaving all added entries valid as ordinary generic ACP configuration.
