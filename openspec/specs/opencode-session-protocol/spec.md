# opencode-session-protocol Specification

## Purpose

Aligns OpenCode sessions with native versioned transport, streaming, recovery, interaction, and revert behavior across supported server APIs.

## Requirements

### Requirement: Transport matches the OpenCode server API

The system SHALL select the supported v1 or v2 request and event shapes using server capabilities and SHALL NOT send one version's payloads to the other.

#### Scenario: v2 server starts a session

- **WHEN** the connected server negotiates the v2 API
- **THEN** session creation, prompts, and controls use v2 fields and endpoints

### Requirement: SSE drives live session activity

The system SHALL consume OpenCode SSE updates for text, reasoning, tools, parts, status, usage, and errors and SHALL preserve their native ordering and identity.

#### Scenario: Tool produces incremental updates

- **WHEN** SSE reports tool start, progress, output, and completion
- **THEN** the timeline reflects those states with the associated native part and tool data

### Requirement: Reconnect recovers event gaps without duplication

The system SHALL resume or resynchronize OpenCode activity after transport interruption and SHALL reconcile fetched state with already rendered events.

#### Scenario: SSE disconnects during a turn

- **WHEN** the stream reconnects after missing events
- **THEN** missed activity is recovered once and the turn reaches its authoritative final state

### Requirement: Permissions and subagents use native OpenCode APIs

The system SHALL answer native permission requests and enumerate/open native subagents rather than returning stubbed success or empty results.

#### Scenario: OpenCode requests permission

- **WHEN** the user selects a native permission response
- **THEN** that response reaches the matching request and the pending interaction resolves

### Requirement: Steering and cancellation are authoritative

The system SHALL use native steering and abort semantics, retain client message identity, and report rejection or interruption accurately.

#### Scenario: User steers an active turn

- **WHEN** OpenCode accepts a steering message
- **THEN** it is associated with the active turn and acknowledged without starting an unrelated duplicate turn

### Requirement: File rewind uses session-scoped revert

The system SHALL implement OpenCode file rewind with native session revert and retain unrelated workspace changes.

#### Scenario: User rewinds an OpenCode message

- **WHEN** native revert succeeds for the selected message
- **THEN** only that session's rewound changes are restored
