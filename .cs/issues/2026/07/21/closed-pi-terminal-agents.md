---
id: pi-terminal-agents
title: Add provider-scoped Terminal hooks and Pi profile
type: change
status: closed
parent: .cs/epics/2026/07/21/terminal-experience/spec.md
created: 2026-07-21
closed: 2026-07-21
---

# Add provider-scoped Terminal hooks and Pi profile

## Intent

Complete Pi's Terminal integration without coupling hook installation to whether a provider is enabled for managed agents.

## User correction

The existing **Enable terminal agent hooks** switch wrote hook configuration for every supported provider at once. Hook installation is a separate, externally visible config-file side effect and must be independently controllable per provider. Pi was also absent from both hook installation and the default Terminal profiles list.

## Exploration result

- BySpace already owns the common loopback activity endpoint and terminal identity. Pi only needs an auto-discovered extension in its agent directory and Pi event-to-activity mapping.
- Orca uses the same Pi extension API, but its generated extension also contains Orca-specific endpoint-file refresh, WSL bridging, session-resume identity, and dashboard preview transport. Copying that layer would duplicate infrastructure BySpace already has.
- Filtering one global switch by managed-provider enablement is not a stable policy: built-ins default enabled, users can launch a CLI manually in Terminal, and later provider changes would silently change hook ownership.
- Provider-scoped switches make every config mutation explicit and reversible.
- Terminal profiles already support arbitrary commands; Pi only needs a default `pi` profile.

## Design

### Hook settings

Expose one switch each for Claude Code, Codex, OpenCode, and Pi.

Persist an optional `terminalAgentHooks` object in daemon config. Its provider fields are optional on the wire for backward compatibility; server normalization produces a complete effective map.

Keep the existing `enableTerminalAgentHooks` field as a compatibility aggregate:

- old client → new daemon: changing the legacy switch changes every provider;
- new client → new daemon: changing one provider sends the provider map and updates the legacy aggregate to `any enabled`;
- new client → old daemon: capability detection keeps the old global switch instead of exposing non-functional provider controls;
- persisted legacy-only config: every provider inherits the legacy value until the first provider-scoped edit.

At daemon startup, enabled providers are installed but disabled providers are not proactively removed. This prevents a disabled secondary or test daemon from modifying real agent configuration owned by another daemon. A live enabled-to-disabled setting change removes only the provider that changed.

### Pi extension

Install `byspace-terminal-activity.ts` under `${PI_CODING_AGENT_DIR}/extensions` or `~/.pi/agent/extensions`.

The extension:

- posts activity to the existing authenticated loopback Terminal activity endpoint without awaiting delivery;
- prevents child Pi processes from claiming the parent Terminal's identity;
- maps `agent_start` to running, ask/question tool execution to needs-input/running, and `agent_settled`/`session_shutdown` to idle;
- carries a BySpace ownership marker, refuses to overwrite an unowned same-name file, and removes only the BySpace-owned extension.

Do not copy Orca-only session identity, endpoint refresh, WSL curl bridge, or assistant-preview code.

### Terminal profile

Append a built-in **Pi** profile using command `pi`. Existing user-customized profile arrays remain untouched by the current defaulting contract.

## Execution

- Added optional provider-scoped hook settings and a server capability flag while retaining the legacy global field.
- Normalized legacy and provider-scoped patches in the daemon config store and persisted both compatibility views.
- Reconciled provider hook files independently and preserved the startup no-uninstall boundary for secondary/test daemons.
- Added a Pi provider extension using Pi's documented lifecycle and extension discovery path.
- Added marker ownership protection for managed plugin files.
- Replaced the global settings switch with four provider rows when the daemon advertises support; old daemons retain the global switch.
- Added Pi to the built-in Terminal profile defaults.

## Acceptance

- [x] Pi is available as an independent Terminal agent hook switch.
- [x] Claude Code, Codex, OpenCode, and Pi hooks can each be enabled or disabled without mutating sibling providers.
- [x] Legacy global clients/config still control all providers.
- [x] Pi extension install, idempotence, ownership, activity mapping, and uninstall are covered by focused tests.
- [x] Pi appears in default Terminal profiles and launches through the existing profile flow.
- [x] Old daemons continue to show and use the global hook switch.
- [x] Typecheck, lint, format, Web export, focused tests, and independent review pass.

## Verification

- Focused protocol/config/hook tests: 8 files, 94 tests passed.
- Pi/OpenCode ownership follow-up: 2 files, 17 tests passed.
- Host settings Web E2E: provider-scoped rows and Pi profile visible.
- `npm run typecheck`: passed.
- `npm run lint`: 0 warnings, 0 errors.
- `npm run format`: passed.
- App Web export: passed.
- Independent review: no blocker, high, or medium findings after the `ask_user` mapping and secondary-daemon ownership fixes.

## Non-goals

- Copying Orca's full agent-status/session-resume pipeline.
- Tying Terminal hook state to managed-provider enablement.
- Adding per-project hook scope.
- Changing user-customized Terminal profile arrays.
- Completing the deferred real-Windows Terminal paste acceptance in this issue.

## 关闭结论

The issue is complete: hook ownership is explicit per provider, Pi participates in both activity hooks and default Terminal profiles, old clients and daemons retain the global compatibility path, and configuration-file side effects are bounded by provider and ownership marker.

The stable product and architecture constraints were written back to the parent Terminal Experience Epic and `docs/terminal-activity.md`. Real Windows paste validation remains a separate deferred acceptance item in the Epic and is not a blocker for this issue.
