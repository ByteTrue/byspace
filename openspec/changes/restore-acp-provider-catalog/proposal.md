# Proposal

## Why

Copy-prompt-only onboarding removed useful, officially maintained setup knowledge for known ACP CLIs. Restoring PASEO's preconfigured catalog makes those providers discoverable and repeatable to add without promoting them to BySpace's four primary built-in providers.

## What Changes

- **BREAKING**: Replace the copy-prompt-only ACP creation requirement with a PASEO-style searchable catalog of officially preconfigured ACP providers, while retaining **Copy prompt** for CLIs outside the catalog.
- Port the reference catalog's provider definitions, presentation, and explicit add/enable interaction to the current React web app. A catalog entry must not become active merely because it is displayed; Claude, Codex, OpenCode, and Pi remain the only primary built-in providers.
- Use the existing generic ACP runtime and declarative provider configuration. Add PASEO-style model and mode discovery for configured generic ACP providers so an added preset exposes its actual runtime catalog. Do not resurrect provider-specific native adapters, bundled plugin branches, the retired Expo app, or the Node daemon.
- Preserve existing configured ACP providers, editing, diagnostics, explicit model overrides, and recognizable icons without migration.
- Keep the separate `standardize-acp-provider-onboarding` change's canonical writer and common conformance check for unlisted providers and reusable acceptance; this change restores the official preset entry point rather than replacing those tools.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-provider-onboarding`: Add provider once again offers official searchable ACP presets alongside Copy prompt, with explicit activation, unchanged primary built-ins, and generic ACP runtime model/mode discovery.

## Impact

- **Web onboarding:** ACP preset data, searchable provider list, settings integration, localized labels, and interaction tests.
- **Provider presentation:** catalog icons and configured-provider icon resolution.
- **Configuration:** the existing declarative ACP provider persistence path used by the reference add/enable flow; no preset is auto-enabled by installation or application startup.
- **Go provider snapshots:** a bounded generic ACP catalog probe, runtime model/mode mapping, and preservation of explicit model overrides and fallback snapshots.
- **Reference/verification:** `reference/paseo` is the behavior source; focused Go/web tests and real-browser checks cover catalog restoration, default provider state, and runtime catalog refresh.
- **Out of scope:** new provider-specific runtime branches, resurrection of Expo/Node modules, and the canonical CLI/conformance implementation owned by `standardize-acp-provider-onboarding`.
