# Design

## Context

Add provider currently builds ACP configurations from a 39-entry catalog. The adapter is embedded with ordinary skills, extracted to a random temporary directory, and its instructions refer to both the catalog and agent skill installation. Existing configured ACP providers use ordinary `extends: "acp"` configuration and must continue working.

## Goals / Non-Goals

**Goals:**

- Make copy-prompt the only built-in ACP creation flow.
- Give the copied prompt a stable absolute path on the daemon host.
- Separate provider icon metadata from the removed creation catalog.

**Non-Goals:**

- Remove custom ACP runtime, diagnostics, or provider editing.
- Migrate or delete existing provider configuration and user-installed files.
- Install the adapter into agent skill directories or expose it in skill selection.

## Decisions

### Store the adapter as a daemon resource, not a skill

Move `SKILL.md` and its references out of `internal/server/skills/` into an embedded daemon resource tree. On demand, materialize them atomically at `$BYSPACE_HOME/resources/byspace-provider-adapter/`. Refresh changed embedded content while keeping the path stable. Ordinary bundled skills retain their current discovery and extraction behavior.

### Let the daemon own the complete prompt

Add `provider.acp.get_onboarding_prompt.request` and `.response`, with `requestId` correlation and a response `payload.prompt`. The handler materializes the resource and composes instructions to read and follow the quoted absolute `SKILL.md` path, ask which ACP agent the user wants, and configure it without modifying BySpace source. The web client copies this string verbatim through the existing clipboard abstraction and reports success or failure.

### Replace only the creation surface

Remove the catalog search/list and config-patch modules once unused. Add provider keeps one concise explanation and copy action. Existing configured providers continue to use the current edit, model, diagnostic, and runtime paths. Provider icon-name and icon-component registries remain independent of the deleted catalog so existing providers keep their icons.

### Treat the path and permissions as host facts

The UI identifies the path as belonging to the daemon host, not the browser machine. The adapter retains configuration validation, daemon reload, diagnostics, and end-to-end verification guidance, and notes that reading outside a workspace can require agent approval. No onboarding step writes to agent skill directories.

## Risks / Trade-offs

- [Existing users may rely on preset creation] → Existing configurations remain functional; new setup uses the copied guided prompt.
- [A remote browser cannot use a daemon-host path directly] → The prompt is intended for an agent running against that daemon and labels the host explicitly.
- [Agent sandbox rules can block resource reads] → Document approval/external-directory behavior in the adapter rather than bypassing it.
- [Deleting catalog modules can regress icons] → Keep icon registries and add a rendering test for previously cataloged configured providers.

## Migration Plan

Add and test the resource/RPC path, switch the UI to copy-prompt, then delete unused creation modules and rewrite the adapter instructions. Update provider documentation and translations. No configuration migration, legacy RPC, or cleanup of existing user files is needed.
