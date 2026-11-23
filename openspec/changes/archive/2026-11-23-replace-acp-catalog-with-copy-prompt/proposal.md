# Proposal

## Why

The built-in ACP catalog duplicates provider onboarding knowledge and presents the adapter as an ordinary installable skill, although the intended flow is to copy one prompt and let the agent read the adapter template on demand. The template needs a stable daemon-host path so that prompt works without installing files into agent skill directories.

## What Changes

- **BREAKING**: Remove the official ACP creation catalog, searchable preset list, and catalog-driven config patch flow from Add provider.
- Replace that creation surface with one action that copies a complete ACP onboarding prompt to the clipboard.
- Move the adapter template out of ordinary bundled-skill discovery and materialize it on demand under a stable BySpace-owned resource directory.
- Add a namespaced daemon RPC that returns the complete prompt with the absolute daemon-host `SKILL.md` path embedded.
- Preserve configured generic ACP providers, custom provider configuration, diagnostics, and recognizable provider icons.
- Do not install into `~/.agents/skills` or `~/.claude/skills`, and do not delete adapter copies a user already has.

## Capabilities

### New Capabilities

- `acp-provider-onboarding`: Copy-prompt onboarding and continued use of configured ACP providers without a built-in creation catalog.
- `bundled-agent-resources`: Stable, on-demand daemon-host resources that are not ordinary agent skills.

### Modified Capabilities

None; the repository has no main OpenSpec capability specs.

## Impact

- ACP creation UI and catalog modules under `web/src/screens/` and `web/src/data/`.
- Adapter resources and skill discovery under `internal/server/`.
- A new dotted session RPC plus schemas and client support in `packages/protocol/` and `packages/client/`.
- Provider icon registries, clipboard handling, translations, documentation, and UI/RPC tests.
