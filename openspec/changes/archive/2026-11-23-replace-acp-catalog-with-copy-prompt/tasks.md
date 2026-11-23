# Tasks

## 1. Stable adapter resource

- [x] 1.1 Move the ACP adapter and references out of internal/server/skills into an embedded daemon resource tree and materialize them atomically at $BYSPACE_HOME/resources/byspace-provider-adapter/; verify repeated-request, content-refresh, and ordinary-skill-discovery tests.
- [x] 1.2 Rewrite the adapter for on-demand copy-prompt onboarding, removing catalog and agent-skill-install instructions while retaining validation, diagnostics, reload, verification, and host-permission guidance; verify the embedded resource contains no obsolete flow and no user skill files are written or deleted.

## 2. Prompt RPC and client

- [x] 2.1 Add provider.acp.get_onboarding_prompt.request/.response schemas with requestId and payload.prompt, daemon materialization/prompt composition, and daemon-client support; verify the prompt contains the absolute stable SKILL.md path and inbound/outbound validation passes.
- [x] 2.2 Cover materialization and RPC failures with actionable errors; verify no success response or fabricated path is returned when resources cannot be written.

## 3. Copy-prompt UI and catalog removal

- [x] 3.1 Replace the ACP preset search/list with one copy-prompt action using the platform clipboard and localized success/error feedback; verify UI tests inspect the exact copied daemon prompt and cover RPC/clipboard retry failures.
- [x] 3.2 Delete unused ACP creation catalog/config-patch modules and decouple provider icon metadata from them; verify previously cataloged configured providers retain icons, editing, models, diagnostics, and runtime configuration without migration.
- [x] 3.3 Update docs/custom-providers.md and related provider onboarding text for copy-prompt-only creation and the daemon-host path; verify no remaining documentation tells users to install the adapter as an ordinary skill or use the removed catalog.

## 4. Integration verification

- [x] 4.1 Run focused Go and web tests, npm run typecheck, npm run lint, and npm run format:check; verify Add provider contains no preset catalog and skill selection contains no bundled adapter.
- [x] 4.2 Run npm run audit after rebuilding workspace packages and the Go binary; verify generated protocol parity and browser conformance, then exercise copy-prompt against the development daemon home without changing production configuration.
