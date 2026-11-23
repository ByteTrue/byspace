# Proposal

## Why

The Go provider adapters cover only part of the behavior exposed by the reference implementation at paseo commit 9c4106561ad816fda917f43adce827c01faf47b1. Some gaps merely hide agent activity; others report failed starts or interrupted turns as healthy, and file rewind can discard unrelated workspace changes.

## What Changes

- Establish truthful session startup, completion, cancellation, configuration, capability, history, and archive behavior shared by every built-in provider and generic ACP.
- **BREAKING**: Replace whole-workspace file rewind with provider-native, session-scoped rewind so unrelated tracked and untracked edits survive.
- **BREAKING**: Stop inventing session identifiers after failed initialization and stop acknowledging settings or cancellations that the provider rejected or ignored.
- Align OpenCode transport selection, streaming, recovery, permissions, steering, subagents, and native revert with the reference.
- Align generic ACP permission options, session updates, tool payloads, dynamic catalogs, model/mode controls, resume, close, and cancellation with the reference. **BREAKING**: adopt the reference's disabled-by-default ACP filesystem capabilities unless explicitly enabled.
- Align Codex event coverage, approvals, compaction, subagents, custom prompts, skills, goals, and out-of-band slash commands with the reference.
- Align Claude partial streaming, task protocol, compaction/status events, background boundaries, steering, live settings, and native rewind with the reference.
- Align Pi no-turn completion, attachment capability checks, queue cancellation, compaction, retry, and tool-result handling with the reference while preserving BySpace-owned MCP and extension integration.
- Expose normalized background and subagent activity needed by the web client.

## Capabilities

### New Capabilities

- `provider-session-lifecycle`: Shared startup, state, cancellation, configuration, capability, history, and archive contracts.
- `provider-file-rewind`: Conversation rewind without collateral workspace data loss.
- `provider-background-work`: Normalized background-work and subagent activity across providers.
- `opencode-session-protocol`: OpenCode transport, streaming, recovery, interaction, and rewind behavior.
- `acp-session-protocol`: Generic ACP initialization, updates, permissions, catalogs, controls, and shutdown behavior.
- `codex-session-protocol`: Codex app-server events, approvals, commands, goals, and subagent behavior.
- `claude-session-protocol`: Claude streaming, task, control, settings, and rewind behavior.
- `pi-session-protocol`: Pi RPC completion, cancellation, compaction, retry, and attachment behavior.

### Modified Capabilities

None; the repository has no main OpenSpec capability specs.

## Impact

- Go providers under `internal/agent/providers/` and `internal/agent/pi/`, plus shared SDK types and launch construction.
- Workspace rewind and history/archive handlers under `internal/server/` and `internal/workspace/`.
- Wire types in `packages/protocol/` and client APIs in `packages/client/` where existing payloads cannot represent required behavior.
- Provider and timeline consumers in `web/src/`.
- Protocol fixtures, fake provider processes, HTTP/SSE tests, real-provider compatibility checks, and provider documentation.
