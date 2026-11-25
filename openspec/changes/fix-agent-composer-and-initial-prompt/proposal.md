# Proposal

## Why

Four defects currently make basic agent interactions look broken: composer accessories are visibly faded at their edges, reload leaves a permanent loading toast, a new Pi agent can silently drop its initial image prompt, and ACP ignores the agent's negotiated image-input capability. The Pi case is especially damaging because creation appears successful even though no agent turn starts.

## What Changes

- Remove the unconditional composer edge fade so accessories remain fully opaque; keep native horizontal scrolling for overflow.
- Tie the reload loading toast to the operation and dismiss or replace it on both success and failure.
- Make Pi initial image submission respect negotiated model capabilities without rejecting images while a new session's capabilities are still unknown.
- Make ACP image support follow negotiated prompt capabilities, treating omitted support as unsupported and rejecting unsupported image prompts before a turn starts.
- Propagate synchronous initial-prompt submission errors through agent creation instead of acknowledging a usable agent that never started a turn, while preserving existing text-only model rejection.

## Capabilities

### New Capabilities

- `composer-track-presentation`: Visual and overflow behavior for horizontally arranged composer accessories.
- `agent-operation-feedback`: Pending and terminal user feedback for agent lifecycle operations.

### Modified Capabilities

- `acp-session-protocol`: Image support must follow negotiated ACP prompt capabilities, with omitted support treated as unsupported.
- `pi-session-protocol`: Image capability checks must distinguish unknown startup capabilities from a negotiated text-only model.
- `provider-session-lifecycle`: Agent creation must report synchronous initial-prompt submission errors rather than returning false success.

## Impact

Affected code includes the composer track bar and its tests, workspace reload handling and toast coverage, Pi and ACP prompt capability handling, and server-side agent creation. The `create_agent_request` wire schema remains unchanged, but its error behavior becomes truthful. No new dependencies are required.
