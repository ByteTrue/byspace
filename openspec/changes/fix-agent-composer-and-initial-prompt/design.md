# Design

## Context

See proposal.md for motivation and the delta specs for required behavior. The relevant implementation seams are small but cross the web client, Pi adapter, and daemon:

- `web/src/composer/tracks.tsx` applies a fixed edge mask even when the track has no overflow.
- `web/src/screens/workspace/workspace-screen.tsx` creates an indefinite reload toast without an id, then emits separate terminal toasts. `ToastApi.show` already supports replacement by id.
- `internal/agent/pi/pi.go` leaves `modelInput` nil until `GetState` or `SetModel` returns capabilities. `Prompt` currently treats that unknown state as text-only. Session startup returns before capabilities are available, and issuing an early `get_state` solely to wait is unsafe for the stdio transport.
- `internal/agent/providers/acp.go` stores `agentCapabilities` during initialization but reports image support unconditionally and forwards every image. ACP initialization completes before session creation and prompt submission, so there is no Pi-style unknown-capability window; the protocol treats omitted image support as unsupported.
- `internal/server/server.go` discards the synchronous error returned by the initial `Prompt` call, then appends the submitted row and sends `agent_created`. Existing creation failures already use `discardCreatedAgent` plus `agent_create_failed`.

## Goals / Non-Goals

**Goals:**

- Keep the existing composer scrolling and toast APIs.
- Preserve rejection for a model known to be text-only while allowing prompts before capabilities arrive.
- Report ACP image support from negotiation and reject known-unsupported images before starting a turn.
- Reuse the existing agent-creation failure and client error-recovery paths.
- Cover each regression with a focused test.

**Non-Goals:**

- No dynamic overflow measurement or replacement visual treatment.
- No Pi readiness protocol, startup wait, or additional startup RPC.
- No change to asynchronous provider turn-error handling or to archive/unarchive behavior.
- No wire schema, persistence, or dependency changes.

## Decisions

### Remove the unconditional composer mask

Delete the mask styles from the inner composer track and retain its native horizontal scrolling. Do not add resize observers or overflow state for a cosmetic fade. Add a rendering assertion that the track has no mask when its accessories fit.

### Replace the reload toast under one operation id

Use `agent-reload:<agentId>` for loading, success, and error feedback. Loading keeps `durationMs: null`; terminal updates use the same id with the normal finite duration, so Sonner replaces rather than stacks the pending toast. Put the small toast-sequencing helper beside the workspace screen so success and failure can be tested without mounting the full screen. Use `toast.show` for errors as well because `toast.error` does not accept an id.

### Distinguish unknown capabilities from negotiated text-only input

Keep `supportsImages` conservative for advertised capabilities. Change only the prompt preflight predicate: reject images when `modelInput != nil` and the negotiated list does not contain `image`; when `modelInput == nil`, submit the prompt and let Pi handle it natively. This avoids both a startup wait and an extra `get_state`, and it applies to initial and later prompts.

Adapt the existing Pi image-forwarding test to send its image before `GetState`, then assert that the native request contains the image blocks. Retain coverage that a negotiated text-only model is rejected locally.

### Honor negotiated ACP image support

Use `agentCapabilities.promptCapabilities.image` for both advertised capabilities and prompt preflight. Omitted or malformed capability metadata means unsupported, matching the protocol's conservative default. Reject an unsupported image synchronously before changing turn state or appending timeline entries; non-image attachments remain unaffected. No startup wait or retry is needed because ACP initialization has already completed.

Add focused coverage for omitted, explicitly disabled, and explicitly enabled image support, plus an assertion that rejection occurs before a turn starts. An unsupported initial ACP image prompt uses the same generic creation-failure path as other synchronous provider errors.

### Treat synchronous initial-prompt errors as creation failures

Check the error from `mp.session.Prompt`. On failure, call `discardCreatedAgent`, send `agent_create_failed` with the request id and provider error, and return before appending the submitted row or sending `agent_created`. This is the same cleanup and response pattern already used for persistence and output-schema failures. The existing client create flow already handles that error response.

Test this through `handleCreateAgent` with the existing mock provider's `mockPromptRejections: 1` feature value. Assert the failure response, absence of `agent_created`, and removal of the new agent from memory and the store. No provider factory seam is needed.

## Risks / Trade-offs

- Removing the fade also removes its overflow cue → Native horizontal scrolling remains; the change favors opaque controls over adding layout measurement.
- An unknown model may ultimately be text-only → Pi can reject the native prompt asynchronously; the existing failed-turn path exposes that error instead of silently dropping the prompt.
- Malformed ACP capability metadata is treated as unsupported → This follows the same conservative rule as omitted capabilities and avoids forwarding an image the agent has not agreed to accept.
- Reusing one toast id supersedes earlier feedback for the same agent → This is intentional for repeated reloads and prevents stale pending toasts from accumulating.

## Migration Plan

No migration is required. Deploy the web and daemon changes together; rollback restores the previous behavior without touching stored data.
