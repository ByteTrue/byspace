# Design

## Context

The built-in Go adapters and generic ACP adapter normalize events into the same SDK and web timeline, but each currently implements a different subset of its upstream protocol. The reference baseline is paseo commit 9c4106561ad816fda917f43adce827c01faf47b1. BySpace's app and daemon ship together, so wire contracts can change without legacy compatibility shims.

## Goals / Non-Goals

**Goals:**

- Make provider state and user actions truthful at trust boundaries: startup, permissions, settings, cancellation, rewind, and shutdown.
- Preserve provider-native event detail through the shared SDK and protocol instead of reducing every provider to final text.
- Keep parity work testable without installed vendor CLIs, then validate a small real-provider matrix.

**Non-Goals:**

- Resurrect retired paseo plugins, quota/service-proxy features, or ACP auto-accept behavior.
- Replace BySpace's tool bridge, bundled MCP integration, or generated Pi extensions.
- Add native Copilot/OMP providers or preserve obsolete wire versions.
- Change background/subagent presentation; that belongs to `refine-background-and-subagent-tracks`.

## Decisions

### Use per-provider parity ledgers, not a new universal adapter framework

Port the reference behavior into the existing ACP, OpenCode, Codex, Claude, and Pi adapters. Extend shared SDK types only when two sides need the same semantic fact; do not build a wrapper hierarchy around provider protocols. A checked parity ledger will map each reference event and action to its Go handler and regression fixture so omitted notifications are visible.

### Treat startup and control operations as transactions

A session becomes available only after initialization and any required thread/session creation succeed. Errors propagate with no fabricated native handle. Model, mode, thinking, steer, cancel, and close operations acknowledge only successful upstream responses. Pending permissions and tool calls resolve to explicit terminal states on cancellation or teardown.

### Route file rewind through the owning provider

The server selects native rewind for the session's provider and never substitutes `git reset --hard` or untracked-file cleanup for a files/both rewind. Chat-only rewind remains a conversation operation. Providers without native file rewind report that limitation instead of modifying the whole workspace. Safety fixtures include unrelated tracked edits, untracked files, and a second session in the same worktree.

### Carry launch configuration and capabilities explicitly

Add user MCP configuration to the shared launch input and forward it using each provider's native mechanism. Derive advertised capabilities from the selected adapter and negotiated runtime state; unsupported history import, archive, settings, attachments, or subagents are not advertised. Native history import/archive behavior is implemented per provider rather than inferred from provider name alone.

### Preserve streaming and recovery semantics per transport

- **OpenCode:** select the supported v1/v2 API shape, consume SSE as the authoritative activity stream, preserve tool/reasoning/part data, and recover reconnect gaps without duplicating completed parts. Permissions and subagents use native APIs; steering and revert remain session-scoped.
- **ACP:** return the exact permission option ID, map all session update families, preserve tool input/output/diffs/locations/terminal links, and honor session-returned model/mode/config catalogs. Filesystem read/write defaults follow the reference and require explicit enablement.
- **Codex:** cover item, delta, terminal, patch, MCP, web, image, plan, diff, retry, compaction, collaboration, and approval notifications. Dispatch advertised custom prompts, skills, goals, and compact commands out of band where the reference does so.
- **Claude:** carry partial stream deltas and native task lifecycle/control messages in preference to Task-tool heuristics. Use admitted steering, authoritative cancellation, live settings, and native file rewind.
- **Pi:** distinguish successful no-turn responses from running turns, check attachment input capabilities, clear queued work on abort, and port compaction/retry/tool-result image/custom-message handling without displacing BySpace integrations.

### Normalize background activity at the provider boundary

Providers publish background-work and subagent facts using a shared model with identity, title, command/description, status, progress, timestamps, and native or managed-child navigation targets. Push updates supplement initial snapshots. The UI consumes this model but does not infer shell output or history that upstream does not expose.

### Build fake-protocol tests before live validation

Use fake stdio processes for ACP/Codex/Claude/Pi and `httptest` HTTP/SSE servers for OpenCode. Golden event sequences lock mapping, recovery, cancellation, and error behavior. Real CLI checks then cover a small versioned compatibility matrix rather than serving as the only regression suite.

## Risks / Trade-offs

- [Native vendor behavior varies by installed version] → Record tested versions, negotiate capabilities where supported, and fail unsupported operations explicitly.
- [Full event parity expands shared wire types] → Change protocol, daemon, and client together and run generated inbound/outbound validation.
- [Streaming recovery can duplicate or reorder activity] → Use native event IDs and resume cursors where available, with gap/reconnect golden tests.
- [Disabling ACP filesystem capabilities by default changes existing custom-provider behavior] → Document the explicit opt-in and keep existing provider configuration editable.
- [Removing fallback rewind exposes unsupported providers] → Return an actionable unsupported error rather than risking workspace data.

## Migration Plan

1. Land safety and truthfulness fixes with regression tests before broader event coverage.
2. Extend shared launch/config/capability contracts and update both wire sides in the same commits.
3. Port OpenCode and ACP transports, then Codex, Claude, and Pi using the parity ledgers.
4. Update native history/archive and background activity consumers after their provider contracts exist.
5. Run focused unit/browser suites, then `npm run audit` and the real-provider matrix. No persisted-data migration or legacy wire shim is required.
